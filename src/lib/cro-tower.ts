/**
 * cro-tower.ts — data library behind GET /api/cro-tower, the "Web funnel · CRO" section Tadej
 * asked for (SOP: ppcos/goolets/context/analysis/2026-09-11-cro-control-tower-sop.md; visual +
 * data contract: ppcos/goolets/created/cro-control-tower-demo/index.html). PHASE 1 = data + JSON
 * only, no UI.
 *
 * ─── DEFINITIONS (locked 2026-09-11, restated here so the code is the spec) ─────────────────
 *
 * Domains
 *   MAIN_DOMAINS = goolets.net, guletexpert.com, croatialuxurygulet.com, turkeyluxurygulet.com.
 *   turkeyluxurygulet.com is NOT filtered out here (unlike the paid reports): Tadej asked for it.
 *   Ship micro-sites = every other host that appears in ga4_host_lp except `__other__` (the sync
 *   already whitelisted them and rolled translate.goog / lovable / localhost / staging … into
 *   `__other__`, which is ignored). Reported as ONE aggregate row + a visitors-only list per ship.
 *
 * Visitors / Engaged
 *   Visitors = GA4 sessions, Engaged = GA4 engaged_sessions, both from ga4_host_lp. The HEADLINE
 *   and the channel table use the 4 main domains only; ships are a separate row.
 *
 * Inquiries
 *   hubspot_contacts_all rows with is_inquiry = 1 AND first_host in the whitelist (main + ships)
 *   AND form_name not matched by INQUIRY_FORM_EXCLUDE. Dated by createdate (Ljubljana day).
 *   Kept on purpose: Rare Opportunities FORM (ASSET: an inquiry yes, a QL no), the calculators,
 *   the AI chat.
 *
 * Qualified Leads
 *   streak_all is_ql = 1 (AI ≥ 50 and not ASSET — computed by the sync), dated by inquiry_date.
 *   Counted per Streak BOX (359 emails sit on >1 box, each box counts). Domain / LP attribution:
 *   the box's email (then emails_ext) → hubspot_contacts_all.email → first_host + first_path.
 *   Nothing is dropped and nothing is guessed:
 *     matched + whitelisted host      → that domain / ship row
 *     matched, host not whitelisted   → "no_web_entry" (Facebook lead forms, offline imports…)
 *     not matched                     → "unmatched"
 *
 * Bookings + RVC
 *   bookings_api — the exact tab lib/business-funnel.ts reads, counted in the CLOSE month
 *   (booking_date is month-granular at source, so a `week` period has bookings = null). The
 *   headline paid numbers come from loadBusinessFunnel() itself; this file only re-reads the rows
 *   to attribute them to a domain / LP by client_email → HubSpot first_host/first_path (or the
 *   booking sheet's landing_page when that column exists). Unresolved = unattributed (demo
 *   ubk / urvc). bookings_api is PAID-ONLY (fb_landing / fb_lead / google / bing / chatgpt), so
 *   the nine non-paid channels have bookings = null, not 0 — the Acq sheet's all-channel
 *   bookings are not synced into the app yet (flagged in meta.flags).
 *
 * Paid tiles (spend, CPL, CPQL, ROAS, paid leads / QL / bookings / RVC)
 *   loadBusinessFunnel({campaign: 'master', channel: 'all'}) for the same window — NOT
 *   reimplemented here. YTD paid revenue = the same loader over 1 Jan → yesterday. There is no
 *   annual revenue target in config/funnel-targets.json, so target / pct are null.
 *
 * Channels — lib/cro-channel-map.ts (one table per taxonomy, `unmapped` bucket reported).
 *
 * Periods (all end at YESTERDAY at the latest: the tabs are full overwrites through yesterday)
 *   week   last full Mon–Sun (anchor=YYYY-MM-DD → the Mon–Sun week containing it)
 *   month  yesterday's month to date (anchor=YYYY-MM → that whole month, MTD if it is current)
 *   m3/m6  the anchor month (default yesterday's month) and the 2 / 5 months before it
 *   ytd    1 Jan → yesterday
 *   prev   same length immediately before: the previous week; for month-based periods the same
 *          number of months before, clipped to the same day-of-month when the period is MTD.
 *          ytd prev = null (YoY needs the 2025 backfill → flag).
 *   Every metric is {value, prev, deltaPct}; deltaPct is null when prev is null or 0.
 *
 * Dead feed = null + a flag, never 0 (freshness contract).
 */

import { fetchTabWithMeta, type SheetTabMeta } from './sheetsData'
import { DEFAULT_WEB_APP_URL, SHEETS_TABS, getSheetsUrl } from './config'
import { loadBusinessFunnel, todayLjubljana } from './business-funnel'
import { toDay } from './day'
import { normalizeEmailCandidates, normaliseBookingLanding } from './lp-attribution'
import {
  CRO_CHANNELS,
  UNMAPPED,
  mapGa4Channel,
  mapHubspotChannel,
  mapStreakChannel,
  normHost,
  type CroChannelOrUnmapped,
} from './cro-channel-map'

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAIN_DOMAINS = [
  'goolets.net',
  'guletexpert.com',
  'croatialuxurygulet.com',
  'turkeyluxurygulet.com',
] as const
const MAIN_SET = new Set<string>(MAIN_DOMAINS)

export const CRO_TABS = {
  GA4_HOST_LP: 'ga4_host_lp',
  GA4_HOST_EVENTS: 'ga4_host_events',
  STREAK_ALL: 'streak_all',
  HUBSPOT_ALL: 'hubspot_contacts_all',
  BOOKINGS: SHEETS_TABS.BOOKINGS, // 'bookings_api' — the same tab business-funnel.ts reads
} as const

/**
 * Forms that are NOT an inquiry even though HubSpot sets is_inquiry = 1.
 * TO CONFIRM WITH TADEJ / AYMEN. The first three are the agreed rules (2026-09-23 brief); the last
 * two are PROPOSED (clearly not a charter inquiry) and are reported separately in
 * meta.inquiryExclusions so they can be dropped from this list with one line.
 */
export const INQUIRY_FORM_EXCLUDE: { key: string; label: string; proposed: boolean; re: RegExp }[] = [
  // Native Meta lead forms: the contact never had a website session, so it cannot sit in a
  // visitor → inquiry funnel.
  { key: 'fb_lead_ads', label: 'Facebook Lead Ads: *', proposed: false, re: /^facebook lead ads:/i },
  // The Yacht Matchmaker quiz START (all languages share the #hs-quiz-form selector): a quiz
  // opener, not an inquiry. The finished matchmaker form is kept.
  { key: 'matchmaker_start', label: 'Yacht matchmaker start (quiz start, all languages)', proposed: false, re: /yacht matchmaker start|#hs-quiz-form/i },
  // OFFLINE / empty form: imports and CRM-created contacts carry no form at all.
  { key: 'offline_or_empty', label: 'OFFLINE / empty form', proposed: false, re: /^\s*$|^(offline|integration|import|crm_ui)$/i },
  { key: 'account_forms', label: 'Login / Register (account forms)', proposed: true, re: /\.uwp-(login|registration)-form/i },
  { key: 'job_applications', label: 'Job applications (m/ž/d)', proposed: true, re: /\(m\/ž\/d\)/i },
]

/** ASSET / RareOps landing pages: inquiries count, QL is n/a by rule (inflated AI score). */
const ASSET_PATH = /rare-opportunities|asset/i

const RESULT_TTL_MS = 15 * 60 * 1000
const SERIES_POINTS = 14

// ─── Public types ───────────────────────────────────────────────────────────

export type CroPeriod = 'week' | 'month' | 'm3' | 'm6' | 'ytd'
export const CRO_PERIODS: CroPeriod[] = ['week', 'month', 'm3', 'm6', 'ytd']

export interface Metric {
  value: number | null
  prev: number | null
  /** (value − prev) ÷ prev × 100, 1 decimal. null when either side is null or prev is 0. */
  deltaPct: number | null
}

export interface Range {
  from: string
  to: string
  label: string
  days: number
}

export interface SeriesPoint {
  start: string
  end: string
  visitors: number | null
  ql: number | null
  /** QL ÷ visitors × 100 (main domains). null when there is no GA4 coverage for the bucket. */
  crPct: number | null
}

export interface FunnelStepOut {
  key: 'visitors' | 'engaged' | 'inquiries' | 'ql' | 'bookings'
  label: string
  source: string
  metric: Metric
  /** Bookings step only: RVC in €. */
  revenue?: Metric
  /** This step → next step, in %. */
  cvrToNextPct: Metric | null
  note?: string
}

export interface DomainRow {
  key: string
  label: string
  kind: 'main' | 'ships' | 'no_web_entry' | 'unmatched'
  visitors: Metric
  engaged: Metric
  inquiries: Metric
  ql: Metric
  /** Visitor → QL, %. */
  crPct: Metric
  bookings: number | null
  revenue: number | null
  formStarts: number | null
  formSubmits: number | null
  flags: string[]
}

export interface ShipRow {
  host: string
  visitors: number | null
  prevVisitors: number | null
}

export interface ChannelRow {
  key: string
  label: string
  visitors: Metric
  inquiries: Metric
  ql: Metric
  crPct: Metric
  /** Paid rows only; null = no ad spend on this channel. */
  spend: number | null
  bookings: number | null
  revenue: number | null
  /** Revenue ÷ inquiries (€). */
  revenuePerInquiry: number | null
  roas: number | null
}

export interface PageRow {
  key: string
  host: string
  path: string
  asset: boolean
  visitors: number
  inquiries: number
  /** null on ASSET pages (QL n/a by rule). */
  ql: number | null
  crPct: number | null
  bookings: number | null
  revenue: number | null
}

export interface PaidBlock {
  window: { from: string; to: string; clipped: boolean } | null
  spend: number | null
  spendMeta: number | null
  spendGoogle: number | null
  spendBing: number | null
  spendChatgpt: number | null
  leads: number | null
  ql: number | null
  qlInclAsset: number | null
  bookings: number | null
  bookingsMeta: number | null
  bookingsGoogle: number | null
  bookingsBing: number | null
  bookingsChatgpt: number | null
  revenue: number | null
  revenueMeta: number | null
  revenueGoogle: number | null
  revenueBing: number | null
  revenueChatgpt: number | null
  cpl: number | null
  cpql: number | null
  roas: number | null
}

export interface TabFreshness {
  tab: string
  rows: number | null
  minDate: string | null
  maxDate: string | null
  fetchedAt: string | null
  servedFrom: string | null
  error: string | null
  /** true when the tab's data reaches the end of the requested period. */
  coversPeriod: boolean | null
}

export interface CroTowerResponse {
  hero: {
    visitorToQlPct: Metric
    visitors: Metric
    ql: Metric
    series: {
      unit: string
      stepDays: number
      start: string
      points: SeriesPoint[]
      /** Just the CR values, for a sparkline (demo `spark`). */
      spark: (number | null)[]
    }
    qlToBookingPct: Metric
    revenuePerVisitor: Metric
    revenuePerQl: Metric
  }
  strip: {
    spend: Metric & { meta: number | null; google: number | null; bing: number | null; chatgpt: number | null }
    bookings: Metric & { paid: number | null; otherChannels: number | null }
    revenue: Metric & { paid: number | null }
    roas: Metric
    cpl: Metric & { paidLeads: number | null }
    cpql: Metric & { paidQl: number | null }
    avgBooking: Metric
    ytdPaidRevenue: { value: number | null; target: number | null; pctOfTarget: number | null; range: { from: string; to: string } }
  }
  funnel: {
    steps: FunnelStepOut[]
    unattributedBookings: { count: number | null; revenue: number | null; note: string }
  }
  domains: {
    rows: DomainRow[]
    ships: ShipRow[]
    mainTotal: { visitors: Metric; engaged: Metric; inquiries: Metric; ql: Metric; crPct: Metric; bookings: number | null; revenue: number | null }
  }
  channels: { rows: ChannelRow[]; total: { visitors: number | null; inquiries: number | null; ql: number | null; spend: number | null; bookings: number | null; revenue: number | null } }
  pages: { rows: PageRow[]; bookingsOnTopPages: number | null; bookingsTotal: number | null; note: string }
  meta: {
    period: CroPeriod
    anchor: string | null
    range: Range
    prevRange: Range | null
    yesterday: string
    generatedAt: string
    cached: boolean
    sources: Record<string, string>
    freshness: TabFreshness[]
    unmapped: {
      ga4: { visitors: number; share: number | null; top: { key: string; visitors: number }[] }
      hubspot: { inquiries: number; share: number | null; top: { key: string; inquiries: number }[] }
      streak: { ql: number; share: number | null; top: { key: string; ql: number }[] }
    }
    matchRates: {
      qlEmailToHubspot: { matched: number; total: number; ratePct: number | null }
      bookingsToDomain: { matched: number; total: number; ratePct: number | null }
    }
    inquiryExclusions: { key: string; label: string; proposed: boolean; count: number }[]
    inquiriesOutsideWhitelist: { count: number; topHosts: { host: string; count: number }[] }
    paid: { current: PaidBlock | null; prev: PaidBlock | null; ytd: PaidBlock | null }
    reconciliation: { bookingsFromRows: number | null; bookingsFromFunnel: number | null; match: boolean | null }
    definitions: Record<string, string>
    flags: string[]
  }
}

// ─── Small helpers ──────────────────────────────────────────────────────────

const round = (v: number, d: number) => {
  const f = Math.pow(10, d)
  return Math.round(v * f) / f
}
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string): number =>
  Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1
const monthEnd = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
const shiftMonth = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const minStr = (a: string, b: string) => (a < b ? a : b)
const n = (v: any): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const x = Number(String(v ?? '').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(x) ? x : 0
}
const div = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a == null || b == null || b === 0 ? null : a / b
const pct = (a: number | null | undefined, b: number | null | undefined, d = 3): number | null => {
  const r = div(a, b)
  return r == null ? null : round(r * 100, d)
}

export function metric(value: number | null | undefined, prev: number | null | undefined, d = 2): Metric {
  const v = value == null ? null : round(value, d)
  const p = prev == null ? null : round(prev, d)
  return {
    value: v,
    prev: p,
    deltaPct: value == null || prev == null || prev === 0 ? null : round(((value - prev) / prev) * 100, 1),
  }
}

/** Lowercase, no query/hash, no trailing slash except root; empty → '/'. '(not set)' is kept. */
export function normPath(raw: string | null | undefined): string {
  let p = String(raw ?? '').trim()
  if (!p) return '/'
  if (p === '(not set)') return p
  p = p.split('?')[0].split('#')[0].toLowerCase()
  if (!p.startsWith('/')) p = '/' + p
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '')
  return p || '/'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const dayLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`
function rangeLabel(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && to === monthEnd(to.slice(0, 7))) {
    return `${MONTHS_LONG[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`
  }
  return `${dayLabel(from)} – ${dayLabel(to)}, ${to.slice(0, 4)}`
}
const mkRange = (from: string, to: string): Range => ({ from, to, label: rangeLabel(from, to), days: daysBetween(from, to) })

// ─── Periods ────────────────────────────────────────────────────────────────

export interface ResolvedCroPeriod {
  period: CroPeriod
  anchor: string | null
  range: Range
  prev: Range | null
  series: { start: string; stepDays: number; count: number; unit: string }
  /** Bookings are month-granular at source: only month-aligned periods can report them. */
  bookingsMeasurable: boolean
}

/** Monday of the ISO week containing `day`. */
const mondayOf = (day: string): string => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = Sun
  return addDays(day, -((dow + 6) % 7))
}

export function resolveCroPeriod(period: CroPeriod, anchor: string | null | undefined, yesterday: string): ResolvedCroPeriod {
  const a = anchor ? String(anchor).trim() : ''
  if (period === 'week') {
    let mon: string
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) mon = mondayOf(a)
    else {
      // last FULL week: the Sunday on/before yesterday
      const sun = addDays(mondayOf(yesterday), 6) <= yesterday ? addDays(mondayOf(yesterday), 6) : addDays(mondayOf(yesterday), -1)
      mon = addDays(sun, -6)
    }
    const to = addDays(mon, 6)
    if (to > yesterday) throw new Error(`week ${mon}…${to} is not complete yet (data runs to ${yesterday})`)
    const prev = mkRange(addDays(mon, -7), addDays(mon, -1))
    return {
      period,
      anchor: a || null,
      range: mkRange(mon, to),
      prev,
      series: { start: prev.from, stepDays: 1, count: SERIES_POINTS, unit: 'daily' },
      bookingsMeasurable: false,
    }
  }

  if (period === 'ytd') {
    const from = `${yesterday.slice(0, 4)}-01-01`
    const r = mkRange(from, yesterday)
    const step = Math.max(1, Math.ceil(r.days / SERIES_POINTS))
    return {
      period,
      anchor: null,
      range: r,
      prev: null,
      series: { start: from, stepDays: step, count: Math.ceil(r.days / step), unit: `${step}-day steps` },
      bookingsMeasurable: true,
    }
  }

  // month / m3 / m6
  const months = period === 'month' ? 1 : period === 'm3' ? 3 : 6
  let anchorM = yesterday.slice(0, 7)
  if (a) {
    if (!/^\d{4}-\d{2}$/.test(a)) throw new Error(`anchor must be YYYY-MM for period=${period}`)
    if (a > yesterday.slice(0, 7)) throw new Error(`anchor ${a} is in the future (data runs to ${yesterday})`)
    anchorM = a
  }
  const fromM = shiftMonth(anchorM, -(months - 1))
  const from = `${fromM}-01`
  const to = minStr(monthEnd(anchorM), yesterday)
  const mtd = to !== monthEnd(anchorM)
  const prevFromM = shiftMonth(fromM, -months)
  const prevAnchorM = shiftMonth(anchorM, -months)
  // MTD: clip the previous window to the same day-of-month (like-for-like), else full months.
  const prevTo = mtd ? minStr(`${prevAnchorM}-${to.slice(8, 10)}`, monthEnd(prevAnchorM)) : monthEnd(prevAnchorM)
  const range = mkRange(from, to)
  const prev = mkRange(`${prevFromM}-01`, prevTo)

  let series: ResolvedCroPeriod['series']
  if (period === 'month') {
    // demo: 14 weekly points ending with the period
    series = { start: addDays(to, -(SERIES_POINTS * 7) + 1), stepDays: 7, count: SERIES_POINTS, unit: 'weekly' }
  } else if (period === 'm3') {
    series = { start: from, stepDays: 7, count: Math.ceil(range.days / 7), unit: 'weekly' }
  } else {
    const step = Math.max(1, Math.ceil(range.days / SERIES_POINTS))
    series = { start: from, stepDays: step, count: Math.ceil(range.days / step), unit: `${step}-day steps` }
  }
  return { period, anchor: a || null, range, prev, series, bookingsMeasurable: true }
}

// ─── Datasets ───────────────────────────────────────────────────────────────

interface Ga4Row { day: string; host: string; path: string; channel: CroChannelOrUnmapped; cg: string; sm: string; sessions: number; engaged: number }
interface EventRow { day: string; host: string; event: string; count: number }
interface HubRow {
  day: string
  host: string
  path: string
  channel: CroChannelOrUnmapped
  channelKey: string
  isInquiry: boolean
  excludeKey: string | null
}
interface StreakRow {
  day: string
  isQl: boolean
  paid: boolean
  joined: { host: string; path: string } | null
  channel: CroChannelOrUnmapped
  channelKey: string
}
interface BookingRow { month: string; rvc: number; host: string | null; path: string | null }

interface Datasets {
  ga4: Ga4Row[] | null
  events: EventRow[] | null
  hub: HubRow[] | null
  streak: StreakRow[] | null
  bookings: BookingRow[] | null
  /** Hosts in ga4_host_lp (minus __other__) — the whitelist for inquiries. */
  whitelist: Set<string>
  ships: string[]
  ga4Min: string | null
  freshness: TabFreshness[]
  flags: string[]
}

const SHEET_URL = () => getSheetsUrl() || DEFAULT_WEB_APP_URL

function rowsOf(sheet: any[][] | null): Record<string, any>[] | null {
  if (!sheet) return null
  if (!sheet.length) return []
  const header = (sheet[0] as any[]).map((h) => String(h))
  const out: Record<string, any>[] = new Array(sheet.length - 1)
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i]
    const o: Record<string, any> = {}
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j]
    out[i - 1] = o
  }
  return out
}

function freshnessOf(meta: SheetTabMeta, days: string[] | null): TabFreshness {
  let min: string | null = null
  let max: string | null = null
  if (days) for (const d of days) {
    if (!d) continue
    if (min === null || d < min) min = d
    if (max === null || d > max) max = d
  }
  return {
    tab: meta.tab,
    rows: meta.rows,
    minDate: min,
    maxDate: max,
    fetchedAt: meta.fetchedAt,
    servedFrom: meta.servedFrom,
    error: meta.error,
    coversPeriod: null,
  }
}

let dsMemo: { at: number; data: Datasets } | null = null
let dsInflight: Promise<Datasets> | null = null

async function loadDatasets(force = false): Promise<Datasets> {
  if (!force && dsMemo && Date.now() - dsMemo.at < RESULT_TTL_MS) return dsMemo.data
  if (dsInflight) return dsInflight
  dsInflight = buildDatasets()
    .then((d) => {
      dsMemo = { at: Date.now(), data: d }
      dsInflight = null
      return d
    })
    .catch((e) => {
      dsInflight = null
      throw e
    })
  return dsInflight
}

async function buildDatasets(): Promise<Datasets> {
  const url = SHEET_URL()
  const [ga4T, evT, stT, hsT, bkT] = await Promise.all([
    fetchTabWithMeta(CRO_TABS.GA4_HOST_LP, url),
    fetchTabWithMeta(CRO_TABS.GA4_HOST_EVENTS, url),
    fetchTabWithMeta(CRO_TABS.STREAK_ALL, url),
    fetchTabWithMeta(CRO_TABS.HUBSPOT_ALL, url),
    fetchTabWithMeta(CRO_TABS.BOOKINGS, url),
  ])
  const flags: string[] = []

  // GA4 host × LP
  const ga4Raw = rowsOf(ga4T.sheet)
  let ga4: Ga4Row[] | null = null
  const whitelist = new Set<string>()
  if (ga4Raw) {
    ga4 = []
    for (const r of ga4Raw) {
      const host = normHost(r.host)
      if (!host || host === '__other__') continue
      const day = toDay(r.date)
      if (!day) continue
      whitelist.add(host)
      const cg = String(r.channel_group ?? '')
      const sm = String(r.source_medium ?? '')
      ga4.push({
        day,
        host,
        path: normPath(r.landing_page),
        channel: mapGa4Channel(cg, sm, host),
        cg,
        sm,
        sessions: n(r.sessions),
        engaged: n(r.engaged_sessions),
      })
    }
    if (!ga4.length) {
      flags.push(`${CRO_TABS.GA4_HOST_LP} returned no rows: visitors / engaged are null.`)
      ga4 = null
    }
  } else flags.push(`${CRO_TABS.GA4_HOST_LP} unavailable (${ga4T.meta.error}): visitors / engaged are null.`)
  for (const d of MAIN_DOMAINS) whitelist.add(d)
  const ships = [...whitelist].filter((h) => !MAIN_SET.has(h)).sort()

  // GA4 form events
  const evRaw = rowsOf(evT.sheet)
  let events: EventRow[] | null = null
  if (evRaw) {
    events = []
    for (const r of evRaw) {
      const host = normHost(r.host)
      if (!host || host === '__other__') continue
      events.push({ day: toDay(r.date), host, event: String(r.event_name ?? ''), count: n(r.event_count) })
    }
  } else flags.push(`${CRO_TABS.GA4_HOST_EVENTS} unavailable (${evT.meta.error}): form starts / submits are null.`)

  // HubSpot contacts (all) + the email → first page index used by the QL and booking joins
  const hsRaw = rowsOf(hsT.sheet)
  let hub: HubRow[] | null = null
  const byEmail = new Map<string, { host: string; path: string; created: string }>()
  if (hsRaw) {
    hub = []
    for (const r of hsRaw) {
      const host = normHost(r.first_host)
      const path = normPath(r.first_path)
      const created = String(r.createdate ?? '')
      for (const e of normalizeEmailCandidates(r.email)) {
        const hit = byEmail.get(e)
        if (!hit || created < hit.created) byEmail.set(e, { host, path, created })
      }
      const day = toDay(created)
      if (!day) continue
      const form = String(r.form_name ?? '')
      const ex = INQUIRY_FORM_EXCLUDE.find((x) => x.re.test(form))
      const source = String(r.hs_analytics_source ?? '')
      const channel = mapHubspotChannel({
        source,
        data1: r.hs_analytics_source_data_1,
        data2: r.hs_analytics_source_data_2,
        utmSource: r.utm_source,
        utmMedium: r.utm_medium,
        firstHost: host,
      })
      hub.push({
        day,
        host,
        path,
        channel,
        channelKey: `${source || '(empty)'} | ${String(r.hs_analytics_source_data_1 ?? '').slice(0, 40)}`,
        isInquiry: n(r.is_inquiry) === 1,
        excludeKey: ex ? ex.key : null,
      })
    }
  } else flags.push(`${CRO_TABS.HUBSPOT_ALL} unavailable (${hsT.meta.error}): inquiries are null and QL cannot be attributed to a domain / LP.`)

  // Streak (all channels)
  const stRaw = rowsOf(stT.sheet)
  let streak: StreakRow[] | null = null
  if (stRaw) {
    streak = []
    for (const r of stRaw) {
      const day = toDay(r.inquiry_date)
      if (!day) continue
      let joined: { host: string; path: string } | null = null
      if (hsRaw) {
        const cands = normalizeEmailCandidates(r.email).concat(normalizeEmailCandidates(String(r.emails_ext ?? '').replace(/;/g, ' ')))
        for (const e of cands) {
          const hit = byEmail.get(e)
          if (hit) {
            joined = { host: hit.host, path: hit.path }
            break
          }
        }
      }
      const cat = String(r.source_category ?? '')
      streak.push({
        day,
        isQl: n(r.is_ql) === 1,
        paid: /^PAID_(SOCIAL|SEARCH)$/i.test(cat.trim()),
        joined,
        channel: mapStreakChannel({ category: cat, detail: r.source_detail, page: r.page, joinedHost: joined?.host ?? null }),
        channelKey: `${cat || '(empty)'}`,
      })
    }
  } else flags.push(`${CRO_TABS.STREAK_ALL} unavailable (${stT.meta.error}): QL is null.`)

  // bookings_api (paid bookings, close month)
  const bkRaw = rowsOf(bkT.sheet)
  let bookings: BookingRow[] | null = null
  if (bkRaw) {
    bookings = []
    for (const r of bkRaw) {
      const bd = String(r.booking_date ?? '')
      const month = bd.includes('T') ? toDay(bd).slice(0, 7) : bd.slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      // landing_page (Acq sheet Landing) first — when the column exists — then email → HubSpot.
      let host: string | null = null
      let path: string | null = null
      const landing = normaliseBookingLanding(r.landing_page)
      if (landing) {
        if (landing.startsWith('/')) {
          host = 'goolets.net'
          path = normPath(landing)
        } else {
          const i = landing.indexOf('/')
          host = i < 0 ? landing : landing.slice(0, i)
          path = i < 0 ? '/' : normPath(landing.slice(i))
        }
      } else if (hsRaw) {
        for (const e of normalizeEmailCandidates(r.client_email)) {
          const hit = byEmail.get(e)
          if (hit && hit.host) {
            host = hit.host
            path = hit.path
            break
          }
        }
      }
      bookings.push({ month, rvc: n(r.rvc), host, path })
    }
  } else flags.push(`${CRO_TABS.BOOKINGS} unavailable (${bkT.meta.error}): bookings cannot be attributed to a domain / LP.`)

  const freshness = [
    freshnessOf(ga4T.meta, ga4 ? ga4.map((r) => r.day) : null),
    freshnessOf(evT.meta, events ? events.map((r) => r.day) : null),
    freshnessOf(hsT.meta, hub ? hub.map((r) => r.day) : null),
    freshnessOf(stT.meta, streak ? streak.map((r) => r.day) : null),
    freshnessOf(bkT.meta, bookings ? bookings.map((r) => `${r.month}-01`) : null),
  ]

  return {
    ga4,
    events,
    hub,
    streak,
    bookings,
    whitelist,
    ships,
    ga4Min: freshness[0].minDate,
    freshness,
    flags,
  }
}

// ─── Window aggregation ─────────────────────────────────────────────────────

type Counter = Map<string, number>
const inc = (m: Counter, k: string, v = 1) => m.set(k, (m.get(k) || 0) + v)

type DomainKey = string // main host | 'ships' | 'no_web_entry' | 'unmatched'

interface WindowAgg {
  visitors: number | null // main domains
  engaged: number | null
  inquiries: number | null // whitelist incl. ships
  ql: number | null
  qlPaid: number | null
  visitorsByHost: Counter
  engagedByHost: Counter
  visitorsByPage: Counter // host+path
  visitorsByChannel: Counter // main domains
  unmappedGa4: Counter
  inquiriesByDomain: Counter
  inquiriesByPage: Counter
  inquiriesByChannel: Counter
  unmappedHub: Counter
  excludedByRule: Counter
  outsideWhitelist: Counter
  qlByDomain: Counter
  qlByPage: Counter
  qlByChannel: Counter
  unmappedStreak: Counter
  qlMatched: number
  formStarts: Counter
  formSubmits: Counter
  bookingsByDomain: Counter
  revenueByDomain: Counter
  bookingsByPage: Counter
  revenueByPage: Counter
  bookingsTotal: number | null
  revenueTotal: number | null
  bookingsResolved: number
}

const domainOf = (host: string, whitelist: Set<string>): DomainKey =>
  MAIN_SET.has(host) ? host : whitelist.has(host) ? 'ships' : 'no_web_entry'

function aggregateWindow(ds: Datasets, from: string, to: string, bookingsMeasurable: boolean): WindowAgg {
  const inR = (d: string) => d >= from && d <= to
  const a: WindowAgg = {
    visitors: null,
    engaged: null,
    inquiries: null,
    ql: null,
    qlPaid: null,
    visitorsByHost: new Map(),
    engagedByHost: new Map(),
    visitorsByPage: new Map(),
    visitorsByChannel: new Map(),
    unmappedGa4: new Map(),
    inquiriesByDomain: new Map(),
    inquiriesByPage: new Map(),
    inquiriesByChannel: new Map(),
    unmappedHub: new Map(),
    excludedByRule: new Map(),
    outsideWhitelist: new Map(),
    qlByDomain: new Map(),
    qlByPage: new Map(),
    qlByChannel: new Map(),
    unmappedStreak: new Map(),
    qlMatched: 0,
    formStarts: new Map(),
    formSubmits: new Map(),
    bookingsByDomain: new Map(),
    revenueByDomain: new Map(),
    bookingsByPage: new Map(),
    revenueByPage: new Map(),
    bookingsTotal: null,
    revenueTotal: null,
    bookingsResolved: 0,
  }

  // A source answers a window only when its data STARTS on or before the window's first day and
  // has reached it: every tab starts 2026-01-01, so a window reaching into 2025 (m6 prev, a
  // January month's prev) would otherwise report a fraction of the window as if it were all of
  // it (m6 prev read +537 % visitors). No coverage = null, never a partial number.
  const covers = (f: TabFreshness, start = from) => !!f.minDate && !!f.maxDate && f.minDate <= start && start <= f.maxDate
  const [ga4Fresh, evFresh, hubFresh, stFresh, bkFresh] = ds.freshness
  if (ds.ga4 && covers(ga4Fresh)) {
    let v = 0
    let e = 0
    for (const r of ds.ga4) {
      if (!inR(r.day)) continue
      inc(a.visitorsByHost, r.host, r.sessions)
      inc(a.engagedByHost, r.host, r.engaged)
      inc(a.visitorsByPage, r.host + r.path, r.sessions)
      if (MAIN_SET.has(r.host)) {
        v += r.sessions
        e += r.engaged
        inc(a.visitorsByChannel, r.channel, r.sessions)
        if (r.channel === UNMAPPED) inc(a.unmappedGa4, `${r.cg} | ${r.sm} | ${r.host}`, r.sessions)
      }
    }
    a.visitors = v
    a.engaged = e
  }

  if (ds.events && covers(evFresh)) {
    for (const r of ds.events) {
      if (!inR(r.day)) continue
      if (r.event === 'form_start') inc(a.formStarts, r.host, r.count)
      else if (r.event === 'form_submit') inc(a.formSubmits, r.host, r.count)
    }
  }

  if (ds.hub && covers(hubFresh)) {
    let i = 0
    for (const r of ds.hub) {
      if (!r.isInquiry || !inR(r.day)) continue
      if (r.excludeKey) {
        inc(a.excludedByRule, r.excludeKey)
        continue
      }
      if (!ds.whitelist.has(r.host)) {
        inc(a.outsideWhitelist, r.host || '(empty)')
        continue
      }
      i++
      inc(a.inquiriesByDomain, domainOf(r.host, ds.whitelist))
      inc(a.inquiriesByPage, r.host + r.path)
      inc(a.inquiriesByChannel, r.channel)
      if (r.channel === UNMAPPED) inc(a.unmappedHub, r.channelKey)
    }
    a.inquiries = i
  }

  if (ds.streak && covers(stFresh)) {
    let q = 0
    let qp = 0
    for (const r of ds.streak) {
      if (!r.isQl || !inR(r.day)) continue
      q++
      if (r.paid) qp++
      inc(a.qlByChannel, r.channel)
      if (r.channel === UNMAPPED) inc(a.unmappedStreak, r.channelKey)
      if (!ds.hub) continue
      if (!r.joined) {
        inc(a.qlByDomain, 'unmatched')
        continue
      }
      a.qlMatched++
      const host = r.joined.host
      inc(a.qlByDomain, host && ds.whitelist.has(host) ? domainOf(host, ds.whitelist) : 'no_web_entry')
      if (host && ds.whitelist.has(host)) inc(a.qlByPage, host + r.joined.path)
    }
    a.ql = q
    a.qlPaid = qp
  }

  if (ds.bookings && bookingsMeasurable && covers(bkFresh, `${from.slice(0, 7)}-01`)) {
    const fromM = from.slice(0, 7)
    const toM = to.slice(0, 7)
    let b = 0
    let rv = 0
    for (const r of ds.bookings) {
      if (r.month < fromM || r.month > toM) continue
      b++
      rv += r.rvc
      if (r.host && ds.whitelist.has(r.host)) {
        a.bookingsResolved++
        const d = domainOf(r.host, ds.whitelist)
        inc(a.bookingsByDomain, d)
        inc(a.revenueByDomain, d, r.rvc)
        inc(a.bookingsByPage, r.host + (r.path || '/'))
        inc(a.revenueByPage, r.host + (r.path || '/'), r.rvc)
      }
    }
    a.bookingsTotal = b
    a.revenueTotal = rv
  }
  return a
}

// ─── Paid block (business-funnel, reused as is) ─────────────────────────────

async function loadPaid(from: string, to: string): Promise<PaidBlock> {
  const f = await loadBusinessFunnel({ start: from, end: to, campaign: 'master', channel: 'all' })
  const step = (k: string) => f.steps.find((s) => s.key === k)
  const bk = step('bookings')
  const ch = (key: string) => bk?.channels?.find((c) => c.key === key)
  const ew = (f.meta as any).effectiveWindow as { from: string; to: string; clipped: boolean } | undefined
  return {
    window: ew ? { from: ew.from, to: ew.to, clipped: !!ew.clipped } : null,
    spend: f.efficiency.spend,
    spendMeta: ch('meta')?.spend ?? null,
    spendGoogle: ch('google')?.spend ?? null,
    spendBing: ch('bing')?.spend ?? null,
    spendChatgpt: ch('chatgpt')?.spend ?? null,
    leads: step('leads')?.value ?? null,
    ql: step('ql')?.value ?? null,
    qlInclAsset: step('ql')?.qualityLeadsIncludingAsset ?? null,
    bookings: bk?.value ?? null,
    bookingsMeta: ch('meta')?.value ?? null,
    bookingsGoogle: ch('google')?.value ?? null,
    bookingsBing: ch('bing')?.value ?? null,
    bookingsChatgpt: ch('chatgpt')?.value ?? null,
    revenue: bk?.revenue ?? null,
    revenueMeta: ch('meta')?.revenue ?? null,
    revenueGoogle: ch('google')?.revenue ?? null,
    revenueBing: ch('bing')?.revenue ?? null,
    revenueChatgpt: ch('chatgpt')?.revenue ?? null,
    cpl: f.efficiency.cpl,
    cpql: f.efficiency.cpql,
    roas: f.efficiency.roas,
  }
}

async function safePaid(from: string, to: string, flags: string[], label: string): Promise<PaidBlock | null> {
  try {
    return await loadPaid(from, to)
  } catch (e) {
    flags.push(`Paid funnel (business-funnel) failed for ${label} ${from}…${to}: ${(e as Error).message}. Spend / CPL / CPQL / ROAS / bookings are null.`)
    return null
  }
}

const sumNullable = (...xs: (number | null | undefined)[]): number | null => {
  if (xs.every((x) => x == null)) return null
  return xs.reduce<number>((s, x) => s + (x ?? 0), 0)
}

// ─── Build ──────────────────────────────────────────────────────────────────

const resultMemo = new Map<string, { at: number; data: CroTowerResponse }>()
const resultInflight = new Map<string, Promise<CroTowerResponse>>()

export function clearCroTowerCache() {
  resultMemo.clear()
  resultInflight.clear()
  dsMemo = null
  dsInflight = null
}

export async function buildCroTower(opts: { period?: string; anchor?: string | null; nocache?: boolean; today?: string }): Promise<CroTowerResponse> {
  const period = (String(opts.period || 'month').toLowerCase() as CroPeriod)
  if (!CRO_PERIODS.includes(period)) throw new Error(`Unknown period "${opts.period}" (use ${CRO_PERIODS.join(', ')})`)
  const yesterday = addDays(opts.today || todayLjubljana(), -1)
  const key = `${period}|${opts.anchor || ''}|${yesterday}`
  if (!opts.nocache) {
    const hit = resultMemo.get(key)
    if (hit && Date.now() - hit.at < RESULT_TTL_MS) return { ...hit.data, meta: { ...hit.data.meta, cached: true } }
    const running = resultInflight.get(key)
    if (running) return running
  }
  const p = build(period, opts.anchor ?? null, yesterday, !!opts.nocache)
    .then((d) => {
      resultMemo.set(key, { at: Date.now(), data: d })
      resultInflight.delete(key)
      return d
    })
    .catch((e) => {
      resultInflight.delete(key)
      throw e
    })
  resultInflight.set(key, p)
  return p
}

async function build(period: CroPeriod, anchor: string | null, yesterday: string, force: boolean): Promise<CroTowerResponse> {
  const rp = resolveCroPeriod(period, anchor, yesterday)
  const ds = await loadDatasets(force)
  const flags = [...ds.flags]
  const { range, prev } = rp

  const cur = aggregateWindow(ds, range.from, range.to, rp.bookingsMeasurable)
  const prv = prev ? aggregateWindow(ds, prev.from, prev.to, rp.bookingsMeasurable) : null

  const ytdFrom = `${yesterday.slice(0, 4)}-01-01`
  const [paidCur, paidPrevRaw, paidYtd] = await Promise.all([
    safePaid(range.from, range.to, flags, 'current'),
    prev ? safePaid(prev.from, prev.to, flags, 'previous') : Promise.resolve(null),
    safePaid(ytdFrom, yesterday, flags, 'ytd'),
  ])

  const paidPrev = paidPrevRaw && !paidPrevRaw.window?.clipped ? paidPrevRaw : null

  // ── freshness vs. period ──
  const freshness = ds.freshness.map((f) => {
    const isBookings = f.tab === CRO_TABS.BOOKINGS
    const end = isBookings ? `${range.to.slice(0, 7)}-01` : range.to
    const covers = f.maxDate == null ? null : f.maxDate >= end
    if (covers === false && !isBookings) flags.push(`${f.tab} covers to ${f.maxDate}; the period ends ${range.to} — the last days are missing from it.`)
    return { ...f, coversPeriod: covers }
  })
  if (!prev) flags.push('ytd has no previous period: YoY needs the 2025 backfill of GA4 / HubSpot / Streak (separate project). prev and deltaPct are null.')
  if (rp.bookingsMeasurable && period !== 'ytd' && range.to !== monthEnd(range.to.slice(0, 7))) {
    flags.push('Month-to-date: bookings are month-granular, so the bookings / RVC of this period and of its previous period are whole close-months (spend, leads and QL are day-exact).')
  }
  if (!rp.bookingsMeasurable) flags.push('Bookings are month-granular at source (bookings_api.booking_date = YYYY-MM): a week cannot be measured, so bookings / RVC / ROAS / avg booking are null on period=week.')
  flags.push('bookings_api is paid-only (Meta / Google / Bing / ChatGPT). Non-paid channels\' bookings are null (the Acq sheet all-channel bookings are not synced into the app); total bookings = paid bookings.')
  flags.push('Consent Mode v2 is not live on the sites yet: GA4 visitor counts will drop when it is switched on (SOP disclaimer).')
  if (prev && paidPrevRaw?.window?.clipped) {
    flags.push(`The paid funnel could only measure ${paidPrevRaw.window.from}…${paidPrevRaw.window.to} of the previous period ${prev.from}…${prev.to} (feed coverage): paid prev values are null rather than a part-window comparison.`)
  }
  if (prv && prv.visitors == null && ds.ga4) flags.push(`The previous period ${prev!.from}…${prev!.to} starts before the data (tabs begin ${ds.freshness[0].minDate}): prev values are null.`)
  if (paidCur?.window?.clipped) flags.push(`The paid funnel clipped its window to ${paidCur.window.from}…${paidCur.window.to} (feed coverage); spend / CPL / CPQL are over that window.`)

  const bM = rp.bookingsMeasurable
  const paidBk = (b: PaidBlock | null) => (bM && b ? b.bookings : null)
  const paidRv = (b: PaidBlock | null) => (bM && b ? b.revenue : null)

  // ── reconciliation: the rows we attribute must be the funnel's rows ──
  const recon = {
    bookingsFromRows: cur.bookingsTotal,
    bookingsFromFunnel: paidBk(paidCur),
    match: cur.bookingsTotal == null || paidBk(paidCur) == null ? null : cur.bookingsTotal === paidBk(paidCur),
  }
  if (recon.match === false) flags.push(`Booking rows attributed here (${recon.bookingsFromRows}) differ from the paid funnel's bookings (${recon.bookingsFromFunnel}).`)

  // ── hero ──
  const crCur = pct(cur.ql, cur.visitors)
  const crPrev = prv ? pct(prv.ql, prv.visitors) : null
  const points: SeriesPoint[] = []
  {
    const dayV = new Map<string, number>()
    const dayQ = new Map<string, number>()
    if (ds.ga4) for (const r of ds.ga4) if (MAIN_SET.has(r.host)) inc(dayV, r.day, r.sessions)
    if (ds.streak) for (const r of ds.streak) if (r.isQl) inc(dayQ, r.day, 1)
    const ga4Max = ds.freshness[0].maxDate
    for (let k = 0; k < rp.series.count; k++) {
      const s = addDays(rp.series.start, k * rp.series.stepDays)
      const e = minStr(addDays(s, rp.series.stepDays - 1), range.to)
      if (s > range.to) break
      const covered = !!ds.ga4 && !!ds.ga4Min && !!ga4Max && s >= ds.ga4Min && e <= ga4Max
      let v = 0
      let q = 0
      for (let d = s; d <= e; d = addDays(d, 1)) {
        v += dayV.get(d) || 0
        q += dayQ.get(d) || 0
      }
      points.push({
        start: s,
        end: e,
        visitors: covered ? v : null,
        ql: ds.streak ? q : null,
        crPct: covered ? pct(q, v) : null,
      })
    }
  }

  const bkCur = paidBk(paidCur)
  const bkPrev = paidBk(paidPrev)
  const rvCur = paidRv(paidCur)
  const rvPrev = paidRv(paidPrev)

  const hero: CroTowerResponse['hero'] = {
    visitorToQlPct: metric(crCur, crPrev, 3),
    visitors: metric(cur.visitors, prv?.visitors ?? null, 0),
    ql: metric(cur.ql, prv?.ql ?? null, 0),
    series: {
      unit: rp.series.unit,
      stepDays: rp.series.stepDays,
      start: rp.series.start,
      points,
      spark: points.map((p) => p.crPct),
    },
    qlToBookingPct: metric(pct(bkCur, cur.ql), pct(bkPrev, prv?.ql ?? null), 3),
    revenuePerVisitor: metric(div(rvCur, cur.visitors), div(rvPrev, prv?.visitors ?? null), 2),
    revenuePerQl: metric(div(rvCur, cur.ql), div(rvPrev, prv?.ql ?? null), 2),
  }

  // ── strip ──
  const avgCur = div(rvCur, bkCur)
  const avgPrev = div(rvPrev, bkPrev)
  const ytdRev = paidYtd ? paidYtd.revenue : null
  const strip: CroTowerResponse['strip'] = {
    spend: {
      ...metric(paidCur?.spend ?? null, paidPrev?.spend ?? null),
      meta: paidCur?.spendMeta ?? null,
      google: paidCur?.spendGoogle ?? null,
      bing: paidCur?.spendBing ?? null,
      chatgpt: paidCur?.spendChatgpt ?? null,
    },
    bookings: { ...metric(bkCur, bkPrev, 0), paid: bkCur, otherChannels: null },
    revenue: { ...metric(rvCur, rvPrev), paid: rvCur },
    roas: metric(bM ? paidCur?.roas ?? null : null, bM ? paidPrev?.roas ?? null : null, 3),
    cpl: { ...metric(paidCur?.cpl ?? null, paidPrev?.cpl ?? null), paidLeads: paidCur?.leads ?? null },
    cpql: { ...metric(paidCur?.cpql ?? null, paidPrev?.cpql ?? null), paidQl: paidCur?.ql ?? null },
    avgBooking: metric(avgCur, avgPrev),
    ytdPaidRevenue: { value: ytdRev, target: null, pctOfTarget: null, range: { from: ytdFrom, to: yesterday } },
  }
  flags.push('No annual paid-revenue target exists in config/funnel-targets.json: strip.ytdPaidRevenue.target is null.')

  // ── funnel ──
  const unattributed = {
    count: cur.bookingsTotal == null ? null : cur.bookingsTotal - cur.bookingsResolved,
    revenue: cur.revenueTotal == null ? null : cur.revenueTotal - [...cur.revenueByDomain.values()].reduce((s, x) => s + x, 0),
    note: 'Paid bookings whose booker could not be placed on a whitelisted domain (no landing_page on the booking row and no HubSpot first page for the client email). They are inside the Bookings step total.',
  }
  const cvr = (a: number | null, b: number | null, pa: number | null, pb: number | null): Metric =>
    metric(pct(b, a), pct(pb, pa), 3)
  const steps: FunnelStepOut[] = [
    {
      key: 'visitors',
      label: 'Visitors',
      source: 'GA4 · sessions · 4 main domains (ga4_host_lp)',
      metric: metric(cur.visitors, prv?.visitors ?? null, 0),
      cvrToNextPct: cvr(cur.visitors, cur.engaged, prv?.visitors ?? null, prv?.engaged ?? null),
    },
    {
      key: 'engaged',
      label: 'Engaged Visitors',
      source: 'GA4 · engaged sessions · 4 main domains',
      metric: metric(cur.engaged, prv?.engaged ?? null, 0),
      cvrToNextPct: cvr(cur.engaged, cur.inquiries, prv?.engaged ?? null, prv?.inquiries ?? null),
      note: 'Engaged is main domains only; Inquiries include the ship micro-sites (whitelist), per the definitions.',
    },
    {
      key: 'inquiries',
      label: 'Inquiries',
      source: 'HubSpot · website forms · whitelisted first_host (hubspot_contacts_all)',
      metric: metric(cur.inquiries, prv?.inquiries ?? null, 0),
      cvrToNextPct: cvr(cur.inquiries, cur.ql, prv?.inquiries ?? null, prv?.ql ?? null),
    },
    {
      key: 'ql',
      label: 'Qualified Leads',
      source: 'Streak · AI≥50 · excl. ASSET (streak_all, all channels)',
      metric: metric(cur.ql, prv?.ql ?? null, 0),
      cvrToNextPct: cvr(cur.ql, bkCur, prv?.ql ?? null, bkPrev),
      note: 'QL counts every Streak box of every channel; the box set is not limited to the website inquiries above.',
    },
    {
      key: 'bookings',
      label: 'Bookings',
      source: 'bookings_api · paid · close month (same source as /api/funnel)',
      metric: metric(bkCur, bkPrev, 0),
      revenue: metric(rvCur, rvPrev),
      cvrToNextPct: null,
    },
  ]

  // ── domains ──
  const get = (m: Counter | undefined, k: string) => (m ? m.get(k) || 0 : 0)
  const nullIf = <T,>(cond: boolean, v: T): T | null => (cond ? v : null)
  const hasGa4 = cur.visitors != null
  const hasGa4Prev = !!prv && prv.visitors != null
  const hasInq = cur.inquiries != null
  const hasInqPrev = !!prv && prv.inquiries != null
  const hasQlDom = cur.ql != null && !!ds.hub
  const hasQlDomPrev = !!prv && prv.ql != null && !!ds.hub
  const hasBk = cur.bookingsTotal != null

  const shipsV = (a: WindowAgg, m: 'visitorsByHost' | 'engagedByHost') => ds.ships.reduce((s, h) => s + get(a[m], h), 0)
  const shipsEv = (a: WindowAgg, m: 'formStarts' | 'formSubmits') => ds.ships.reduce((s, h) => s + get(a[m], h), 0)

  const domainRow = (key: string, label: string, kind: DomainRow['kind']): DomainRow => {
    const isShips = kind === 'ships'
    const web = kind === 'main' || isShips
    const vC = web ? nullIf(hasGa4, isShips ? shipsV(cur, 'visitorsByHost') : get(cur.visitorsByHost, key)) : null
    const vP = web && prv ? nullIf(hasGa4Prev, isShips ? shipsV(prv, 'visitorsByHost') : get(prv.visitorsByHost, key)) : null
    const eC = web ? nullIf(hasGa4, isShips ? shipsV(cur, 'engagedByHost') : get(cur.engagedByHost, key)) : null
    const eP = web && prv ? nullIf(hasGa4Prev, isShips ? shipsV(prv, 'engagedByHost') : get(prv.engagedByHost, key)) : null
    const iC = web ? nullIf(hasInq, get(cur.inquiriesByDomain, key)) : null
    const iP = web && prv ? nullIf(hasInqPrev, get(prv.inquiriesByDomain, key)) : null
    const qC = nullIf(hasQlDom, get(cur.qlByDomain, key))
    const qP = prv ? nullIf(hasQlDomPrev, get(prv.qlByDomain, key)) : null
    const rowFlags: string[] = []
    if (kind === 'unmatched') rowFlags.push('QL whose Streak email is not in hubspot_contacts_all — counted in the total, domain unknown.')
    if (kind === 'no_web_entry') rowFlags.push('QL matched to a HubSpot contact whose first page is not a whitelisted site (Facebook lead forms, offline imports).')
    if (web && vC != null && vP != null && vP > 0 && vC / vP < 0.5) rowFlags.push(`traffic ${round(((vC - vP) / vP) * 100, 0)}% vs previous period · check tagging`)
    return {
      key,
      label,
      kind,
      visitors: metric(vC, vP, 0),
      engaged: metric(eC, eP, 0),
      inquiries: metric(iC, iP, 0),
      ql: metric(qC, qP, 0),
      crPct: metric(web ? pct(qC, vC) : null, web ? pct(qP, vP) : null, 3),
      bookings: web && hasBk ? get(cur.bookingsByDomain, key) : null,
      revenue: web && hasBk ? get(cur.revenueByDomain, key) : null,
      formStarts: web && ds.events ? (isShips ? shipsEv(cur, 'formStarts') : get(cur.formStarts, key)) : null,
      formSubmits: web && ds.events ? (isShips ? shipsEv(cur, 'formSubmits') : get(cur.formSubmits, key)) : null,
      flags: rowFlags,
    }
  }
  const domainRows: DomainRow[] = [
    ...MAIN_DOMAINS.map((d) => domainRow(d, d, 'main')),
    domainRow('ships', `Ship micro-sites (${ds.ships.length} domains)`, 'ships'),
    domainRow('no_web_entry', 'No website entry (lead forms / offline)', 'no_web_entry'),
    domainRow('unmatched', 'Unmatched (email not in HubSpot)', 'unmatched'),
  ]
  const ships: ShipRow[] = ds.ships
    .map((h) => ({
      host: h,
      visitors: hasGa4 ? get(cur.visitorsByHost, h) : null,
      prevVisitors: hasGa4Prev && prv ? get(prv.visitorsByHost, h) : null,
    }))
    .sort((x, y) => (y.visitors ?? 0) - (x.visitors ?? 0))
  const mainSum = (a: WindowAgg | null, m: 'inquiriesByDomain' | 'qlByDomain') =>
    a ? MAIN_DOMAINS.reduce((s, d) => s + get(a[m], d), 0) : null
  const mqC = hasQlDom ? mainSum(cur, 'qlByDomain') : null
  const mqP = hasQlDomPrev ? mainSum(prv, 'qlByDomain') : null
  const mainTotal = {
    visitors: metric(cur.visitors, prv?.visitors ?? null, 0),
    engaged: metric(cur.engaged, prv?.engaged ?? null, 0),
    inquiries: metric(hasInq ? mainSum(cur, 'inquiriesByDomain') : null, hasInqPrev ? mainSum(prv, 'inquiriesByDomain') : null, 0),
    ql: metric(mqC, mqP, 0),
    crPct: metric(pct(mqC, cur.visitors), pct(mqP, prv?.visitors ?? null), 3),
    bookings: hasBk ? MAIN_DOMAINS.reduce((s, d) => s + get(cur.bookingsByDomain, d), 0) : null,
    revenue: hasBk ? MAIN_DOMAINS.reduce((s, d) => s + get(cur.revenueByDomain, d), 0) : null,
  }

  // ── channels ──
  const paidSpend: Record<string, number | null> = {
    'Paid social': paidCur?.spendMeta ?? null,
    'Paid search': sumNullable(paidCur?.spendGoogle, paidCur?.spendBing, paidCur?.spendChatgpt),
  }
  const paidBkCh: Record<string, number | null> = {
    'Paid social': bM ? paidCur?.bookingsMeta ?? null : null,
    'Paid search': bM ? sumNullable(paidCur?.bookingsGoogle, paidCur?.bookingsBing, paidCur?.bookingsChatgpt) : null,
  }
  const paidRvCh: Record<string, number | null> = {
    'Paid social': bM ? paidCur?.revenueMeta ?? null : null,
    'Paid search': bM ? sumNullable(paidCur?.revenueGoogle, paidCur?.revenueBing, paidCur?.revenueChatgpt) : null,
  }
  const chKeys: string[] = [...CRO_CHANNELS, UNMAPPED]
  const channelRows: ChannelRow[] = chKeys.map((k) => {
    const vC = nullIf(hasGa4, get(cur.visitorsByChannel, k))
    const vP = prv ? nullIf(hasGa4Prev, get(prv.visitorsByChannel, k)) : null
    const iC = nullIf(hasInq, get(cur.inquiriesByChannel, k))
    const iP = prv ? nullIf(hasInqPrev, get(prv.inquiriesByChannel, k)) : null
    const qC = nullIf(cur.ql != null, get(cur.qlByChannel, k))
    const qP = prv ? nullIf(prv.ql != null, get(prv.qlByChannel, k)) : null
    const spend = k in paidSpend ? paidSpend[k] : null
    const bookings = k in paidBkCh ? paidBkCh[k] : null
    const revenue = k in paidRvCh ? paidRvCh[k] : null
    return {
      key: k,
      label: k === UNMAPPED ? 'Unmapped' : k,
      visitors: metric(vC, vP, 0),
      inquiries: metric(iC, iP, 0),
      ql: metric(qC, qP, 0),
      crPct: metric(pct(qC, vC), pct(qP, vP), 3),
      spend,
      bookings,
      revenue,
      revenuePerInquiry: revenue == null ? null : div(revenue, iC),
      roas: revenue == null || spend == null || spend <= 0 ? null : round(revenue / spend, 3),
    }
  })
  const chTotal = {
    visitors: cur.visitors,
    inquiries: cur.inquiries,
    ql: cur.ql,
    spend: paidCur?.spend ?? null,
    bookings: bkCur,
    revenue: rvCur,
  }

  // ── pages ──
  const pageKeys = [...cur.visitorsByPage.entries()]
    .filter(([k]) => !k.endsWith('(not set)'))
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)
  const pageRows: PageRow[] = hasGa4
    ? pageKeys.map(([k, v]) => {
        const slash = k.indexOf('/')
        const host = slash < 0 ? k : k.slice(0, slash)
        const path = slash < 0 ? '/' : k.slice(slash)
        const asset = ASSET_PATH.test(path)
        const q = asset || !hasQlDom ? null : get(cur.qlByPage, k)
        return {
          key: host + path,
          host,
          path,
          asset,
          visitors: v,
          inquiries: get(cur.inquiriesByPage, k),
          ql: q,
          crPct: q == null ? null : pct(q, v),
          bookings: hasBk ? (asset ? null : get(cur.bookingsByPage, k)) : null,
          revenue: hasBk ? (asset ? null : get(cur.revenueByPage, k)) : null,
        }
      })
    : []
  const bookingsOnTop = hasBk ? pageRows.reduce((s, r) => s + (r.bookings || 0), 0) : null

  // ── unmapped + match rates ──
  const topOf = (m: Counter, k: number) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, k)
  const unmappedGa4 = get(cur.visitorsByChannel, UNMAPPED)
  const unmappedHub = get(cur.inquiriesByChannel, UNMAPPED)
  const unmappedSt = get(cur.qlByChannel, UNMAPPED)

  const response: CroTowerResponse = {
    hero,
    strip,
    funnel: { steps, unattributedBookings: unattributed },
    domains: { rows: domainRows, ships, mainTotal },
    channels: { rows: channelRows, total: chTotal },
    pages: {
      rows: pageRows,
      bookingsOnTopPages: bookingsOnTop,
      bookingsTotal: cur.bookingsTotal,
      note: 'Top 8 entry pages by visitors across whitelisted hosts (GA4 "(not set)" excluded). Inquiries by HubSpot first_host + first_path; QL via Streak email → HubSpot first page; bookings via booking landing_page or client email → HubSpot first page. ASSET pages: QL and bookings n/a by rule.',
    },
    meta: {
      period,
      anchor: rp.anchor,
      range,
      prevRange: prev,
      yesterday,
      generatedAt: new Date().toISOString(),
      cached: false,
      sources: {
        visitors: `${CRO_TABS.GA4_HOST_LP} (GA4 property 311674241, host × LP × source/medium × day)`,
        formEvents: `${CRO_TABS.GA4_HOST_EVENTS} (form_start / form_submit)`,
        inquiries: `${CRO_TABS.HUBSPOT_ALL} (is_inquiry = 1, whitelisted first_host, INQUIRY_FORM_EXCLUDE applied)`,
        ql: `${CRO_TABS.STREAK_ALL} (is_ql = 1, all channels)`,
        bookings: `${CRO_TABS.BOOKINGS} (paid only, close month) — headline via loadBusinessFunnel()`,
        paid: 'lib/business-funnel.ts loadBusinessFunnel({campaign: master, channel: all}) — same numbers as /api/funnel',
        channels: 'lib/cro-channel-map.ts (to confirm with Tadej / Aymen)',
      },
      freshness,
      unmapped: {
        ga4: {
          visitors: unmappedGa4,
          share: pct(unmappedGa4, cur.visitors, 2),
          top: topOf(cur.unmappedGa4, 8).map(([key, v]) => ({ key, visitors: v })),
        },
        hubspot: {
          inquiries: unmappedHub,
          share: pct(unmappedHub, cur.inquiries, 2),
          top: topOf(cur.unmappedHub, 8).map(([key, v]) => ({ key, inquiries: v })),
        },
        streak: {
          ql: unmappedSt,
          share: pct(unmappedSt, cur.ql, 2),
          top: topOf(cur.unmappedStreak, 8).map(([key, v]) => ({ key, ql: v })),
        },
      },
      matchRates: {
        qlEmailToHubspot: { matched: cur.qlMatched, total: cur.ql ?? 0, ratePct: pct(cur.qlMatched, cur.ql, 1) },
        bookingsToDomain: { matched: cur.bookingsResolved, total: cur.bookingsTotal ?? 0, ratePct: pct(cur.bookingsResolved, cur.bookingsTotal, 1) },
      },
      inquiryExclusions: INQUIRY_FORM_EXCLUDE.map((x) => ({ key: x.key, label: x.label, proposed: x.proposed, count: get(cur.excludedByRule, x.key) })),
      inquiriesOutsideWhitelist: {
        count: [...cur.outsideWhitelist.values()].reduce((s, x) => s + x, 0),
        topHosts: topOf(cur.outsideWhitelist, 8).map(([host, count]) => ({ host, count })),
      },
      paid: { current: paidCur, prev: paidPrevRaw, ytd: paidYtd },
      reconciliation: recon,
      definitions: {
        visitors: 'GA4 sessions on the 4 main domains (ships separate)',
        engaged: 'GA4 engaged sessions (10 s / 2 pages / key event), 4 main domains',
        inquiries: 'HubSpot contacts with a website form (is_inquiry = 1), whitelisted first_host (main + ships), minus INQUIRY_FORM_EXCLUDE, dated by createdate',
        ql: 'Streak boxes with AI ≥ 50, ASSET excluded, all channels, dated by inquiry_date; domain / LP via email → HubSpot first page',
        bookings: 'bookings_api paid bookings in their close month; domain / LP via landing_page or client email → HubSpot first page',
        prev: 'same-length window immediately before (month-aligned; MTD compares to the same days of the previous month)',
      },
      flags,
    },
  }
  return response
}
