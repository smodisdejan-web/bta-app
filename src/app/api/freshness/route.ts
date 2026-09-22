/**
 * GET /api/freshness — data-integrity watchdog for the Goolets dashboard.
 *
 * WHY THIS EXISTS (2026-09-08)
 * For eight days the dashboard showed Revenue €0 / ROAS 0 / FB spend €0 and nothing
 * anywhere said a word. Two independent breaks stacked up:
 *   1. bookings carry a MONTHLY `booking_date` ("2026-09") but /page.tsx compared it
 *      against a daily string, so every booking fell out of every range → revenue 0.
 *   2. /api/dashboard-totals hung on the Apps Script concurrency limit, the code fell
 *      back to the `fb_ads_enriched` feed, and that feed has been dead since 2026-08-09
 *      → FB spend 0.
 * The existing /api/health, /api/ai-health and /api/diag only assert that env vars are
 * set. They were all green the whole time. Green env vars are not green data.
 *
 * WHAT IT DOES
 *   FEEDS   — per Sheets tab: newest date present, row count, how many days stale.
 *   SANITY  — cross-checks on the current month's numbers that no single feed can see
 *             on its own ("revenue 0 while we spent €12k" is only visible if you hold
 *             both numbers at once). This is the half that would have caught 2026-09.
 *
 * PROTECTION
 * Deliberately NOT added to middleware's PUBLIC_PATHS: this route returns money
 * figures, so it sits behind the same `ai_unlock` cookie as every dashboard page.
 * code/goolets/freshness-check.js sends that cookie. If you ever want it callable
 * without the cookie, set FRESHNESS_TOKEN in the Vercel env and add '/api/freshness'
 * to PUBLIC_PATHS — the token check below then becomes the gate.
 *
 * SHARED TAB CACHE
 * lib/sheetsData.ts caches every tab for 10 minutes so the dashboard routes stop fighting over
 * Apps Script slots. This route passes bypassCache on every read: a watchdog whose whole job is
 * to report "this feed is N days stale" must read the sheet, not a copy of it. The fresh rows
 * it pulls are still written into the cache, so the next dashboard request benefits.
 *
 * APPS SCRIPT CONCURRENCY
 * Every tab is fetched STRICTLY SEQUENTIALLY (await in a straight line, no
 * Promise.all). Parallel fetches are what wedged /api/dashboard-totals in the first
 * place. This route is slow on purpose; it runs once a day from cron.
 */
import { NextResponse } from 'next/server'
import { DEFAULT_WEB_APP_URL, getSheetsUrl, SHEETS_TABS } from '@/lib/config'
import {
  fetchSheet,
  fetchBookings,
  mapFbEnriched,
  mapStreakLeads,
  normalizeHeaders,
  pickIdx,
  toIsoDay,
  toNumberEUorUS,
  type StreakLeadRow,
} from '@/lib/sheetsData'
// ONE lead loader + ONE day rule + ONE channel rule, shared with / and /api/funnel.
import { filterStreakByDay, leadChannelOf, streakLeadDay, unionStreakRows } from '@/lib/streak-leads'
import mtdData from '@/data/mtd-data.json'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 300

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/**
 * 'unknown' = we could not read this feed inside its deadline. It is NOT 'red' data —
 * it is no data at all — but it rolls up to red, because an unread feed is exactly the
 * blind spot this watchdog exists to kill.
 */
type Status = 'green' | 'amber' | 'red' | 'unknown'

interface FeedReport {
  name: string
  tab: string
  maxDate: string | null
  rowCount: number
  staleDays: number | null
  status: Status
  note?: string
  error?: string
}

interface Violation {
  rule: string
  severity: Status
  detail: string
}

const RANK: Record<Status, number> = { green: 0, amber: 1, unknown: 2, red: 3 }
const worse = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b)

/**
 * Per-tab deadline. WHY (2026-09-09): at 05:54 the route answered HTTP 504. Five tabs
 * are read strictly sequentially (~13-19 s on a good day); while the fb_ads_enriched
 * Apps Script sync was running, its concurrency limit stretched one tab past the
 * function budget and the WHOLE route died — the watchdog then wrote "monitor down"
 * even though four feeds had been read fine. A slow tab must cost that tab, not the
 * report.
 *
 * RAISED 12 s -> 25 s (2026-09-21, with streak_full joining as the 8th tab). 12 s was tight
 * enough that a merely busy Apps Script — not a broken one — pushed the two 2,4 MB Streak tabs,
 * bookings_api and fb_ads_api into 'unknown' on most runs, which rolls up to red. A watchdog
 * that cries red because it was impatient trains you to ignore it, which is the opposite of the
 * job. 25 s x 8 tabs = 200 s worst case, inside the maxDuration below (the two flat-channel
 * tabs, bing_ads_api and chatgpt_ads_api, joined on 2026-09-14).
 */
const TAB_TIMEOUT_MS = 25_000

function deadline(ms = TAB_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) }
}

/** A caught error is 'unknown' when its deadline fired, otherwise a genuine 'red'. */
function failStatus(d: { signal: AbortSignal }): Status {
  return d.signal.aborted ? 'unknown' : 'red'
}

const TIMEOUT_NOTE = `Tab se ni prebral v ${TAB_TIMEOUT_MS / 1000} s (Apps Script je bil verjetno zaseden s sync-om). Ni podatka — ne "vse je v redu".`

// ---------------------------------------------------------------------------
// dates — everything in Europe/Ljubljana, the timezone the client lives in
// ---------------------------------------------------------------------------

const TZ = 'Europe/Ljubljana'

/** YYYY-MM-DD for "now" in Ljubljana (en-CA formats as ISO). */
function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Positive = `to` is later. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return Math.round((b - a) / 86_400_000)
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Daily feeds: >2 days behind is a hard failure, exactly 2 is a warning.
 * A feed that ran yesterday is normal — most syncs are cron jobs at ~06:00.
 */
function dailyStatus(staleDays: number | null): Status {
  if (staleDays == null || Number.isNaN(staleDays)) return 'red'
  if (staleDays > 2) return 'red'
  if (staleDays === 2) return 'amber'
  return 'green'
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // Optional shared-secret gate. Unset (the default today) = the middleware
  // cookie is the only protection, same as every other page.
  const expected = process.env.FRESHNESS_TOKEN
  if (expected) {
    const { searchParams } = new URL(request.url)
    const given = searchParams.get('token') || request.headers.get('x-freshness-token')
    if (given !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const url = getSheetsUrl() || DEFAULT_WEB_APP_URL
  const today = todayIso()
  const yesterday = shiftIso(today, -1)
  const monthStart = `${today.slice(0, 7)}-01`
  const currentMonth = today.slice(0, 7)
  const dayOfMonth = Number(today.slice(8, 10))

  const feeds: FeedReport[] = []
  const violations: Violation[] = []

  // Running MTD aggregates. Nulls mean "we could not read this", which is a very
  // different thing from zero — see the null guards on the sanity rules below.
  let fbSpend: number | null = null
  let googleSpend: number | null = null
  let bingSpend: number | null = null
  let chatgptSpend: number | null = null
  let googlePlatformLeads: number | null = null
  let googleCrmLeads: number | null = null
  let fbCrmLeads: number | null = null
  let bingCrmLeads: number | null = null
  let chatgptCrmLeads: number | null = null
  let totalCrmLeads: number | null = null
  let mtdRevenue: number | null = null
  let bookingCount: number | null = null

  // -- 1/5  fb_ads_api — authoritative daily FB spend, straight from Meta -----
  const d1 = deadline()
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.FB_SPEND_DAILY, signal: d1.signal, bypassCache: true })
    const [header = [], ...data] = rows || []
    const H = normalizeHeaders(header as any[])
    const iDate = pickIdx(H, ['date', 'date_start', 'day'])
    const iSpend = pickIdx(H, ['spend', 'cost'])

    let maxDate: string | null = null
    let spend = 0
    for (const r of data) {
      const iso = toIsoDay(iDate === -1 ? r[0] : r[iDate])
      if (!iso) continue
      if (!maxDate || iso > maxDate) maxDate = iso
      if (iso >= monthStart && iso <= today) {
        spend += toNumberEUorUS(iSpend === -1 ? r[2] : r[iSpend])
      }
    }
    fbSpend = spend
    const staleDays = maxDate ? daysBetween(maxDate, today) : null
    feeds.push({
      name: 'Facebook Ads spend (Meta API)',
      tab: SHEETS_TABS.FB_SPEND_DAILY,
      maxDate,
      rowCount: data.length,
      staleDays,
      status: dailyStatus(staleDays),
    })
  } catch (e) {
    feeds.push({
      name: 'Facebook Ads spend (Meta API)',
      tab: SHEETS_TABS.FB_SPEND_DAILY,
      maxDate: null,
      rowCount: 0,
      staleDays: null,
      status: failStatus(d1),
      error: e instanceof Error ? e.message : String(e),
      note: d1.signal.aborted ? TIMEOUT_NOTE : undefined,
    })
  } finally {
    d1.clear()
  }

  // -- 2/5  daily_api — Google Ads daily -------------------------------------
  const d2 = deadline()
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.DAILY, signal: d2.signal, bypassCache: true })
    const [header = [], ...data] = rows || []
    const H = normalizeHeaders(header as any[])
    const iDate = pickIdx(H, ['date', 'day'])
    const iCost = pickIdx(H, ['cost', 'spend'])
    const iConv = pickIdx(H, ['conv', 'conversions'])

    let maxDate: string | null = null
    let cost = 0
    let conv = 0
    for (const r of data) {
      const iso = toIsoDay(r[iDate])
      if (!iso) continue
      if (!maxDate || iso > maxDate) maxDate = iso
      if (iso >= monthStart && iso <= today) {
        cost += toNumberEUorUS(r[iCost])
        conv += toNumberEUorUS(r[iConv])
      }
    }
    googleSpend = cost
    googlePlatformLeads = conv
    const staleDays = maxDate ? daysBetween(maxDate, today) : null
    feeds.push({
      name: 'Google Ads daily',
      tab: SHEETS_TABS.DAILY,
      maxDate,
      rowCount: data.length,
      staleDays,
      status: dailyStatus(staleDays),
    })
  } catch (e) {
    feeds.push({
      name: 'Google Ads daily',
      tab: SHEETS_TABS.DAILY,
      maxDate: null,
      rowCount: 0,
      staleDays: null,
      status: failStatus(d2),
      error: e instanceof Error ? e.message : String(e),
      note: d2.signal.aborted ? TIMEOUT_NOTE : undefined,
    })
  } finally {
    d2.clear()
  }

  // -- 2b + 2c  bing_ads_api / chatgpt_ads_api — the two flat paid channels ---
  //
  // Added 2026-09-14 with the Bing (12-week test, live 4.9.) and ChatGPT Ads (oCPC, live 14.9.)
  // channels. Same header-keyed shape as daily_api: date | campaign | … | cost (EUR).
  //
  // A tab that is ABSENT is amber with an explicit note, not red: while these channels are being
  // stood up the tab genuinely may not exist yet, and "ni podatka" is a different statement from
  // "the feed broke". What must never happen is the third option — reporting €0 spend, which
  // would read as "we ran no ads" and is the exact lie the freshness contract exists to kill.
  // Once the tab carries rows it obeys the normal daily staleness rule like every other feed.
  const flatChannels: { name: string; tab: string; set: (v: number) => void }[] = [
    { name: 'Bing Ads daily (Microsoft)', tab: SHEETS_TABS.BING_DAILY, set: (v) => (bingSpend = v) },
    { name: 'ChatGPT Ads daily (OpenAI)', tab: SHEETS_TABS.CHATGPT_DAILY, set: (v) => (chatgptSpend = v) },
  ]
  for (const fc of flatChannels) {
    const dFlat = deadline()
    try {
      const rows = await fetchSheet({ sheetUrl: url, tab: fc.tab, signal: dFlat.signal, bypassCache: true })
      const [header = [], ...data] = rows || []
      const H = normalizeHeaders(header as any[])
      const iDate = pickIdx(H, ['date', 'day'])
      const iCost = pickIdx(H, ['cost', 'spend'])

      let maxDate: string | null = null
      let cost = 0
      for (const r of data) {
        const iso = toIsoDay(iDate === -1 ? r[0] : r[iDate])
        if (!iso) continue
        if (!maxDate || iso > maxDate) maxDate = iso
        if (iso >= monthStart && iso <= today) cost += toNumberEUorUS(iCost === -1 ? r[7] : r[iCost])
      }
      // Only claim a spend number when the tab actually answered with rows. No rows = unknown.
      if (maxDate) fc.set(cost)
      const staleDays = maxDate ? daysBetween(maxDate, today) : null
      feeds.push({
        name: fc.name,
        tab: fc.tab,
        maxDate,
        rowCount: data.length,
        staleDays,
        status: maxDate ? dailyStatus(staleDays) : 'amber',
        note: maxDate
          ? undefined
          : `Tab ${fc.tab} je prazen ali ga (še) ni. Poraba tega kanala je n/a — NE 0.`,
      })
    } catch (e) {
      feeds.push({
        name: fc.name,
        tab: fc.tab,
        maxDate: null,
        rowCount: 0,
        staleDays: null,
        // A missing tab answers with the Apps Script error body, which is not the same failure as
        // a timeout. Either way it is amber-with-a-reason while the channel is being stood up.
        status: dFlat.signal.aborted ? 'unknown' : 'amber',
        error: e instanceof Error ? e.message : String(e),
        note: dFlat.signal.aborted
          ? TIMEOUT_NOTE
          : `Tab ${fc.tab} se ni prebral (verjetno še ne obstaja). Poraba tega kanala je n/a — NE 0.`,
      })
    } finally {
      dFlat.clear()
    }
  }

  // -- 3/5  streak_full + streak_sync — the CRM side of every lead -----------
  //
  // BOTH tabs, and both watched (2026-09-21). This block used to read streak_sync ALONE and
  // bucket it with toIsoDay(), while /api/funnel read streak_full ∪ streak_sync bucketed with
  // toDay(). Same month, two lead counts (Meta 997 here vs 999 there on 21.9.), and a dead
  // sync-streak-full cron was invisible because nothing monitored the tab it writes.
  // Counting is now the shared rule from lib/streak-leads.ts, and each tab gets its own feed
  // row so either cron dying shows up on its own line.
  let streakFullLeads: StreakLeadRow[] = []
  let streakSyncLeads: StreakLeadRow[] = []
  let streakReadOk = false

  const streakTabs: {
    name: string
    tab: string
    set: (rows: StreakLeadRow[]) => void
    note?: string
  }[] = [
    {
      name: 'Streak CRM full scan',
      tab: SHEETS_TABS.STREAK_FULL,
      set: (rows) => (streakFullLeads = rows),
      note: 'Polni Streak scan (code/goolets/sync-streak-full.js, ~19 min, nazaj do 1. 1.). Primarni vir leadov na VSEH straneh; streak_sync pokriva le dneve, ki jih ta scan še ne doseže.',
    },
    {
      name: 'Streak CRM sync',
      tab: SHEETS_TABS.STREAK_SYNC,
      set: (rows) => (streakSyncLeads = rows),
      note: 'Zapier feed — vedno svež, a ne nujno popoln (manjkajo boxi, ki jih Streak še ni potisnil). Uporabljen samo za dneve izven pokritja streak_full.',
    },
  ]

  for (const st of streakTabs) {
    const dS = deadline()
    try {
      const rows = await fetchSheet({ sheetUrl: url, tab: st.tab, signal: dS.signal, bypassCache: true })
      const leads = mapStreakLeads(rows || [])
      st.set(leads)
      streakReadOk = streakReadOk || leads.length > 0

      let maxDate: string | null = null
      for (const l of leads) {
        const iso = streakLeadDay(l)
        if (!iso) continue
        if (!maxDate || iso > maxDate) maxDate = iso
      }
      const staleDays = maxDate ? daysBetween(maxDate, today) : null
      feeds.push({
        name: st.name,
        tab: st.tab,
        maxDate,
        rowCount: leads.length,
        staleDays,
        status: dailyStatus(staleDays),
        note: st.note,
      })
    } catch (e) {
      feeds.push({
        name: st.name,
        tab: st.tab,
        maxDate: null,
        rowCount: 0,
        staleDays: null,
        status: failStatus(dS),
        error: e instanceof Error ? e.message : String(e),
        note: dS.signal.aborted ? TIMEOUT_NOTE : st.note,
      })
    } finally {
      dS.clear()
    }
  }

  // The union + day + channel rule, identical to /api/funnel and to the Overview tiles.
  // Only claim lead numbers when at least one of the two tabs actually answered — a pair of
  // failed reads must read as "no measurement", never as 0 leads.
  if (streakReadOk) {
    const windowLeads = filterStreakByDay(
      unionStreakRows(streakFullLeads, streakSyncLeads),
      monthStart,
      today
    )
    let fbLeads = 0
    let gLeads = 0
    let bLeads = 0
    let cLeads = 0
    for (const l of windowLeads) {
      const ch = leadChannelOf(l)
      if (ch === 'meta') fbLeads++
      else if (ch === 'google') gLeads++
      else if (ch === 'bing') bLeads++
      else if (ch === 'chatgpt') cLeads++
    }
    fbCrmLeads = fbLeads
    // Paid GOOGLE only. Bing and ChatGPT leads arrive on platform=google (Streak tags both
    // PAID_SEARCH) and used to be counted here, so Google's lead count carried 10 leads it
    // never bought — they now have their own two counters below.
    googleCrmLeads = gLeads
    bingCrmLeads = bLeads
    chatgptCrmLeads = cLeads
    totalCrmLeads = windowLeads.length
  }

  // -- 4/5  fb_ads_enriched — KNOWN DEAD since 2026-08-09 --------------------
  // Capped at amber on purpose: it is a stale feed we have already replaced for
  // spend, but leads and LP views still come from it, so it must not vanish from
  // the report either. The day it starts producing rows again, this goes green.
  const d4 = deadline()
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.FB_ENRICHED, signal: d4.signal, bypassCache: true })
    const enriched = mapFbEnriched(rows || [])
    let maxDate: string | null = null
    for (const r of enriched) {
      const iso = toIsoDay(r.date_iso || r.date_start)
      if (!iso) continue
      if (!maxDate || iso > maxDate) maxDate = iso
    }
    const staleDays = maxDate ? daysBetween(maxDate, today) : null
    const live = dailyStatus(staleDays) === 'green'
    feeds.push({
      name: 'Facebook enriched (leads / LP views)',
      tab: SHEETS_TABS.FB_ENRICHED,
      maxDate,
      rowCount: enriched.length,
      staleDays,
      status: live ? 'green' : 'amber',
      note: live
        ? undefined
        : 'Znano mrtev feed (zadnje vrstice 9.8.2026). Spend je že prevzel fb_ads_api; leads in LP views tu še vedno manjkajo. Amber, ne red — je znano stanje, ne novica.',
    })
  } catch (e) {
    feeds.push({
      name: 'Facebook enriched (leads / LP views)',
      tab: SHEETS_TABS.FB_ENRICHED,
      maxDate: null,
      rowCount: 0,
      staleDays: null,
      status: d4.signal.aborted ? 'unknown' : 'amber',
      error: e instanceof Error ? e.message : String(e),
      note: d4.signal.aborted ? TIMEOUT_NOTE : 'Znan problematičen feed — napaka pri branju ne dvigne resnosti.',
    })
  } finally {
    d4.clear()
  }

  // -- 5/5  bookings_api — MONTHLY grain, not daily --------------------------
  // booking_date is "YYYY-MM". Never compare it to a day string; that is exactly
  // the bug that zeroed revenue for eight days.
  const d5 = deadline()
  try {
    const bookings = await fetchBookings((a) => fetchSheet({ ...a, signal: d5.signal, bypassCache: true }))
    // fetchBookings swallows its own errors and returns [], so an aborted read looks
    // like "no bookings". Say so out loud instead of reporting a quiet, wrong zero.
    if (d5.signal.aborted) throw new Error('bookings read aborted')
    let maxMonth: string | null = null
    let revenue = 0
    let count = 0
    for (const b of bookings) {
      const m = String(b.booking_date || '').slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(m)) continue
      if (!maxMonth || m > maxMonth) maxMonth = m
      if (m === currentMonth) {
        revenue += Number(b.rvc) || 0
        count++
      }
    }
    mtdRevenue = revenue
    bookingCount = count

    // "Is the current month present?" only becomes a fair question a few days in,
    // and only if we actually spent money. A quiet 1st of the month is not a fault.
    const spentSomething = (fbSpend ?? 0) + (googleSpend ?? 0) > 0
    const monthMissing = maxMonth !== currentMonth
    const status: Status = dayOfMonth >= 3 && spentSomething && monthMissing ? 'amber' : 'green'
    feeds.push({
      name: 'Bookings (monthly)',
      tab: SHEETS_TABS.BOOKINGS,
      maxDate: maxMonth,
      rowCount: bookings.length,
      staleDays: null,
      status,
      note:
        status === 'amber'
          ? `Tekoči mesec ${currentMonth} še nima nobene vrstice, čeprav je ${dayOfMonth}. v mesecu in poraba teče. Mesečna zrnatost (YYYY-MM), zato ni staleDays.`
          : 'Mesečna zrnatost (YYYY-MM) — staleDays se ne meri.',
    })
  } catch (e) {
    mtdRevenue = null
    bookingCount = null
    feeds.push({
      name: 'Bookings (monthly)',
      tab: SHEETS_TABS.BOOKINGS,
      maxDate: null,
      rowCount: 0,
      staleDays: null,
      status: failStatus(d5),
      error: e instanceof Error ? e.message : String(e),
      note: d5.signal.aborted ? TIMEOUT_NOTE : undefined,
    })
  } finally {
    d5.clear()
  }

  // ---------------------------------------------------------------------------
  // sanity rules — the cross-feed checks no single feed can make
  // ---------------------------------------------------------------------------

  // All four paid channels, exactly like the Overview's "Total Spend" tile. Bing and ChatGPT
  // contribute only once their tab answers; an unread tab adds nothing rather than a false 0.
  const mtdSpend = (fbSpend ?? 0) + (googleSpend ?? 0) + (bingSpend ?? 0) + (chatgptSpend ?? 0)
  const roas = mtdSpend > 0 && mtdRevenue != null ? mtdRevenue / mtdSpend : 0
  const eur = (n: number) => `€${Math.round(n).toLocaleString('sl-SI')}`

  if (mtdRevenue === 0 && mtdSpend > 5000) {
    violations.push({
      rule: 'revenue_zero_with_spend',
      severity: 'red',
      detail: `Prihodek MTD je 0, poraba MTD pa ${eur(mtdSpend)}. Točno ta vzorec je 8 dni kazal ROAS 0 — najprej preveri, ali bookings filter primerja mesec (YYYY-MM) in ne dneva.`,
    })
  }

  if (fbSpend === 0 && (fbCrmLeads ?? 0) > 0) {
    violations.push({
      rule: 'fb_spend_zero_with_leads',
      severity: 'red',
      detail: `FB poraba MTD je 0, a Streak v istem oknu beleži ${fbCrmLeads} FB leadov. Leadi brez porabe pomenijo mrtev spend feed, ne poceni oglase.`,
    })
  }

  if (roas === 0 && mtdSpend > 0) {
    violations.push({
      rule: 'roas_zero_with_spend',
      severity: 'red',
      detail: `ROAS je 0 pri porabi ${eur(mtdSpend)} MTD (${bookingCount ?? 0} bookingov v ${currentMonth}).`,
    })
  }

  if (googlePlatformLeads === 0 && (googleCrmLeads ?? 0) > 0) {
    violations.push({
      rule: 'google_platform_leads_zero',
      severity: 'amber',
      detail: `Google prijavlja 0 konverzij MTD, Streak pa ${googleCrmLeads} Google leadov. Tipično: uvoz konverzij ali gclid je padel.`,
    })
  }

  // mtd-data.json is a STATIC build artefact (code/goolets/build-mtd-data.js) that
  // /facebook-ads renders. It can go stale silently while every live feed is fine.
  const mtd = mtdData as { builtAt?: string; window?: { since?: string; until?: string } }
  const builtAt = mtd?.builtAt ? Date.parse(mtd.builtAt) : NaN
  const builtAgeHours = Number.isNaN(builtAt) ? null : (Date.now() - builtAt) / 3_600_000
  if (builtAgeHours == null) {
    violations.push({
      rule: 'mtd_builtat_missing',
      severity: 'amber',
      detail: 'src/data/mtd-data.json nima berljivega builtAt — ne vem, kdaj je bil zgrajen.',
    })
  } else if (builtAgeHours > 36) {
    violations.push({
      rule: 'mtd_data_stale',
      severity: 'amber',
      detail: `mtd-data.json je star ${Math.round(builtAgeHours)} h (builtAt ${mtd.builtAt}). /facebook-ads riše ta posnetek, ne živih podatkov.`,
    })
  }
  const until = mtd?.window?.until
  if (until && until < yesterday) {
    violations.push({
      rule: 'mtd_window_behind',
      severity: 'amber',
      detail: `mtd-data.json pokriva do ${until}, včeraj je bilo ${yesterday}. Okno zaostaja.`,
    })
  }

  // ---------------------------------------------------------------------------
  // verdict
  // ---------------------------------------------------------------------------

  // A tab we could not read rolls up to red: an unread feed hides exactly the kind of
  // breakage this route exists to surface, so it must never look calmer than a bad one.
  let overall: Status = 'green'
  for (const f of feeds) overall = worse(overall, f.status === 'unknown' ? 'red' : f.status)
  for (const v of violations) overall = worse(overall, v.severity)

  return NextResponse.json(
    {
      overall,
      checkedAt: new Date().toISOString(),
      timezone: TZ,
      today,
      window: { since: monthStart, until: today },
      feeds,
      violations,
      mtd: {
        spend: round2(mtdSpend),
        fbSpend: fbSpend == null ? null : round2(fbSpend),
        googleSpend: googleSpend == null ? null : round2(googleSpend),
        bingSpend: bingSpend == null ? null : round2(bingSpend),
        chatgptSpend: chatgptSpend == null ? null : round2(chatgptSpend),
        revenue: mtdRevenue,
        roas: round2(roas),
        bookings: bookingCount,
        fbCrmLeads,
        googleCrmLeads,
        bingCrmLeads,
        chatgptCrmLeads,
        // Every paid Streak lead in the window — the same number the Overview's "Total Leads"
        // tile and /api/funnel?range=this_month report, by construction (one loader, one day
        // rule, one channel rule: lib/streak-leads.ts).
        totalCrmLeads,
        crmLeadSource: `${SHEETS_TABS.STREAK_FULL} ∪ ${SHEETS_TABS.STREAK_SYNC}`,
        googlePlatformLeads: googlePlatformLeads == null ? null : round2(googlePlatformLeads),
      },
      mtdDataJson: {
        builtAt: mtd?.builtAt ?? null,
        ageHours: builtAgeHours == null ? null : round2(builtAgeHours),
        window: mtd?.window ?? null,
      },
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
