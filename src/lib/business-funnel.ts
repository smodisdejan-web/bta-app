// src/lib/business-funnel.ts
//
// Business Health Funnel — the master paid-media funnel for the Goolets Content Portal
// ("Business Health" tab) plus 6 campaign drill-downs. 100% live, no mock numbers:
// anything that cannot be computed from a real source comes back as `null`.
//
// Funnel (Dejan's business-health model, locked 2026-07-22, confirmed by Mitja):
//   Impressions → Clicks → LP views → Leads → QL (Streak AI ≥ 50) → Bookings (+ RVC)
//
// Sources (one date range for every step — start/end apply identically all the way down):
//   impressions / clicks / spend  → fb_ads_raw (the ONLY FB tab carrying impressions)
//                                   + daily_api (Google Ads API tab)
//   lpViews                       → ga4_landing_pages (sessions)
//   leads / ql                    → streak_sync (Streak is SSOT — never FB pixel counts)
//   bookings / revenue            → bookings_api (rvc IS already the commission — never × margin)
//
// Attribution of Streak leads to a campaign: Google leads by SOURCE DETAIL (= the Google
// campaign name, the only Google attribution key we get), Facebook leads by SOURCE
// PLACEMENT (the utm_content token; suffix = campaign, same convention fuzzy-match.ts uses).
// Whatever matches none of the 6 campaigns is reported as the unattributed remainder.

import { DEFAULT_WEB_APP_URL, getSheetsUrl, SHEETS_TABS } from './config'
import { isRelevantPage } from './ga4-landing-pages'
import { matchSourceToCampaign } from './fuzzy-match'

// ─── Campaign registry ──────────────────────────────────────────────────────
//
// One regex family per campaign, applied to every entity axis so spend, leads and
// bookings are scoped by the same rule. Derived by inspecting the LIVE entity names
// in fb_ads_raw / daily_api / streak_sync.SOURCE PLACEMENT / bookings_api.campaign
// (2026-08-06) — not guessed. See the route's doc block for the mapping table.

export interface CampaignDef {
  slug: string
  name: string
  /** FB campaign_name (fb_ads_raw) */
  fb: RegExp | null
  /** Google Ads campaign name (daily_api) */
  google: RegExp | null
  /** Streak SOURCE PLACEMENT — Facebook leads */
  sp: RegExp | null
  /** Streak SOURCE DETAIL — Google leads (Streak stores the campaign name here) */
  googleDetail: RegExp | null
  /** GA4 landingPage path */
  lp: RegExp | null
  /** bookings_api.campaign */
  booking: RegExp | null
  /** Why lpViews is null, when it is */
  lpNote?: string
}

export const CAMPAIGNS: CampaignDef[] = [
  {
    slug: 'clg',
    name: 'Croatia Luxury Gulet',
    fb: /cro\s*lux\s*gulet/i,
    google: /^\s*clg\b/i,
    sp: /cro-lux|(^|_)clg(_|$)/i,
    googleDetail: /^\s*clg\b/i,
    // croatialuxurygulet.com is dual-tagged into the goolets GA4 property, so only the
    // CLG-unique path resolves. LP-B (/luxury-yacht-charters-at-unmatched-value) shares its
    // path with the goolets.net original and cannot be separated in this feed → understated.
    lp: /^\/luxury-yacht-charter-in-croatia\b/i,
    booking: /cro\s*lux\s*gulet|^\s*clg\b/i,
    lpNote: 'LP-B shares its path with the goolets.net page of the same name — CLG LP views are the LP-A path only',
  },
  {
    slug: 'dalmatincki',
    name: 'Dalmatinčki',
    // "Dalmatinčki" is an umbrella: the Julij/Nocturno/Dalmatino/RareOps-Dalmatino
    // campaigns all carry the `…_last-minute-dalmatinčki` utm suffix.
    fb: /dalmatin|nocturno/i,
    google: null,
    sp: /dalmatin/i,
    googleDetail: null,
    lp: /^\/(smart-luxury-sailing|sail-smarter|exclusive-seasonal-selection|motor-sailing-yachts-exclusive-seasonal-selection|luxury-motor-sailing-yacht-(dalmatino|nocturno)|rare-opportunit)/i,
    booking: /dalmatin/i,
  },
  {
    slug: 'earlybook',
    name: 'Early Booking Mini Cruisers',
    fb: /early\s*booking/i,
    google: null,
    sp: /^earlybook2027|^early-booking/i,
    googleDetail: null,
    lp: /^\/private-yacht-charters-in-croatia-2027\b/i,
    booking: /early\s*booking/i,
  },
  {
    slug: 'turkey',
    name: 'Guleti Turčija',
    // Same token set as TURKEY_CONFIG.campaignPatterns in lib/turkey-campaign.ts.
    fb: /turkey|tosca|belgin|esma/i,
    google: /turkey/i,
    sp: /turkey|tosca|belgin|esma/i,
    googleDetail: /turkey/i,
    lp: /turkey|belgin|tosca|esma|arabella/i,
    booking: /turkey|tosca|belgin|esma/i,
  },
  {
    slug: 'smarter',
    name: 'Smarter Way of Yachting',
    // "the smarter way" only — must NOT swallow "Test - Dalmatinčki - Sail Smarter".
    fb: /the\s*smarter\s*way/i,
    google: null,
    sp: /^alessandro_smarter|smarter[-_\s]way/i,
    googleDetail: null,
    lp: /^\/alessandro-the-smarter-way/i,
    booking: /the\s*smarter\s*way/i,
  },
  {
    slug: 'dobrik',
    name: 'David Dobrik',
    fb: /dobrik/i,
    google: /dobrik/i,
    sp: /^dobrik/i,
    googleDetail: /dobrik/i,
    lp: /^\/dobrik-/i,
    booking: /dobrik/i,
  },
]

// Attribution order — most specific first. Turkey before Dalmatinčki so a
// `…_tosca_…` placement never falls through to the umbrella.
const ATTRIBUTION_ORDER = ['turkey', 'dobrik', 'clg', 'earlybook', 'smarter', 'dalmatincki']
const ORDERED = ATTRIBUTION_ORDER.map((s) => CAMPAIGNS.find((c) => c.slug === s)!).filter(Boolean)

export const QL_THRESHOLD = 50

// ─── Small helpers ──────────────────────────────────────────────────────────

const SHEET_URL = () => getSheetsUrl() || DEFAULT_WEB_APP_URL

const num = (v: any): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const x = Number(String(v ?? '').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(x) ? x : 0
}

/**
 * Normalise every date shape the feeds throw at us to YYYY-MM-DD (Europe/Ljubljana day).
 * fb_ads_raw stores `date_start` as the previous day at 22:00Z — the same +2h offset the
 * enriched tab already resolves into `date_iso`, so we resolve it identically here.
 */
export function toDay(v: any): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Google Sheets serial (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (s.includes('T')) {
    const d = new Date(s)
    if (Number.isNaN(+d)) return s.slice(0, 10)
    // 22:00Z / 23:00Z means "the next day, Ljubljana". +4h lands any such stamp on the
    // right calendar day without disturbing midnight-based stamps.
    return new Date(+d + 4 * 3600_000).toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return Number.isNaN(+d) ? '' : d.toISOString().slice(0, 10)
}

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

const daysBetween = (a: string, b: string): number =>
  Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1

/** Days of a source's coverage that fall inside [from,to]. */
function overlapDays(cov: Coverage, from: string, to: string): number {
  if (!cov.min || !cov.max) return 0
  const lo = cov.min > from ? cov.min : from
  const hi = cov.max < to ? cov.max : to
  if (lo > hi) return 0
  return daysBetween(lo, hi)
}

// ─── Fetching (object rows, with retry + module-level TTL cache) ────────────
//
// The portal calls this endpoint 7× (master + 6 drill-downs). Parsing the 27 MB GA4 tab
// and the 4 MB fb_ads_raw tab once per warm lambda instead of once per request is the
// difference between "instant" and "times out".

const TTL_MS = 15 * 60 * 1000
const memo = new Map<string, { at: number; data: any }>()
const inflight = new Map<string, Promise<any>>()

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const p = fn()
    .then((data) => {
      memo.set(key, { at: Date.now(), data })
      inflight.delete(key)
      return data
    })
    .catch((e) => {
      inflight.delete(key)
      // Serve stale rather than blow up the whole funnel on one flaky Apps Script call.
      if (hit) {
        console.warn(`[funnel] ${key} failed, serving stale`, (e as Error).message)
        return hit.data as T
      }
      throw e
    })
  inflight.set(key, p)
  return p
}

/** Fetch a tab as an array of objects. Handles both response shapes the web app emits. */
async function fetchRows(tab: string): Promise<any[]> {
  const url = `${SHEET_URL()}?tab=${encodeURIComponent(tab)}`
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } })
      if (!res.ok) {
        lastErr = new Error(`${tab}: ${res.status} ${res.statusText}`)
      } else {
        const data = await res.json()
        if (!Array.isArray(data) || data.length === 0) return []
        if (Array.isArray(data[0])) {
          const header = (data[0] as any[]).map((h) => String(h))
          return (data as any[][]).slice(1).map((r) => {
            const o: Record<string, any> = {}
            header.forEach((h, i) => (o[h] = r[i]))
            return o
          })
        }
        return data as any[]
      }
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${tab}`)
}

/** Find a column key by regex across the whole row object (feeds use dotted API paths). */
function keyOf(sample: Record<string, any>, ...res: RegExp[]): string | null {
  const keys = Object.keys(sample)
  for (const re of res) {
    const k = keys.find((x) => re.test(x))
    if (k) return k
  }
  return null
}

export interface Coverage {
  min: string
  max: string
}
interface AdDay {
  day: string
  campaign: string
  impressions: number
  clicks: number
  spend: number
}
interface LpDay {
  day: string
  lp: string
  /** from GA4 sessionSourceMedium — 'other' = organic / direct / referral / email */
  channel: 'meta' | 'google' | 'other'
  sessions: number
}
interface LeadRow {
  day: string
  sp: string
  detail: string
  isGoogle: boolean
  /** streak_sync.platform — 'facebook' | 'google'. The channel-split key. */
  platform: string
  ai: number
}
interface BookingRow {
  month: string
  campaign: string
  rvc: number
  /** bookings_api.source — 'fb_landing' | 'fb_lead' | 'google'. The channel-split key. */
  source: string
}

function coverageOf(days: string[]): Coverage {
  let min = '', max = ''
  for (const d of days) {
    if (!d) continue
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  return { min, max }
}

/** FB: fb_ads_raw is the only FB tab with impressions. Campaign × day. */
async function loadFb(): Promise<{ rows: AdDay[]; coverage: Coverage }> {
  return cached('fb', async () => {
    const raw = await fetchRows(SHEETS_TABS.FB_RAW)
    if (!raw.length) return { rows: [], coverage: { min: '', max: '' } }
    const s = raw[0]
    const kC = keyOf(s, /campaign_name$/i)
    const kD = keyOf(s, /date_start$/i)
    const kI = keyOf(s, /\bimpressions$/i)
    const kK = keyOf(s, /(^|\.)clicks$/i)
    const kS = keyOf(s, /(^|\.)spend$/i)
    const rows: AdDay[] = []
    for (const r of raw) {
      const campaign = String((kC && r[kC]) ?? '')
      const day = toDay(kD ? r[kD] : '')
      if (!campaign || !day) continue
      rows.push({
        day,
        campaign,
        impressions: kI ? num(r[kI]) : 0,
        clicks: kK ? num(r[kK]) : 0,
        spend: kS ? num(r[kS]) : 0,
      })
    }
    return { rows, coverage: coverageOf(rows.map((r) => r.day)) }
  })
}

/** Google: daily_api (Google Ads API tab). Campaign × day. */
async function loadGoogle(): Promise<{ rows: AdDay[]; coverage: Coverage }> {
  return cached('google', async () => {
    const raw = await fetchRows(SHEETS_TABS.DAILY)
    if (!raw.length) return { rows: [], coverage: { min: '', max: '' } }
    const rows: AdDay[] = []
    for (const r of raw) {
      const campaign = String(r.campaign ?? '')
      const day = toDay(r.date)
      if (!campaign || !day) continue
      rows.push({
        day,
        campaign,
        impressions: num(r.impr),
        clicks: num(r.clicks),
        spend: num(r.cost),
      })
    }
    return { rows, coverage: coverageOf(rows.map((r) => r.day)) }
  })
}

/**
 * GA4 `sessionSourceMedium` -> channel. Same rule turkey-kpis/route.ts applies: a session
 * counts as paid only if the source/medium carries a paid|cpc|ppc token, and it then splits
 * by platform. Everything else (organic, direct, referral, email, unpaid social) is 'other'
 * and therefore only ever appears in the All view.
 *   'facebook / paid', 'facebook / paid_social', 'facebook / paidsocial' -> meta
 *   'google / cpc', 'adwords / ppc'                                     -> google
 */
function ga4Channel(sourceMedium: string): 'meta' | 'google' | 'other' {
  const s = (sourceMedium || '').toLowerCase()
  if (!/paid|cpc|ppc/.test(s)) return 'other'
  if (/face|insta|fb|meta|social/.test(s)) return 'meta'
  if (/google|adwords|search|bing/.test(s)) return 'google'
  return 'other'
}

/** GA4 landing-page sessions, pre-collapsed over device to keep memory sane. */
async function loadGa4(): Promise<{ rows: LpDay[]; coverage: Coverage }> {
  return cached('ga4', async () => {
    const raw = await fetchRows(SHEETS_TABS.GA4_LANDING_PAGES)
    const agg = new Map<string, number>()
    for (const r of raw) {
      const lp = String(r.landingPage ?? '')
      const day = toDay(r.date)
      if (!lp || !day || !isRelevantPage(lp)) continue
      // Fixed-width prefix: 10-char day + channel, then '|', then the path. Parsed by
      // offset, so a landing path containing the delimiter cannot corrupt the split.
      const k = `${day}${ga4Channel(String(r.sessionSourceMedium ?? ''))}|${lp}`
      agg.set(k, (agg.get(k) || 0) + num(r.sessions))
    }
    const rows: LpDay[] = []
    for (const [k, sessions] of agg) {
      const sep = k.indexOf('|')
      rows.push({
        day: k.slice(0, 10),
        channel: k.slice(10, sep) as LpDay['channel'],
        lp: k.slice(sep + 1),
        sessions,
      })
    }
    return { rows, coverage: coverageOf(rows.map((r) => r.day)) }
  })
}

/** Streak leads — the single source of truth for lead counts. */
async function loadStreak(): Promise<{ rows: LeadRow[]; coverage: Coverage }> {
  return cached('streak', async () => {
    const raw = await fetchRows(SHEETS_TABS.STREAK_SYNC)
    const rows: LeadRow[] = []
    for (const r of raw) {
      const day = toDay(r['Inquiry Recieved'] ?? r.inquiry_recieved)
      if (!day) continue
      const platform = String(r.platform ?? '').toLowerCase()
      const cat = String(r['LATEST SOURCE CATEGORY'] ?? '')
      rows.push({
        day,
        sp: String(r['SOURCE PLACEMENT'] ?? '').toLowerCase(),
        detail: String(r['SOURCE DETAIL'] ?? '').toLowerCase(),
        isGoogle: /google|adwords/.test(platform) || /paid_search/i.test(cat),
        platform,
        ai: num(r.AI ?? r.ai),
      })
    }
    return { rows, coverage: coverageOf(rows.map((r) => r.day)) }
  })
}

/** Bookings + RVC. booking_date is month-granular (YYYY-MM) at source. */
async function loadBookings(): Promise<{ rows: BookingRow[]; coverage: Coverage }> {
  return cached('bookings', async () => {
    const raw = await fetchRows(SHEETS_TABS.BOOKINGS)
    const rows: BookingRow[] = []
    for (const r of raw) {
      const bd = String(r.booking_date ?? '')
      const month = bd.includes('T') ? toDay(bd).slice(0, 7) : bd.slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      rows.push({
        month,
        campaign: String(r.campaign ?? ''),
        rvc: num(r.rvc),
        source: String(r.source ?? '').toLowerCase().trim(),
      })
    }
    const months = rows.map((r) => r.month).sort()
    return {
      rows,
      coverage: {
        min: months.length ? `${months[0]}-01` : '',
        max: months.length ? monthEnd(months[months.length - 1]) : '',
      },
    }
  })
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// ─── Attribution ────────────────────────────────────────────────────────────

/** Which campaign a Streak lead belongs to, or null (the unattributed remainder). */
export function leadSlug(lead: LeadRow): string | null {
  for (const c of ORDERED) {
    if (lead.isGoogle) {
      if (c.googleDetail && c.googleDetail.test(lead.detail)) return c.slug
    } else {
      if (c.sp && c.sp.test(lead.sp)) return c.slug
    }
  }
  // Google leads sometimes carry the raw search term in SOURCE DETAIL rather than the
  // campaign name; fall back to the placement token before giving up.
  for (const c of ORDERED) {
    if (lead.isGoogle && c.sp && c.sp.test(lead.sp)) return c.slug
  }
  return null
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export interface RawStepValues {
  impressions: number | null
  clicks: number | null
  lpViews: number | null
  leads: number | null
  ql: number | null
  bookings: number | null
  revenue: number
  spend: number
}

interface Datasets {
  fb: { rows: AdDay[]; coverage: Coverage }
  google: { rows: AdDay[]; coverage: Coverage }
  ga4: { rows: LpDay[]; coverage: Coverage }
  streak: { rows: LeadRow[]; coverage: Coverage }
  bookings: { rows: BookingRow[]; coverage: Coverage }
}

/**
 * Channel split. `all` (the default) is the original both-channels behaviour and must stay
 * byte-identical to it. `meta` / `google` scope every step to one platform:
 *   ads      → fb_ads_raw vs daily_api (already separate feeds — we simply stop summing)
 *   leads/ql → streak_sync.platform
 *   bookings → bookings_api.source (fb_landing + fb_lead = meta)
 *   lpViews  → NOT SPLITTABLE. ga4_landing_pages carries no source/medium dimension, so a
 *              channel view returns null rather than an approximation.
 */
export type Channel = 'all' | 'meta' | 'google'

const leadChannel = (l: LeadRow): Channel | null =>
  /face|meta|instagram/.test(l.platform) ? 'meta' : /google|adwords/.test(l.platform) ? 'google' : null

const bookingChannel = (b: BookingRow): Channel | null =>
  b.source.startsWith('fb') ? 'meta' : b.source === 'google' ? 'google' : null

/** null-safe: a step is null only when NO source can answer it for this scope. */
function aggregate(
  ds: Datasets,
  def: CampaignDef | null,
  from: string,
  to: string,
  channel: Channel = 'all'
): RawStepValues {
  const inRange = (d: string) => d >= from && d <= to

  // ── Ads (impressions / clicks / spend) ──
  let impressions = 0
  let clicks = 0
  let spend = 0
  let adSources = 0
  if ((!def || def.fb) && channel !== 'google') {
    adSources++
    for (const r of ds.fb.rows) {
      if (!inRange(r.day)) continue
      if (def?.fb && !def.fb.test(r.campaign)) continue
      impressions += r.impressions
      clicks += r.clicks
      spend += r.spend
    }
  }
  if ((!def || def.google) && channel !== 'meta') {
    adSources++
    for (const r of ds.google.rows) {
      if (!inRange(r.day)) continue
      if (def?.google && !def.google.test(r.campaign)) continue
      impressions += r.impressions
      clicks += r.clicks
      spend += r.spend
    }
  }

  // ── LP views (GA4) ──
  // All view = every session on the page (paid + organic + direct + referral + email).
  // Channel view = that channel's PAID sessions only, per GA4 sessionSourceMedium. So
  // meta + google deliberately does NOT sum to All — the gap is the non-paid remainder.
  let lpViews: number | null = null
  if (!def || def.lp) {
    lpViews = 0
    for (const r of ds.ga4.rows) {
      if (!inRange(r.day)) continue
      if (channel !== 'all' && r.channel !== channel) continue
      if (def?.lp && !def.lp.test(r.lp)) continue
      lpViews += r.sessions
    }
  }

  // ── Leads / QL (Streak) ──
  let leads = 0
  let ql = 0
  for (const r of ds.streak.rows) {
    if (!inRange(r.day)) continue
    if (channel !== 'all' && leadChannel(r) !== channel) continue
    if (def && leadSlug(r) !== def.slug) continue
    leads++
    if (r.ai >= QL_THRESHOLD) ql++
  }

  // ── Bookings / RVC — month-granular at source (bookings_api.booking_date = YYYY-MM) ──
  const fromM = from.slice(0, 7)
  const toM = to.slice(0, 7)
  let bookings = 0
  let revenue = 0
  for (const r of ds.bookings.rows) {
    if (r.month < fromM || r.month > toM) continue
    if (channel !== 'all' && bookingChannel(r) !== channel) continue
    if (def && !(def.booking && def.booking.test(r.campaign))) continue
    bookings++
    revenue += r.rvc // RVC IS the commission — never multiply by a margin
  }

  return {
    impressions: adSources ? impressions : null,
    clicks: adSources ? clicks : null,
    lpViews,
    leads,
    ql,
    bookings,
    revenue,
    spend,
  }
}

/**
 * The non-paid GA4 bucket (organic, direct, referral, email, unpaid social) for the LP-views
 * step. This is the ONLY step where "other" is a real number: every other step's feed is
 * paid-only at source (streak_sync is filtered by StreakSync.gs, bookings_api has just
 * fb_landing / fb_lead / google), so "other" there is unknown, not zero.
 */
function otherLpViews(
  ds: Datasets,
  def: CampaignDef | null,
  from: string,
  to: string
): number | null {
  if (def && !def.lp) return null
  let n = 0
  for (const r of ds.ga4.rows) {
    if (r.day < from || r.day > to) continue
    if (r.channel !== 'other') continue
    if (def?.lp && !def.lp.test(r.lp)) continue
    n += r.sessions
  }
  return n
}

// ─── Real campaign breakdown inside an umbrella ─────────────────────────────
//
// Each of the 6 funnel slugs is an UMBRELLA over one or more real ad-platform campaigns.
// This resolves the umbrella into the exact platform campaign names — the same strings that
// live in fb_ads_raw / daily_api and in the Acq Channel sheet's Campaign column. Nothing is
// prettified or invented.
//
// Attribution per sub-row:
//   spend      — exact, straight from the ads feeds.
//   Google leads — Streak SOURCE DETAIL is the lowercased Google campaign name: exact match.
//   FB leads     — SOURCE PLACEMENT via lib/fuzzy-match.ts, restricted to this umbrella's
//                  campaigns. If the umbrella has exactly ONE live FB campaign, an umbrella
//                  lead can only have come from it, so it pins there by deduction.
//   bookings     — bookings_api.campaign already holds exact real names: exact match. A
//                  booking naming a campaign with no spend in range (a historic campaign)
//                  still gets its own row under its real name, with spend 0.
// Anything that lands in the umbrella but not on a single real campaign goes to the
// "(unassigned within funnel)" row — never guessed onto a campaign. Sub-rows always sum
// back to the umbrella totals.

export const UNASSIGNED = '(unassigned within funnel)'

/** lowercase, strip diacritics, drop every non-alphanumeric — so `Foo-Bar_Baz`, `foo bar baz`
 *  and `FOO-BAR-BAZ` all collapse to one key. Used to join Streak placements to entity names. */
const sqKey = (s: string): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')

/**
 * Streak SOURCE PLACEMENT → real campaign, resolved 2026-08-07 against the LIVE Meta entity
 * graph (ads_get_ad_entities on act 2422256151414958, 2026-05-09…2026-08-07: 1,000 ads and
 * 250 ad sets with their parent campaign_id). Every entry below is a case where the
 * placement token matches an entity that ran in EXACTLY ONE campaign in that window — a
 * deduction from the platform's own structure, not a naming guess. Placements whose creative
 * ran in two or more campaigns are deliberately absent and stay in UNASSIGNED; they are
 * listed for manual mapping in
 * context/analysis/2026-08-07-placement-campaign-mapping-todo.md.
 *
 * Evidence per block:
 *  A) AD-NAME JOIN — the placement equals an ad name verbatim (Goolets names ads with the
 *     utm_content string, uppercased), and that ad delivered under one campaign only.
 *  B) AD-SET JOIN — the placement's trailing token equals an ad-set name that exists under
 *     one campaign only (the Turkey creatives are named at ad-set, not ad, level).
 */
const PLACEMENT_CAMPAIGN: Record<string, string> = {
  // ── A) ad-name join ──────────────────────────────────────────────────────
  // ad "MAXITA-ONETAKE_VERTICAL_DESIRE_LAST-MINUTE-DALMATINČKI" → only campaign 120248841372660087
  maxitaonetakeverticaldesirelastminutedalmatincki: 'Dalmatinčki - Julij 2026',
  // ad "DALMATINO-SALES_VERTICAL_WAIT_LAST-MINUTE-DALMATINČKI" → only campaign 120248841372660087
  dalmatinosalesverticalwaitlastminutedalmatincki: 'Dalmatinčki - Julij 2026',
  // ads "SOCIAL-BEST_ANIMA-MARIS_..._-V2 / -V3" → only campaign 120248841372660087
  socialbestanimamarisverticalfearlastminutedalmatinckiv2: 'Dalmatinčki - Julij 2026',
  socialbestanimamarisverticalfearlastminutedalmatinckiv3: 'Dalmatinčki - Julij 2026',

  // ── B) ad-set join ───────────────────────────────────────────────────────
  // ad set "TEST – COLD T1 – La Bella Vita VO" (120248556119860087) → only campaign 120248554863610087
  turkeygeneralinteresilabellavitavo: 'TURKEY – Creative Test – ABO',
  // ad set "TEST – COLD T1 – Esma" (120248554863680087) → only campaign 120248554863610087
  turkeygeneralinteresiesmasultankids: 'TURKEY – Creative Test – ABO',
  // ad set "RTG – Calculator" (120248556476390087) → only campaign 120248556476340087
  turkeycalculatorretargetingbelginwalkthrough: 'TURKEY – Calculator - ABO',
  turkeycalculatorretargetingcalculator1: 'TURKEY – Calculator - ABO',

  // ── B2) `-jul` ad-set suffixes — APPROVED BY DEJAN 2026-08-07 ────────────
  // The trailing token names the ad set, which disambiguates a creative that ran in more than
  // one July campaign. Evidence from the same Meta entity pull:
  //   "Nocturno - Julij 2026" (120249645494250087) has NOCTURNO - Tier1 - Interests / Warm /
  //     Lookalike.  "Dalmatino - Julij 2026" (120249646512450087) has DALMATINO - Tier1 -
  //     Interests / Warm / Lookalike.  "Dalmatinčki - Julij 2026" (120248841372660087) has
  //     ONLY `* - Tier1 - Interests` ad sets — no Warm, no Lookalike.
  // So `-warm-jul` / `-lookalike-jul` can only have come from the dedicated per-vessel campaign.
  // `-int-jul` stays UNASSIGNED on purpose: both campaigns have an Interests ad set.
  nocturnoonetakeverticaldesirelastminutedalmatinckilookalikejul: 'Nocturno - Julij 2026',
  nocturnoonetakeverticaldesirelastminutedalmatinckiwarmjul: 'Nocturno - Julij 2026',
  nocturnoonetakeverticaldesirelastminutedalmatinckiv4lookalikejul: 'Nocturno - Julij 2026',
  nocturnoonetakeverticaldesirelastminutedalmatinckiv4warmjul: 'Nocturno - Julij 2026',
  dalmatinoofficialdalmationoverlookalikejul: 'Dalmatino - Julij 2026',
  dalmatinoofficialdalmationoverwarmjul: 'Dalmatino - Julij 2026',
}

export interface CampaignSubRow {
  name: string
  platform: 'meta' | 'google' | null
  spend: number
  leads: number | null
  ql: number | null
  bookings: number | null
  revenue: number | null
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * RareOps placements → their ASSET campaign, by VESSEL TOKEN.
 * Naming convention confirmed by Dejan 2026-08-07: a `rare-ops_*` placement carries the vessel
 * (dalmatino, anima-maris, tosca, …) and belongs to `ASSET – <Vessel> – RareOps – ABO`; the
 * `*-form1` twin belongs to `Prava forma - ASSET – <Vessel> – RareOps – ABO` (the CRO-004 form
 * test variant). A placement with no form marker maps to the BASE campaign, because the form
 * test's traffic always carries the marker.
 *
 * Vessels are read off the live campaign names rather than hardcoded, so a new RareOps vessel
 * campaign is picked up automatically. Returns null when the vessel is ambiguous or absent —
 * those stay in UNASSIGNED and get listed for manual mapping.
 */
function pinRareOps(sp: string, fbNames: string[]): string | null {
  const key = sqKey(sp)
  if (!key.startsWith('rareops')) return null
  const isFormVariant = /form\d/.test(key)

  const matches: string[] = []
  for (const name of fbNames) {
    // "ASSET – Anima Maris – RareOps – ABO" / "Prava forma - ASSET – TOSCA – RareOps – ABO"
    const m = name.match(/asset\s*[–—-]\s*(.+?)\s*[–—-]\s*rare\s*ops/i)
    if (!m) continue
    const vessel = sqKey(m[1])
    if (!vessel || !key.includes(vessel)) continue
    const isPravaForma = /^pravaforma/.test(sqKey(name))
    if (isPravaForma === isFormVariant) matches.push(name)
  }
  // Exactly one campaign for this vessel + form/base side, or we do not guess.
  return matches.length === 1 ? matches[0] : null
}

function campaignBreakdown(
  ds: Datasets,
  def: CampaignDef,
  from: string,
  to: string
): CampaignSubRow[] {
  const inRange = (d: string) => d >= from && d <= to
  const rows = new Map<string, CampaignSubRow>()
  const byNorm = new Map<string, string>() // normalised name → exact name (row key)

  const row = (name: string, platform: 'meta' | 'google' | null): CampaignSubRow => {
    let r = rows.get(name)
    if (!r) {
      r = { name, platform, spend: 0, leads: 0, ql: 0, bookings: 0, revenue: 0 }
      rows.set(name, r)
      if (name !== UNASSIGNED) byNorm.set(normName(name), name)
    } else if (r.platform == null && platform != null) {
      r.platform = platform
    }
    return r
  }

  // ── 1. Spend, by exact platform campaign name ──
  const fbNames: string[] = []
  if (def.fb) {
    for (const r of ds.fb.rows) {
      if (!inRange(r.day) || !def.fb.test(r.campaign)) continue
      const e = row(r.campaign, 'meta')
      e.spend += r.spend
      if (!fbNames.includes(r.campaign)) fbNames.push(r.campaign)
    }
  }
  const googleByNorm = new Map<string, string>()
  if (def.google) {
    for (const r of ds.google.rows) {
      if (!inRange(r.day) || !def.google.test(r.campaign)) continue
      row(r.campaign, 'google').spend += r.spend
      googleByNorm.set(normName(r.campaign), r.campaign)
    }
  }

  // ── 2. Leads + QL ──
  const spCache = new Map<string, string | null>()
  const pinFb = (sp: string): string | null => {
    if (fbNames.length === 0) return null
    if (fbNames.length === 1) return fbNames[0] // only one campaign it could be
    if (spCache.has(sp)) return spCache.get(sp)!
    // 1. Some placements ARE the campaign name verbatim ("dalmatinčki - abo - lf") — exact,
    //    no inference needed.
    let resolved: string | null = fbNames.find((n) => sqKey(n) === sqKey(sp)) || null
    // 2. Meta entity-graph resolution (ad / ad-set name unique to one campaign).
    const mapped = resolved ? null : PLACEMENT_CAMPAIGN[sqKey(sp)]
    if (mapped) {
      const k = sqKey(mapped)
      resolved = fbNames.find((n) => sqKey(n) === k) || null
    }
    // 3. RareOps vessel-token convention (Dejan-confirmed 2026-08-07).
    if (!resolved) resolved = pinRareOps(sp, fbNames)
    // 4. Fall back to the prefix rules in lib/fuzzy-match.ts.
    if (!resolved) {
      const hit = matchSourceToCampaign(sp, fbNames)
      resolved = hit && fbNames.includes(hit) ? hit : null
    }
    spCache.set(sp, resolved)
    return resolved
  }

  for (const l of ds.streak.rows) {
    if (!inRange(l.day)) continue
    if (leadSlug(l) !== def.slug) continue
    const name = l.isGoogle
      ? googleByNorm.get(normName(l.detail)) || null
      : pinFb(l.sp)
    const e = name ? row(name, l.isGoogle ? 'google' : 'meta') : row(UNASSIGNED, null)
    e.leads = (e.leads || 0) + 1
    if (l.ai >= QL_THRESHOLD) e.ql = (e.ql || 0) + 1
  }

  // ── 3. Bookings + RVC ──
  const fromM = from.slice(0, 7)
  const toM = to.slice(0, 7)
  for (const b of ds.bookings.rows) {
    if (b.month < fromM || b.month > toM) continue
    if (!(def.booking && def.booking.test(b.campaign))) continue
    const exact = byNorm.get(normName(b.campaign))
    let e: CampaignSubRow
    if (exact) {
      e = rows.get(exact)!
    } else if (b.campaign.trim()) {
      // A real campaign name the ads feeds no longer carry (historic campaign, or spend
      // outside this range). Keep the real name; spend stays 0.
      e = row(b.campaign.trim(), bookingChannel(b))
    } else {
      e = row(UNASSIGNED, null)
    }
    e.bookings = (e.bookings || 0) + 1
    e.revenue = (e.revenue || 0) + b.rvc
  }

  return [...rows.values()]
    .filter((r) => r.spend > 0 || (r.leads || 0) > 0 || (r.bookings || 0) > 0)
    .sort((a, b) => b.spend - a.spend || (b.leads || 0) - (a.leads || 0))
}

// ─── Benchmarks ─────────────────────────────────────────────────────────────
//
// The benchmark for a step is THIS ACCOUNT'S OWN historical conversion rate for that step,
// measured over the trailing 12 months ENDING THE DAY BEFORE the requested range (so the
// window being graded is never part of its own benchmark), clipped to whatever history the
// feed actually holds. If any source feeding the step has fewer than MIN_HISTORY_DAYS of
// data in that window — or a zero denominator — the benchmark is null and status is null.
// Nothing is ever hardcoded.

const BENCH_LOOKBACK_DAYS = 365
const MIN_HISTORY_DAYS = 21

type SourceKey = 'fb' | 'google' | 'ga4' | 'streak' | 'bookings'

const STEP_SOURCES: Record<string, SourceKey[]> = {
  impressions: ['fb', 'google'],
  clicks: ['fb', 'google'],
  lpViews: ['ga4', 'fb', 'google'],
  leads: ['streak', 'ga4'],
  ql: ['streak'],
  bookings: ['bookings', 'streak'],
}

function sourcesUsed(
  def: CampaignDef | null,
  keys: SourceKey[],
  channel: Channel = 'all'
): SourceKey[] {
  return keys.filter((k) => {
    if (k === 'fb' && channel === 'google') return false
    if (k === 'google' && channel === 'meta') return false
    if (!def) return true
    if (k === 'fb') return !!def.fb
    if (k === 'google') return !!def.google
    if (k === 'ga4') return !!def.lp
    return true
  })
}

// ─── Public shape ───────────────────────────────────────────────────────────

export interface FunnelStep {
  key: string
  label: string
  value: number | null
  cvrFromPrev: number | null
  benchmarkCvr: number | null
  status: 'g' | 'a' | 'r' | null
  source: string
  revenue?: number
  /** Only present when the natural previous step is null and a different denominator was
   *  used (today: leads measured off clicks because a channel view cannot split LP views). */
  cvrBasis?: string
  /** Per-step channel split. Present on all-channel views (master and campaign); omitted on
   *  ?channel= views, which are already single-channel. */
  channels?: FunnelStepChannel[]
}

export interface FunnelStepChannel {
  key: 'meta' | 'google' | 'other'
  label: string
  /** This channel's count for this step. null = the source cannot answer it. */
  value: number | null
  /** value ÷ this step's total in the CURRENT view. */
  share: number | null
  /** NEXT step's value for this channel ÷ THIS step's value (mirror of cvrFromPrev, one down). */
  cvrToNext: number | null
  benchmarkCvr: number | null
  status: 'g' | 'a' | 'r' | null
  /** false = the feed genuinely cannot answer this (portal renders "source in progress"). */
  available: boolean
  /** Bookings step only: that channel's RVC in €, so the portal can show counts + money
   *  rather than shares alone. null where the feed cannot answer it. */
  revenue?: number | null
  /** Bookings step only: that channel's ad spend in € over the range. null for "other" —
   *  organic/direct has no paid-spend concept, and 0 would read as "free", which is a claim
   *  the data does not make. */
  spend?: number | null
  /** Bookings step only: revenue ÷ spend. null when spend is 0 or unknown. */
  roas?: number | null
}

const CHANNEL_LABELS = [
  { key: 'meta', label: 'Paid Meta' },
  { key: 'google', label: 'Paid Google' },
  { key: 'other', label: 'Organic + Direct' },
] as const

export interface FunnelResponse {
  meta: Record<string, unknown>
  campaigns: { slug: string; name: string }[]
  steps: FunnelStep[]
  efficiency: {
    spend: number
    cpm: number | null
    cpc: number | null
    cpl: number | null
    cpql: number | null
    costPerBooking: number | null
    roas: number | null
  }
  targets: null
  retention: { available: false; note: string }
  attribution: { unattributedLeads: number; unattributedShare: number }
  campaignSummary:
    | {
        slug: string
        name: string
        spend: number
        leads: number
        ql: number
        bookings: number
        revenue: number
        campaigns: CampaignSubRow[]
      }[]
    | null
}

const STEP_DEFS = [
  { key: 'impressions', label: 'Impressions', source: 'Meta + Google Ads' },
  { key: 'clicks', label: 'Clicks', source: 'Meta + Google Ads' },
  { key: 'lpViews', label: 'LP Views', source: 'GA4' },
  { key: 'leads', label: 'Leads', source: 'Streak' },
  { key: 'ql', label: 'Quality Leads', source: 'Streak · AI≥50' },
  { key: 'bookings', label: 'Bookings', source: 'Streak' },
] as const

const div = (a: number | null, b: number | null): number | null =>
  a == null || b == null || b === 0 ? null : a / b

function statusFor(cvr: number | null, bench: number | null): 'g' | 'a' | 'r' | null {
  if (bench == null || bench === 0 || cvr == null) return null
  const ratio = cvr / bench
  if (ratio >= 0.95) return 'g'
  if (ratio >= 0.8) return 'a'
  return 'r'
}

export async function loadBusinessFunnel(opts: {
  start: string
  end: string
  campaign: string
  channel?: Channel
}): Promise<FunnelResponse> {
  const { start, end } = opts
  const channel: Channel = opts.channel || 'all'
  const slug = opts.campaign && opts.campaign !== 'master' ? opts.campaign : 'master'
  const def = slug === 'master' ? null : CAMPAIGNS.find((c) => c.slug === slug) || null
  if (slug !== 'master' && !def) throw new Error(`Unknown campaign "${slug}"`)

  const [fb, google, ga4, streak, bookings] = await Promise.all([
    loadFb(),
    loadGoogle(),
    loadGa4(),
    loadStreak(),
    loadBookings(),
  ])
  const ds: Datasets = { fb, google, ga4, streak, bookings }
  const coverage: Record<SourceKey, Coverage> = {
    fb: fb.coverage,
    google: google.coverage,
    ga4: ga4.coverage,
    streak: streak.coverage,
    bookings: bookings.coverage,
  }

  const cur = aggregate(ds, def, start, end, channel)

  // ── History window for the benchmarks ──
  const histEnd = addDays(start, -1)
  const histStart = addDays(start, -BENCH_LOOKBACK_DAYS)

  // A step's benchmark is only meaningful when its numerator and denominator are measured
  // over the SAME days, so the window is clipped to the intersection of every source the
  // step uses. Without this, e.g. bookings (synced since Oct 2025) would be divided by QL
  // (Streak feed starts May 2026) and the benchmark would be nonsense.
  const histCache = new Map<string, RawStepValues>()
  const histFor = (from: string, to: string) => {
    const k = `${from}|${to}`
    let v = histCache.get(k)
    if (!v) {
      v = aggregate(ds, def, from, to, channel)
      histCache.set(k, v)
    }
    return v
  }
  function histWindow(used: SourceKey[]): { from: string; to: string } | null {
    let from = histStart
    let to = histEnd
    for (const k of used) {
      const c = coverage[k]
      if (!c?.min || !c?.max) return null
      if (c.min > from) from = c.min
      if (c.max < to) to = c.max
    }
    if (from > to || daysBetween(from, to) < MIN_HISTORY_DAYS) return null
    return { from, to }
  }

  const values: Record<string, number | null> = {
    impressions: cur.impressions,
    clicks: cur.clicks,
    lpViews: cur.lpViews,
    leads: cur.leads,
    ql: cur.ql,
    bookings: cur.bookings,
  }
  const pick = (v: RawStepValues, key: string): number | null =>
    (v as unknown as Record<string, number | null>)[key]

  // ── Per-step channel split (all-channel views only — a ?channel= view is already one
  // channel). Reuses exactly the same aggregate() the ?channel= views run on, so the numbers
  // are identical to calling the endpoint twice, and both channels ride in one response.
  const splitOn = channel === 'all'
  const chCur: Record<'meta' | 'google', RawStepValues> | null = splitOn
    ? {
        meta: aggregate(ds, def, start, end, 'meta'),
        google: aggregate(ds, def, start, end, 'google'),
      }
    : null
  const chHistCache = new Map<string, RawStepValues>()
  const chHistFor = (ch: 'meta' | 'google', from: string, to: string) => {
    const k = `${ch}|${from}|${to}`
    let v = chHistCache.get(k)
    if (!v) {
      v = aggregate(ds, def, from, to, ch)
      chHistCache.set(k, v)
    }
    return v
  }
  const otherLp = splitOn ? otherLpViews(ds, def, start, end) : null

  const benchmarkMeta: Record<string, unknown> = {}
  const steps: FunnelStep[] = STEP_DEFS.map((s, i) => {
    const naturalPrev = i > 0 ? STEP_DEFS[i - 1].key : null
    // When LP views cannot be measured (channel views — GA4 has no source dimension), the
    // Leads step would otherwise lose its rate entirely. Fall back to clicks→leads and say so.
    const fellBack = s.key === 'leads' && naturalPrev === 'lpViews' && values.lpViews === null
    const prevKey = fellBack ? 'clicks' : naturalPrev
    const cvrFromPrev = prevKey ? div(values[s.key], values[prevKey]) : null

    let benchmarkCvr: number | null = null
    let reason = 'first step — no previous step'
    let win: { from: string; to: string } | null = null
    if (prevKey) {
      const used = sourcesUsed(
        def,
        [...(STEP_SOURCES[s.key] || []), ...(STEP_SOURCES[prevKey] || [])],
        channel
      ).filter((v, idx, arr) => arr.indexOf(v) === idx)
      win = histWindow(used)
      if (!win) {
        const thin = used.filter(
          (k) => overlapDays(coverage[k], histStart, histEnd) < MIN_HISTORY_DAYS
        )
        reason = `insufficient history for ${thin.join(', ') || used.join(', ')} (<${MIN_HISTORY_DAYS}d before ${start})`
      } else {
        const h = histFor(win.from, win.to)
        benchmarkCvr = div(pick(h, s.key), pick(h, prevKey))
        reason = benchmarkCvr == null ? 'zero historical denominator' : 'ok'
      }
    }
    benchmarkMeta[s.key] = {
      benchmarkCvr,
      basis: reason,
      window: win,
      ...(fellBack ? { cvrBasis: 'clicks' } : {}),
    }

    const step: FunnelStep = {
      key: s.key,
      label: s.label,
      value: values[s.key],
      cvrFromPrev,
      benchmarkCvr,
      status: statusFor(cvrFromPrev, benchmarkCvr),
      source: s.source,
    }
    if (s.key === 'bookings') step.revenue = cur.revenue
    if (fellBack) step.cvrBasis = 'clicks'

    // ── channels: value/share for THIS step, plus the rate DOWN to the next step ──
    if (splitOn && chCur) {
      const nextKey = i < STEP_DEFS.length - 1 ? STEP_DEFS[i + 1].key : null
      step.channels = CHANNEL_LABELS.map((cm): FunnelStepChannel => {
        if (cm.key === 'other') {
          // Only LP views have a real non-paid number; the rest of the feeds are paid-only.
          const isLp = s.key === 'lpViews'
          const val = isLp ? otherLp : null
          const o: FunnelStepChannel = {
            key: 'other',
            label: cm.label,
            value: val,
            share: val == null ? null : div(val, values[s.key]),
            cvrToNext: null, // next step (leads) has no non-paid figure to divide into
            benchmarkCvr: null,
            status: null,
            available: val != null,
          }
          // bookings_api has no non-paid source, so organic revenue is unknown, not €0 — and
          // organic/direct has no ad spend to divide by, so spend and ROAS stay null too.
          if (s.key === 'bookings') {
            o.revenue = null
            o.spend = null
            o.roas = null
          }
          return o
        }
        const ch = cm.key
        const value = pick(chCur[ch], s.key)
        const nextValue = nextKey ? pick(chCur[ch], nextKey) : null
        const cvrToNext = nextKey ? div(nextValue, value) : null

        let bm: number | null = null
        if (nextKey) {
          const used = sourcesUsed(
            def,
            [...(STEP_SOURCES[nextKey] || []), ...(STEP_SOURCES[s.key] || [])],
            ch
          ).filter((v, idx, arr) => arr.indexOf(v) === idx)
          const w = histWindow(used)
          if (w) {
            const h = chHistFor(ch, w.from, w.to)
            bm = div(pick(h, nextKey), pick(h, s.key))
          }
        }
        const out: FunnelStepChannel = {
          key: ch,
          label: cm.label,
          value,
          share: div(value, values[s.key]),
          cvrToNext,
          benchmarkCvr: bm,
          status: statusFor(cvrToNext, bm),
          available: value != null,
        }
        if (s.key === 'bookings') {
          const chSpend = chCur[ch].spend
          out.revenue = chCur[ch].revenue
          out.spend = chSpend
          out.roas = chSpend > 0 ? chCur[ch].revenue / chSpend : null
        }
        return out
      })
    }
    return step
  })

  // ── Efficiency ──
  const spend = cur.spend
  const efficiency = {
    spend,
    cpm: cur.impressions ? (spend / cur.impressions) * 1000 : null,
    cpc: cur.clicks ? spend / cur.clicks : null,
    cpl: cur.leads ? spend / cur.leads : null,
    cpql: cur.ql ? spend / cur.ql : null,
    costPerBooking: cur.bookings ? spend / cur.bookings : null,
    roas: spend > 0 ? cur.revenue / spend : null,
  }

  // ── Attribution remainder (Streak leads in range that match no campaign) ──
  let totalLeads = 0
  let unattributedLeads = 0
  for (const r of streak.rows) {
    if (r.day < start || r.day > end) continue
    if (channel !== 'all' && leadChannel(r) !== channel) continue
    totalLeads++
    if (leadSlug(r) === null) unattributedLeads++
  }

  // ── Per-campaign summary (master only) ──
  const campaignSummary =
    slug === 'master'
      ? CAMPAIGNS.map((c) => {
          const a = aggregate(ds, c, start, end, channel)
          return {
            slug: c.slug,
            name: c.name,
            spend: a.spend,
            leads: a.leads ?? 0,
            ql: a.ql ?? 0,
            bookings: a.bookings ?? 0,
            revenue: a.revenue,
            // The real platform campaign names sitting under this umbrella.
            campaigns: campaignBreakdown(ds, c, start, end),
          }
        })
      : null

  return {
    meta: {
      start,
      end,
      campaign: slug,
      channel,
      generatedAt: new Date().toISOString(),
      qlThreshold: QL_THRESHOLD,
      benchmark: {
        method:
          "account-own historical CVR per step: trailing 365d ending the day before `start`, then clipped to the intersection of the coverage of every source that step uses (so numerator and denominator span the same days). null when any source has <21d of history there.",
        lookback: { from: histStart, to: histEnd },
        minHistoryDays: MIN_HISTORY_DAYS,
        steps: benchmarkMeta,
      },
      coverage,
      notes: [
        'Bookings are month-granular at source (bookings_api.booking_date = YYYY-MM); a range is matched on its start/end MONTHS.',
        'Revenue = RVC, which is already the Goolets commission — it is never multiplied by a margin.',
        'Leads and QL come from Streak (SSOT), never from FB pixel counts.',
        `bookings_api currently ends ${bookings.coverage.max || 'n/a'} — bookings for months after that read 0 because they are not synced yet, not because none happened.`,
        'attribution.unattributed is the GLOBAL remainder: Streak leads in range that match none of the 6 campaigns. It is the same figure on every view (channel-filtered when a channel is set).',
        channel !== 'all'
          ? 'lpViews on a channel view counts PAID sessions only (GA4 sessionSourceMedium: paid|cpc|ppc). The All view counts every session, so meta + google will NOT sum to All — the gap is organic, direct, referral and email traffic. Expected, not a reconciliation error.'
          : null,
        channel !== 'all'
          ? 'Known upstream leak: some paid Meta traffic is mis-tagged in GA4 without a paid token (e.g. "ig / <campaign name>", "fb / Facebook_Mobile_Feed"), so channel lpViews is a slight undercount for meta.'
          : null,
        slug === 'master'
          ? `campaignSummary[].campaigns lists the EXACT platform campaign names under each umbrella (same strings as fb_ads_raw / daily_api / the Acq Channel sheet). Sub-rows always sum back to the umbrella totals; whatever cannot be pinned to one real campaign sits in "${UNASSIGNED}" rather than being guessed onto one. A booking naming a campaign with no spend in this range keeps its real name with spend 0.`
          : null,
        splitOn
          ? 'steps[].channels: meta + google = the step total on every step; lpViews additionally has a real "other" (organic/direct/referral/email) so meta + google + other = the lpViews total. On impressions/clicks "other" does not exist as a concept, and on leads/ql/bookings it is unknown (streak_sync and bookings_api are paid-only at source) — both come back available:false, never 0.'
          : 'steps[].channels is omitted on a ?channel= view: the whole view is already that one channel.',
        def?.lpNote,
      ].filter(Boolean),
    },
    campaigns: CAMPAIGNS.map((c) => ({ slug: c.slug, name: c.name })),
    steps,
    efficiency,
    targets: null,
    retention: { available: false, note: 'source in progress (Aymen)' },
    attribution: {
      unattributedLeads,
      unattributedShare: totalLeads > 0 ? unattributedLeads / totalLeads : 0,
    },
    campaignSummary,
  }
}
