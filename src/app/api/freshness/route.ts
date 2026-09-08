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
} from '@/lib/sheetsData'
import mtdData from '@/data/mtd-data.json'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

type Status = 'green' | 'amber' | 'red'

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

const RANK: Record<Status, number> = { green: 0, amber: 1, red: 2 }
const worse = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b)

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
  let googlePlatformLeads: number | null = null
  let googleCrmLeads: number | null = null
  let fbCrmLeads: number | null = null
  let mtdRevenue: number | null = null
  let bookingCount: number | null = null

  // -- 1/5  fb_ads_api — authoritative daily FB spend, straight from Meta -----
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.FB_SPEND_DAILY })
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
      status: 'red',
      error: e instanceof Error ? e.message : String(e),
    })
  }

  // -- 2/5  daily_api — Google Ads daily -------------------------------------
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.DAILY })
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
      status: 'red',
      error: e instanceof Error ? e.message : String(e),
    })
  }

  // -- 3/5  streak_sync — the CRM side of every lead -------------------------
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.STREAK_SYNC })
    const leads = mapStreakLeads(rows || [])

    let maxDate: string | null = null
    let fbLeads = 0
    let gLeads = 0
    for (const l of leads) {
      const iso = toIsoDay(l.inquiry_date)
      if (!iso) continue
      if (!maxDate || iso > maxDate) maxDate = iso
      if (iso >= monthStart && iso <= today) {
        const p = String(l.platform || '').toLowerCase()
        if (p === 'facebook') fbLeads++
        else if (p === 'google') gLeads++
      }
    }
    fbCrmLeads = fbLeads
    googleCrmLeads = gLeads
    const staleDays = maxDate ? daysBetween(maxDate, today) : null
    feeds.push({
      name: 'Streak CRM sync',
      tab: SHEETS_TABS.STREAK_SYNC,
      maxDate,
      rowCount: leads.length,
      staleDays,
      status: dailyStatus(staleDays),
    })
  } catch (e) {
    feeds.push({
      name: 'Streak CRM sync',
      tab: SHEETS_TABS.STREAK_SYNC,
      maxDate: null,
      rowCount: 0,
      staleDays: null,
      status: 'red',
      error: e instanceof Error ? e.message : String(e),
    })
  }

  // -- 4/5  fb_ads_enriched — KNOWN DEAD since 2026-08-09 --------------------
  // Capped at amber on purpose: it is a stale feed we have already replaced for
  // spend, but leads and LP views still come from it, so it must not vanish from
  // the report either. The day it starts producing rows again, this goes green.
  try {
    const rows = await fetchSheet({ sheetUrl: url, tab: SHEETS_TABS.FB_ENRICHED })
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
      status: 'amber',
      error: e instanceof Error ? e.message : String(e),
      note: 'Znano mrtev feed — napaka pri branju ne dvigne resnosti.',
    })
  }

  // -- 5/5  bookings_api — MONTHLY grain, not daily --------------------------
  // booking_date is "YYYY-MM". Never compare it to a day string; that is exactly
  // the bug that zeroed revenue for eight days.
  try {
    const bookings = await fetchBookings(fetchSheet)
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
    feeds.push({
      name: 'Bookings (monthly)',
      tab: SHEETS_TABS.BOOKINGS,
      maxDate: null,
      rowCount: 0,
      staleDays: null,
      status: 'red',
      error: e instanceof Error ? e.message : String(e),
    })
  }

  // ---------------------------------------------------------------------------
  // sanity rules — the cross-feed checks no single feed can make
  // ---------------------------------------------------------------------------

  const mtdSpend = (fbSpend ?? 0) + (googleSpend ?? 0)
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

  let overall: Status = 'green'
  for (const f of feeds) overall = worse(overall, f.status)
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
        revenue: mtdRevenue,
        roas: round2(roas),
        bookings: bookingCount,
        fbCrmLeads,
        googleCrmLeads,
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
