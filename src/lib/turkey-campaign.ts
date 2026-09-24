// src/lib/turkey-campaign.ts
//
// Turkey Campaign 2026 dashboard data layer — Tosca + Belgin Sultan fleet-fill.
//
// Built to Mitja's 2026-05-25 KPI spec (three layers):
//   A. MAIN KPI    — weeks filled vs target per yacht + cost-to-fill vs thresholds.
//   B. BLUE/RED    — Blue1 (Tosca/Belgin RVC + weeks), Blue2 (cross-pollination RVC),
//                    Red1 (campaign cost). "Keep pushing while Blue1+Blue2 ≈ Red1."
//                    Plus Cost-per-booking vs Earnings-per-booking (viewed in batches).
//   C. YACHT QL    — optimisation layer. A lead is Yacht QL only if ALL hold:
//                    AI≥50 · group ≤ capacity · budget fits yacht · destination=Turkey ·
//                    desired date in 2026.
//
// Sources: streak_sync (leads), bookings (campaign-attributed), fb_ads_enriched +
// daily (spend), turkey_availability (synced fleet calendar).

import { fetchStreakSync, fetchBookings, fetchSheet, fetchHubspotContacts } from './sheetsData'
import { fetchFbAdsLevel } from './facebook-ads-level'
import type { StreakLeadRow, BookingRecord, HubSpotContactRow } from './sheetsData'
import { getSheetsUrl, DEFAULT_WEB_APP_URL, SHEETS_TABS } from './config'

// ─── Config ───────────────────────────────────────────────────────────────

export interface TurkeyYacht {
  id: string
  name: string          // matches bookings.vessel + turkey_availability.yacht
  target: number        // weeks Mitja wants filled (NEW, from campaign push)
  baseline: number      // weeks already filled at campaign start (excluded from progress)
  maxGuests: number
  budgetMin: number     // lead budget bracket must reach this to "fit" the yacht
  priceFrom: number     // list price floor €/week (used as earnings reference)
  specs: string
  utmPattern: string    // source_placement token for this yacht's dedicated campaigns
}

export const TURKEY_CONFIG = {
  // Baselines captured 2026-05-25 from the live booking list (Belgin 6 filled, Tosca 2).
  // Mitja: count only weeks filled FROM NOW; the pre-existing ones don't count.
  baselineDate: '2026-05-25',
  // All Turkey-campaign spend in 2026 counts toward cost-to-fill.
  campaignStart: '2026-01-01',
  yachts: [
    { id: 'tosca', name: 'TOSCA', target: 15, baseline: 2, maxGuests: 12, budgetMin: 20000, priceFrom: 27000, specs: '36m · 12 guests · Turkey', utmPattern: 'tosca' },
    { id: 'belgin', name: 'BELGIN SULTAN', target: 10, baseline: 6, maxGuests: 10, budgetMin: 20000, priceFrom: 25200, specs: '35m · 10 guests · Turkey', utmPattern: 'belgin' },
  ] as TurkeyYacht[],
  thresholds: { warning: 80000, target: 100000, max: 140000 },
  // source_placement / campaign tokens that belong to the Turkey campaign.
  campaignPatterns: ['turkey', 'tosca', 'belgin', 'esma'],
  // QL→Booking conversion Mitja hopes for.
  targetConversion: 4, // %
}

// Sanity ceiling for a single campaign-DAY of FB spend (fb_ads_enriched.spend is
// occasionally corrupt). The whole account spends ~€1.7K/day across all campaigns,
// so anything above this is a data error and is dropped, not summed.
const MAX_CAMPAIGN_DAY_SPEND = 5000

const YACHT_NAMES = TURKEY_CONFIG.yachts.map((y) => y.name.toUpperCase())

// ─── Parsing helpers ────────────────────────────────────────────────────────

const normalize = (s?: string) => (s || '').toLowerCase()
const normCampaign = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const isGoogleLead = (l: StreakLeadRow) =>
  /google|adwords/i.test(l.platform || '') || /paid_search/i.test(l.source_category || '')
// Streak abbreviates some Google campaign names — map them back to the canonical campaign.
const CAMPAIGN_ALIASES: Record<string, string> = {
  'search latam': 'Search - Croatia, Turkey - LATM',
}
const canonicalGoogleCampaign = (detail: string) =>
  CAMPAIGN_ALIASES[normCampaign(detail)] || (detail || '')

/** Budget bracket → minimum €/week the lead can spend. */
export function parseBudgetMin(budgetRange: string): number {
  const b = budgetRange || ''
  if (b.includes('More than €500,000')) return 500000
  if (b.includes('€250,000 to €500,000')) return 250000
  if (b.includes('€100,000 to €250,000')) return 100000
  if (b.includes('€60,000 to €100,000')) return 60000
  if (b.includes('€30,000 to €60,000')) return 30000
  if (b.includes('€20,000 to €30,000')) return 20000
  if (b.includes('€10,000 to €20,000')) return 10000
  if (b.includes('Up to €10,000')) return 0
  if (b.includes('Up to €20,000')) return 10000
  return 0
}

/** Tolerant date parser: handles "24. 5. 2026", ISO, slashes, Sheets serials. */
function parseDate(raw: any): Date | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') {
    // Google Sheets serial (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + raw * 86400000)
  }
  const s = String(raw).trim()
  // SI dotted "24. 5. 2026" or "24.5.2026"
  let m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
  // ISO YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  // YYYY-MM
  m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, 1))
  const d = new Date(s)
  return Number.isNaN(+d) ? null : d
}

// ─── Campaign window ────────────────────────────────────────────────────────
// The Turkey fleet-fill push + its new budget started 1 May 2026. Everything on this
// dashboard (spend, leads, bookings) is scoped from here, so pre-existing always-on Turkey
// activity (Jan–Apr) is excluded and the numbers reflect ONLY this campaign. The Google Ads
// sync is floored at the same date at source (turkey_google_campaigns is already May-1+).
export const CAMPAIGN_FLOOR = '2026-05-01'
const CAMPAIGN_FLOOR_MS = Date.UTC(2026, 4, 1)
/** True if the raw date is on or after the campaign floor. Undated rows are excluded. */
function onOrAfterFloor(raw: any): boolean {
  const d = parseDate(raw)
  return d ? +d >= CAMPAIGN_FLOOR_MS : false
}

/** Desired-date "in 2026" check on the free-text `when` field.
 *  Excludes only explicit future seasons (2027/2028); 2026 or no-year passes. */
function whenYear(when?: string): '2026' | 'future' | 'none' {
  const w = (when || '').toString()
  if (/202[789]|2030/.test(w)) return 'future'
  if (/2026/.test(w)) return '2026'
  return 'none'
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type WeekStatus = 'available' | 'booked' | 'paperwork' | 'on_request'

// Bookings only count when they come from paid ads (Dejan 2026-05-25).
const PAID_SOURCES = ['fb_landing', 'fb_lead', 'google']
const isPaidBooking = (b: BookingRecord) => PAID_SOURCES.includes((b.source || '').toLowerCase().trim())

export interface AvailWeek {
  yacht: string
  season: number
  startIso: string
  endIso: string
  label: string
  status: WeekStatus
  price: number | null
  filled: boolean
  confirmed: boolean
}

export interface YachtFill {
  id: string
  name: string
  specs: string
  priceFrom: number
  target: number
  baseline: number
  totalWeeks: number
  filled: number       // booked + paperwork now
  confirmed: number    // booked only
  paperwork: number
  available: number
  onRequest: number
  newFills: number     // filled − baseline (progress toward target)
  progressPct: number  // newFills / target
  directSpend: number  // spend from this yacht's dedicated campaigns
  attributedBookings: number
  attributedRvc: number
  forward2027: number  // weeks already filled for next season
  weeks: AvailWeek[]
}

export interface ColumnsKpi {
  blue1: {
    rvc: number; weeks: number; bookings: number            // Tosca + Belgin combined
    tosca: { rvc: number; bookings: number }                // split for the per-yacht columns
    belgin: { rvc: number; bookings: number }
  }
  blue2: { rvc: number; bookings: number }                  // cross-pollination
  red1: { spend: number; fbSpend: number; googleSpend: number }
  combinedBlue: number
  ratio: number            // (blue1+blue2) / red1
  status: 'push' | 'watch' | 'pull'
}

export interface Economics {
  totalBookings: number
  costPerBooking: number
  earningsPerBooking: number
  netPerBooking: number
}

// HubSpot-sourced detail for the click-to-expand lead card (how they arrived + which form).
export interface HsDetail {
  formName: string       // recent/first conversion event = the form/LP they submitted
  firstUrlPath: string   // entry landing page
  lastUrlPath: string    // last page before/at conversion
  source: string         // hs_analytics_source (PAID_SOCIAL, PAID_SEARCH, …)
  sourceDetail: string   // hs_analytics_source_data_1 (Facebook, Google, …)
  utmContent: string     // the individual ad
  utmCampaign: string
  createdate: string
}

export interface YachtQlLead {
  inquiry_date: string
  source: string
  yacht: string            // tosca | belgin | turkey (generic)
  channel: 'google' | 'facebook'
  creative: string         // FB: source_placement · Google: source_detail (campaign)
  lp: string               // HubSpot first_url_path (landing page)
  adId: string             // HubSpot utm_content (individual ad)
  name?: string
  country?: string
  ai_score: number
  budget_range?: string
  size_of_group?: number
  destination?: string
  when?: string
  stage?: string
  passAi: boolean
  passCapacity: boolean
  passBudget: boolean
  passDestination: boolean
  passDate: boolean
  isQl: boolean
  isYachtQl: boolean
  hsDetail: HsDetail | null
}

// Creative / LP performance (HubSpot-enriched). Thumbnail slot filled later from
// a manual screenshot mapping — no FB Marketing API (Vetle-ban risk).
export interface CreativeRow {
  creative: string
  channel: 'google' | 'facebook'
  yacht: YachtBucket
  topLp: string
  ads: number          // distinct utm_content count
  leads: number
  ql: number
  yachtQl: number
  qlRate: number
  yachtQlRate: number  // yachtQl / ql
  thumbnail: string | null
}

// Campaign-level performance (FB or Google) with spend + the agreed metrics.
export interface CampaignRow {
  campaign: string
  channel: 'google' | 'facebook'
  spend: number
  leads: number
  ql: number
  yachtQl: number
  avgAi: number
  cpl: number          // spend / leads
  cpql: number         // spend / QL
  cpYachtQl: number    // spend / Yacht QL
  qlRate: number       // QL / leads
}

export interface ConditionFails {
  ai: number
  capacity: number
  budget: number
  destination: number
  date: number
}

export interface TurkeyCampaignResult {
  generatedAt: string
  since: string   // campaign floor (1 May 2026) — the dashboard window start
  days: number    // days elapsed since the floor
  config: typeof TURKEY_CONFIG
  fills: YachtFill[]
  costToFill: {
    spent: number
    thresholds: typeof TURKEY_CONFIG.thresholds
    byYacht: { tosca: number; belgin: number; shared: number }
  }
  columns: ColumnsKpi
  economics: Economics
  traffic: { impressions: number; clicks: number; lpViews: number }  // upper funnel: FB raw + Google API
  funnel: {
    leads: number
    ql: number
    yachtQl: number
    bookings: number
    leadToQl: number
    qlToYachtQl: number
    yachtQlToBooking: number
    yachtQlRatio: number   // yachtQl / leads
  }
  perYachtQl: { id: string; name: string; leads: number; ql: number; yachtQl: number; yachtQlRatio: number }[]
  creatives: CreativeRow[]    // FB ad/creative level (ad-set granularity, no per-ad spend)
  fbCampaigns: CampaignRow[]  // FB campaign level
  googleCampaigns: CampaignRow[]  // Google campaign level
  conditionFails: ConditionFails
  whenBreakdown: { y2026: number; future: number; none: number }
  hubspotMatched: number   // how many leads enriched from HubSpot
  leads: YachtQlLead[]
}

// ─── Loaders ──────────────────────────────────────────────────────────────

async function loadAvailability(): Promise<AvailWeek[]> {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  let rows: any[][] = []
  try {
    rows = await fetchSheet({ sheetUrl, tab: SHEETS_TABS.TURKEY_AVAILABILITY })
  } catch {
    return []
  }
  if (!rows || rows.length < 2) return []
  const [header, ...data] = rows
  const idx = (n: string) => header.findIndex((h) => String(h).trim().toLowerCase() === n)
  const I = {
    yacht: idx('yacht'), season: idx('season'), start: idx('week_start'), end: idx('week_end'),
    label: idx('week_label'), status: idx('status'), price: idx('price'),
    filled: idx('filled'), confirmed: idx('confirmed'),
  }
  return data
    .filter((r) => r[I.yacht])
    .map((r) => ({
      yacht: String(r[I.yacht]).toUpperCase(),
      season: Number(r[I.season] ?? 2026) || 2026,
      startIso: String(r[I.start] ?? ''),
      endIso: String(r[I.end] ?? ''),
      label: String(r[I.label] ?? ''),
      status: String(r[I.status] ?? 'available') as WeekStatus,
      price: r[I.price] !== '' && r[I.price] != null ? Number(r[I.price]) : null,
      filled: String(r[I.filled]).toUpperCase() === 'TRUE',
      confirmed: String(r[I.confirmed]).toUpperCase() === 'TRUE',
    }))
}

interface SpendByCampaign {
  fb: number
  google: number
  total: number
  byYacht: Record<string, number>
  fbByCampaign: Record<string, number>
  googleByCampaign: Record<string, number>
}

function matchYachtFromCampaign(campaign: string): string | null {
  const c = normalize(campaign)
  for (const y of TURKEY_CONFIG.yachts) {
    if (c.includes(y.utmPattern)) return y.id
  }
  return null // generic Turkey (shared)
}

function isTurkeyCampaign(campaign: string): boolean {
  const c = normalize(campaign)
  // MIXED campaigns are NOT Turkey-specific — they mostly drive Croatia, so counting them
  // pulls Croatia bookings into the Turkey campaign (e.g. the PREMIER €28,520 Croatia booking
  // from "Search - Croatia, Turkey - LATM"). Excluded here to stay consistent with the monthly
  // report and to keep Turkey earnings honest. Same rule for the general "Landing Gulets" LP.
  if (/croatia,?\s*turkey/.test(c)) return false
  if (/landing gulets/.test(c)) return false
  return TURKEY_CONFIG.campaignPatterns.some((p) => c.includes(p))
}

async function loadSpend(): Promise<SpendByCampaign> {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  const result: SpendByCampaign = { fb: 0, google: 0, total: 0, byYacht: {}, fbByCampaign: {}, googleByCampaign: {} }

  // FB — fb_ads_enriched is daily (one row per campaign per day). Floor each row at the
  // campaign start via date_iso so only May-1-onward spend counts.
  try {
    const fb = await fetchSheet({ sheetUrl, tab: SHEETS_TABS.FB_ENRICHED })
    const [h, ...rows] = fb
    const ci = h.findIndex((x) => /campaign/i.test(String(x)))
    const si = h.findIndex((x) => /spend_num|^spend$/i.test(String(x)))
    const di = h.findIndex((x) => /date_iso/i.test(String(x)))
    for (const r of rows) {
      const camp = String(r[ci] ?? '')
      if (!isTurkeyCampaign(camp)) continue
      if (di !== -1 && !onOrAfterFloor(r[di])) continue
      const spend = Number(r[si] ?? 0) || 0
      // Guard against corrupt sync values in fb_ads_enriched.spend. The whole ad
      // account spends ~€1.7K/DAY across all campaigns, so any single campaign-day
      // spend over the cap is a data error, not real. (Seen: 2026-06-29
      // "TURKEY – Calculator - ABO" row = €46,200 vs a real ~€25 — it alone inflated
      // cost-to-fill from ~€36K to €82K.) Drop the bad row rather than trust it.
      if (spend > MAX_CAMPAIGN_DAY_SPEND) {
        console.warn(`[turkey] dropping implausible FB spend €${Math.round(spend)} for "${camp}" on ${r[di]}`)
        continue
      }
      result.fb += spend
      result.fbByCampaign[camp] = (result.fbByCampaign[camp] || 0) + spend
      const yid = matchYachtFromCampaign(camp)
      if (yid) result.byYacht[yid] = (result.byYacht[yid] || 0) + spend
    }
  } catch (e) { console.warn('[turkey] fb spend failed', (e as Error).message); throw e } // propagate — don't silently return Google-only spend

  // Google fallback — daily tab (only used if the Google Ads API tab is empty; that tab is
  // already May-1-floored at the sync). Floor by the row date too, for consistency.
  try {
    const g = await fetchSheet({ sheetUrl, tab: SHEETS_TABS.DAILY })
    const [h, ...rows] = g
    const ci = h.findIndex((x) => /campaign$/i.test(String(x)) || String(x).toLowerCase() === 'campaign')
    const si = h.findIndex((x) => /^cost$/i.test(String(x)))
    const di = h.findIndex((x) => /^date$/i.test(String(x)) || String(x).toLowerCase() === 'date')
    for (const r of rows) {
      const camp = String(r[ci] ?? '')
      if (!isTurkeyCampaign(camp)) continue
      if (di !== -1 && !onOrAfterFloor(r[di])) continue
      const cost = Number(r[si] ?? 0) || 0
      result.google += cost
      result.googleByCampaign[camp] = (result.googleByCampaign[camp] || 0) + cost
      const yid = matchYachtFromCampaign(camp)
      if (yid) result.byYacht[yid] = (result.byYacht[yid] || 0) + cost
    }
  } catch (e) { console.warn('[turkey] google spend failed', (e as Error).message) }

  result.total = result.fb + result.google
  return result
}

export interface GoogleApiCampaign { name: string; spend: number; impressions: number; clicks: number; conversions: number }

/** Turkey Google spend per CAMPAIGN, aggregated from the `turkey_google_campaigns` tab which
 *  holds one row per Turkey AD GROUP (Croatia ad groups inside mixed campaigns are excluded
 *  upstream). Returns [] if absent → caller falls back to daily-based spend. */
async function loadGoogleApiCampaigns(): Promise<GoogleApiCampaign[]> {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  let rows: any[][] = []
  try {
    rows = await fetchSheet({ sheetUrl, tab: SHEETS_TABS.TURKEY_GOOGLE_CAMPAIGNS })
  } catch {
    return []
  }
  if (!rows || rows.length < 2) return []
  const [h, ...data] = rows
  const idx = (n: string) => h.findIndex((x) => String(x).trim().toLowerCase() === n)
  const I = { name: idx('campaign'), cost: idx('cost'), impr: idx('impressions'), clk: idx('clicks'), conv: idx('conversions') }
  if (I.name === -1) return []
  const byCamp = new Map<string, GoogleApiCampaign>()
  for (const r of data) {
    const name = String(r[I.name] || '')
    if (!name) continue
    const e = byCamp.get(name) || { name, spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    e.spend += Number(r[I.cost] ?? 0) || 0
    e.impressions += Number(r[I.impr] ?? 0) || 0
    e.clicks += Number(r[I.clk] ?? 0) || 0
    e.conversions += Number(r[I.conv] ?? 0) || 0
    byCamp.set(name, e)
  }
  return Array.from(byCamp.values())
}

/** Upper-funnel FB metrics (impressions, link clicks, LP views) from fb_ads_raw — the only FB tab
 *  that carries impressions. Turkey campaigns only, floored at the campaign start (date_start). */
async function loadFbRawTraffic(): Promise<{ impressions: number; clicks: number; lpViews: number }> {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  const out = { impressions: 0, clicks: 0, lpViews: 0 }
  try {
    const rows = await fetchSheet({ sheetUrl, tab: SHEETS_TABS.FB_RAW })
    if (!rows || rows.length < 2) return out
    const [h, ...data] = rows
    const idx = (re: RegExp) => h.findIndex((x) => re.test(String(x)))
    const ci = idx(/campaign_name/i)
    const di = idx(/date_start/i)
    const ii = idx(/\bimpressions$/i)              // data.impressions
    const lci = idx(/actions\.link_click$/i)       // data.actions.link_click (link clicks, not all clicks)
    const lpi = idx(/actions\.landing_page_view$/i)
    for (const r of data) {
      if (!isTurkeyCampaign(String(r[ci] ?? ''))) continue
      if (di !== -1 && !onOrAfterFloor(r[di])) continue
      out.impressions += Number(r[ii] ?? 0) || 0
      out.clicks += Number(r[lci] ?? 0) || 0
      out.lpViews += Number(r[lpi] ?? 0) || 0
    }
  } catch (e) { console.warn('[turkey] fb raw traffic failed', (e as Error).message) }
  return out
}

/** (campaign|search_term) pairs served by Turkey ad groups — exact lead→ad-group attribution.
 *  Returns a Set of `${normCampaign(campaign)}|${normCampaign(term)}`. Empty if tab absent. */
async function loadGoogleTurkeyTerms(): Promise<Set<string>> {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  let rows: any[][] = []
  try {
    rows = await fetchSheet({ sheetUrl, tab: SHEETS_TABS.TURKEY_GOOGLE_TERMS })
  } catch {
    return new Set()
  }
  if (!rows || rows.length < 2) return new Set()
  const [h, ...data] = rows
  const idx = (n: string) => h.findIndex((x) => String(x).trim().toLowerCase() === n)
  const ci = idx('campaign'); const ti = idx('search_term')
  if (ci === -1 || ti === -1) return new Set()
  const set = new Set<string>()
  for (const r of data) {
    if (!r[ci] || r[ti] == null) continue
    set.add(`${normCampaign(String(r[ci]))}|${normCampaign(String(r[ti]))}`)
  }
  return set
}

// ─── Core ───────────────────────────────────────────────────────────────────

function leadIsTurkeyCampaign(lead: StreakLeadRow): boolean {
  // Google: membership by the CAMPAIGN (source_detail, aliased) — NOT the raw search term.
  // This excludes a Croatia campaign (e.g. "us - sem - tofu") that merely captured a Turkey query.
  if (isGoogleLead(lead)) return isTurkeyCampaign(canonicalGoogleCampaign(lead.source_detail || ''))
  return isTurkeyCampaign(lead.source_placement)
}

// Yacht classification rule (Dejan 2026-05-25): utm token decides the bucket.
//   tosca → Tosca · belgin → Belgin (campaign pre-launch, mostly LP-test leads) ·
//   everything else (incl. the dominant esma-sultan-kids creative) → General Turkey.
export type YachtBucket = 'tosca' | 'belgin' | 'turkey'
function classifyYacht(utm: string): YachtBucket {
  const s = normalize(utm)
  if (s.includes('tosca')) return 'tosca'
  if (s.includes('belgin')) return 'belgin'
  return 'turkey'
}
function leadYacht(lead: StreakLeadRow): YachtBucket {
  return classifyYacht(lead.source_placement)
}

// ── Thumbnail matching ──────────────────────────────────────────────────────
// The FB creative table is keyed by the Streak UTM token (source_placement), while
// Meta thumbnails live in fb_ads_level keyed by ad NAME (Meta never exports the UTM,
// so there's no id-level bridge). We match on distinctive-token overlap between the
// UTM creative and the ad name. This is safe for IMAGES specifically — we're matching
// creative identity, not distributing metrics, so a near-match thumbnail is low-stakes —
// and we require ≥2 shared distinctive tokens before attaching anything, leaving a
// placeholder otherwise (better blank than the wrong creative).
const THUMB_STOPWORDS = new Set([
  'landing', 'turkey', 'croatia', 'cold', 'warm', 'interesi', 'interes', 'abo', 'lf',
  'retargeting', 'retarget', 'lookalike', 'lal', 'new', 'cbo', 'video', 'copy', 'img',
  'image', 'vertical', 'vertikal', 'horizontal', 'pisarna', 'ssy', 'drone', 'carousel',
  'sail', 'aboard', 'luxury', 'the', 'of', 'sultan', '2024', '2025', '2026', '2027',
  'smarter', 'way', 'broad', 'test', 'ad', 'ads', 'reel', 'story', 'feed', 'last', 'minute',
  'lastminute',
])
function thumbTokens(s: string): Set<string> {
  return new Set(
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')   // split camelCase: "MihaSever" → "Miha Sever"
      .toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !THUMB_STOPWORDS.has(t))
  )
}
function buildThumbMatcher(ads: { adName: string; thumbUrl: string }[]) {
  const indexed = ads
    .filter((a) => a.thumbUrl && a.adName)
    .map((a) => ({ thumbUrl: a.thumbUrl, tokens: thumbTokens(a.adName) }))
  return (creative: string): string | null => {
    const ct = thumbTokens(creative)
    if (ct.size === 0) return null
    let best: { score: number; thumb: string } | null = null
    for (const a of indexed) {
      let shared = 0
      for (const t of ct) if (a.tokens.has(t)) shared++
      if (shared >= 2 && (!best || shared > best.score)) best = { score: shared, thumb: a.thumbUrl }
    }
    return best ? best.thumb : null
  }
}

export async function loadTurkeyCampaign(): Promise<TurkeyCampaignResult> {
  const [streak, bookings, availability, spend, hubspot, googleApi, googleTurkeyTerms, fbTraffic, fbAdsLevel] = await Promise.all([
    fetchStreakSync(fetchSheet),
    fetchBookings(),
    loadAvailability(),
    loadSpend(),
    fetchHubspotContacts(fetchSheet),
    loadGoogleApiCampaigns(),
    loadGoogleTurkeyTerms(),
    loadFbRawTraffic(),
    fetchFbAdsLevel().catch(() => []),
  ])

  // Thumbnail matcher: bridge UTM creative token → Meta ad thumbnail (see buildThumbMatcher).
  const matchThumb = buildThumbMatcher(fbAdsLevel)

  // Upper-funnel traffic: FB raw + Google API (both May-1 floored). LP views are FB-only.
  const traffic = {
    impressions: fbTraffic.impressions + googleApi.reduce((s, c) => s + c.impressions, 0),
    clicks: fbTraffic.clicks + googleApi.reduce((s, c) => s + c.clicks, 0),
    lpViews: fbTraffic.lpViews,
  }

  // Turkey membership. Google: a lead counts only if its (campaign|search-term) was served by a
  // TURKEY ad group (exact, excludes Croatia ad groups in mixed campaigns). Fallback to campaign
  // name if the term tab isn't synced yet. FB: by creative (source_placement).
  const isTurkeyLead = (l: StreakLeadRow): boolean => {
    if (isGoogleLead(l)) {
      if (googleTurkeyTerms.size > 0) {
        return googleTurkeyTerms.has(`${normCampaign(canonicalGoogleCampaign(l.source_detail || ''))}|${normCampaign(l.source_placement || '')}`)
      }
      return isTurkeyCampaign(canonicalGoogleCampaign(l.source_detail || ''))
    }
    return isTurkeyCampaign(l.source_placement)
  }

  // HubSpot enrichment: email → { utm_campaign (creative), utm_content (ad), first_url_path (LP) }.
  // HubSpot carries creative/LP/ad granularity that Streak's source_placement lacks.
  const hsByEmail = new Map<string, HubSpotContactRow>()
  for (const c of hubspot) if (c.email) hsByEmail.set(c.email.toLowerCase().trim(), c)
  // Creative key depends on channel:
  //   • Facebook → source_placement (the ad creative / ad-set — keep granular)
  //   • Google   → source_detail (the SEARCH CAMPAIGN — source_placement is the raw
  //               search term, which we roll up so we don't list each query as a "creative")
  // HubSpot adds the LP (first_url_path) and individual ad (utm_content) Streak lacks.
  // We deliberately do NOT key on HubSpot utm_campaign (first-touch noise).
  const enrich = (lead: StreakLeadRow) => {
    const hs = hsByEmail.get((lead.name || '').toLowerCase().trim())
    const google = isGoogleLead(lead)
    const channel: 'google' | 'facebook' = google ? 'google' : 'facebook'
    // Google: canonical campaign (source_detail, aliased) so search terms + abbreviations roll up.
    const creative = (google
      ? canonicalGoogleCampaign(lead.source_detail || hs?.utm_campaign || 'Google Search – Turkey')
      : (lead.source_placement || hs?.utm_campaign || '')
    ).trim()
    return { hs, channel, creative, lp: hs?.first_url_path || '', adId: hs?.utm_content || '' }
  }

  // Google spend: prefer the Google Ads API tab (accurate full-period spend + canonical names)
  // over the partial `daily` tab — applied everywhere (cost-to-fill, Red1, campaign table).
  if (googleApi.length > 0) {
    spend.google = googleApi.reduce((s, c) => s + c.spend, 0)
    spend.googleByCampaign = Object.fromEntries(googleApi.map((c) => [c.name, c.spend]))
    spend.total = spend.fb + spend.google
    // Google campaigns are generic Turkey (no tosca/belgin token) → all "shared", byYacht unaffected.
  }

  // ── Section A: fleet fill ──
  const fills: YachtFill[] = TURKEY_CONFIG.yachts.map((y) => {
    const allWeeks = availability.filter((w) => w.yacht === y.name.toUpperCase())
    const weeks = allWeeks.filter((w) => w.season === 2026) // campaign season
    const filled = weeks.filter((w) => w.filled).length
    const confirmed = weeks.filter((w) => w.confirmed).length
    const paperwork = weeks.filter((w) => w.status === 'paperwork').length
    const onRequest = weeks.filter((w) => w.status === 'on_request').length
    const available = weeks.filter((w) => w.status === 'available').length
    const newFills = Math.max(0, filled - y.baseline)
    const forward2027 = allWeeks.filter((w) => w.season === 2027 && w.filled).length
    // campaign-attributed bookings for this yacht (paid ads only)
    const yEmails = new Set(
      streak.filter((l) => isTurkeyLead(l) && leadYacht(l) === y.id)
        .map((l) => (l.name || '').toLowerCase().trim()).filter(Boolean)
    )
    // Attribute a booking to this yacht if vessel matches, it's paid-ads sourced,
    // and it's Turkey-sourced (own campaign field, or email matches a Turkey lead).
    const yBookings = bookings.filter((b) =>
      isPaidBooking(b) &&
      // Floor on the LEAD's inquiry date first (fall back to booking date when the sheet
      // leaves inquiry blank). A lead that inquired BEFORE 1 May can't be a result of this
      // campaign even if the booking was paid in May — this is what let the PREMIER €28,520
      // (inquiry 23 Mar) slip in. Keeps booking attribution consistent with the lead funnel.
      onOrAfterFloor(b.inquiry_date || b.booking_date) &&
      (b.vessel || '').toUpperCase().includes(y.name.toUpperCase()) &&
      (isTurkeyCampaign(b.campaign || '') || yEmails.has((b.client_email || '').toLowerCase().trim()))
    )
    return {
      id: y.id, name: y.name, specs: y.specs, priceFrom: y.priceFrom,
      target: y.target, baseline: y.baseline,
      totalWeeks: weeks.length, filled, confirmed, paperwork, available, onRequest,
      newFills, progressPct: y.target > 0 ? (newFills / y.target) * 100 : 0,
      directSpend: spend.byYacht[y.id] || 0,
      attributedBookings: yBookings.length,
      attributedRvc: yBookings.reduce((s, b) => s + (b.rvc || 0), 0),
      forward2027,
      weeks: weeks.sort((a, b) => a.startIso.localeCompare(b.startIso)),
    }
  })

  // ── Section B: Blue1 / Blue2 / Red1 ──
  // campaign-attributed bookings = bookings whose email matches a Turkey-campaign lead
  const turkeyLeadEmails = new Set(
    streak.filter(isTurkeyLead)
      .map((l) => (l.name || '').toLowerCase().trim()).filter(Boolean)
  )
  // A booking is Turkey-attributed if it's PAID-ADS sourced, dated on/after the campaign floor
  // (1 May 2026 — bookings are entered manually with dates), AND its campaign field is a Turkey
  // campaign (captures Google "Search - Turkey") OR its email matches a Turkey lead.
  const attributedBookings = bookings.filter((b) =>
    isPaidBooking(b) &&
    onOrAfterFloor(b.booking_date || b.inquiry_date) &&
    (isTurkeyCampaign(b.campaign || '') ||
      turkeyLeadEmails.has((b.client_email || '').toLowerCase().trim()))
  )
  const blue1Bookings = attributedBookings.filter((b) =>
    YACHT_NAMES.some((n) => (b.vessel || '').toUpperCase().includes(n))
  )
  const blue2Bookings = attributedBookings.filter((b) =>
    !YACHT_NAMES.some((n) => (b.vessel || '').toUpperCase().includes(n))
  )
  const blue1Rvc = blue1Bookings.reduce((s, b) => s + (b.rvc || 0), 0)
  const blue2Rvc = blue2Bookings.reduce((s, b) => s + (b.rvc || 0), 0)
  const combinedBlue = blue1Rvc + blue2Rvc
  const ratio = spend.total > 0 ? combinedBlue / spend.total : 0
  const yachtSplit = (name: string) => {
    const bs = blue1Bookings.filter((b) => (b.vessel || '').toUpperCase().includes(name))
    return { rvc: bs.reduce((s, b) => s + (b.rvc || 0), 0), bookings: bs.length }
  }
  const columns: ColumnsKpi = {
    blue1: { rvc: blue1Rvc, weeks: blue1Bookings.length, bookings: blue1Bookings.length, tosca: yachtSplit('TOSCA'), belgin: yachtSplit('BELGIN') },
    blue2: { rvc: blue2Rvc, bookings: blue2Bookings.length },
    red1: { spend: spend.total, fbSpend: spend.fb, googleSpend: spend.google },
    combinedBlue, ratio,
    status: ratio >= 1 ? 'push' : ratio >= 0.8 ? 'watch' : 'pull',
  }

  const totalBookings = attributedBookings.length
  const economics: Economics = {
    totalBookings,
    costPerBooking: totalBookings > 0 ? spend.total / totalBookings : 0,
    earningsPerBooking: totalBookings > 0 ? combinedBlue / totalBookings : 0,
    netPerBooking: totalBookings > 0 ? (combinedBlue - spend.total) / totalBookings : 0,
  }

  // ── Section C: Yacht QL funnel (date-windowed) ──
  // Lead-set = Streak leads from a Turkey campaign (source_placement). HubSpot only
  // enriches (LP + ad), it does not define membership — avoids first-touch contamination.
  const allTurkeyLeads = streak.filter(isTurkeyLead)
  const windowed = allTurkeyLeads.filter((l) => onOrAfterFloor(l.inquiry_date))

  const whenBreakdown = { y2026: 0, future: 0, none: 0 }
  const conditionFails: ConditionFails = { ai: 0, capacity: 0, budget: 0, destination: 0, date: 0 }
  let hubspotMatched = 0

  const leadsOut: YachtQlLead[] = windowed.map((l) => {
    const { hs, channel, creative, lp, adId } = enrich(l)
    if (hs) hubspotMatched++
    const yid = classifyYacht(creative)
    const yacht = TURKEY_CONFIG.yachts.find((y) => y.id === yid)
    const maxGuests = yacht ? yacht.maxGuests : 12
    const budgetMin = yacht ? yacht.budgetMin : 20000

    const passAi = (l.ai_score || 0) >= 50
    const passCapacity = !!l.size_of_group && l.size_of_group > 0 && l.size_of_group <= maxGuests
    const passBudget = parseBudgetMin(l.budget_range || '') >= budgetMin
    const passDestination = /turkey/i.test(l.destination || '')
    const wy = whenYear(l.when)
    const passDate = wy !== 'future'

    if (wy === '2026') whenBreakdown.y2026++
    else if (wy === 'future') whenBreakdown.future++
    else whenBreakdown.none++

    const isQl = passAi
    const isYachtQl = passAi && passCapacity && passBudget && passDestination && passDate
    // condition-fail tally among QL leads that miss Yacht QL
    if (isQl && !isYachtQl) {
      if (!passCapacity) conditionFails.capacity++
      if (!passBudget) conditionFails.budget++
      if (!passDestination) conditionFails.destination++
      if (!passDate) conditionFails.date++
    }
    if (!passAi) conditionFails.ai++

    return {
      inquiry_date: l.inquiry_date,
      source: l.source_placement,
      yacht: yid,
      channel, creative, lp, adId,
      name: l.name,
      country: l.country,
      ai_score: l.ai_score,
      budget_range: l.budget_range,
      size_of_group: l.size_of_group,
      destination: l.destination,
      when: l.when,
      stage: l.stage,
      passAi, passCapacity, passBudget, passDestination, passDate, isQl, isYachtQl,
      hsDetail: hs ? {
        formName: hs.recent_conversion_event_name || hs.first_conversion_event_name || '',
        firstUrlPath: hs.first_url_path || '',
        lastUrlPath: hs.last_url_path || '',
        source: hs.hs_analytics_source || '',
        sourceDetail: hs.hs_analytics_source_data_1 || '',
        utmContent: hs.utm_content || '',
        utmCampaign: hs.utm_campaign || '',
        createdate: hs.createdate || '',
      } : null,
    }
  })

  const leadsN = leadsOut.length
  const qlN = leadsOut.filter((l) => l.isQl).length
  const yachtQlN = leadsOut.filter((l) => l.isYachtQl).length
  // attributedBookings is already floored at the campaign start, so all of them are "in window"
  const bookingsN = attributedBookings.length
  const safeDiv = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

  // Per-yacht split incl. the generic Turkey-LP bucket (most leads land there).
  // Ratio = Yacht QL ÷ QL (the pitch's "Vessel QL ratio" definition, 40% trigger).
  const yachtBuckets = [
    { id: 'tosca', name: 'Tosca' },
    { id: 'belgin', name: 'Belgin Sultan' },
    { id: 'turkey', name: 'Turkey (generic LP)' },
  ]
  const perYachtQl = yachtBuckets.map((y) => {
    const yl = leadsOut.filter((l) => l.yacht === y.id)
    const qlc = yl.filter((l) => l.isQl).length
    const yqc = yl.filter((l) => l.isYachtQl).length
    return { id: y.id, name: y.name, leads: yl.length, ql: qlc, yachtQl: yqc, yachtQlRatio: safeDiv(yqc, qlc) }
  }).filter((r) => r.id === 'tosca' || r.id === 'belgin' || r.leads > 0) // always show the two target yachts

  // ── FB ad/creative performance (HubSpot-enriched, FB only) ──
  // Group FB leads by creative (source_placement = ad-set). Google lives in its own
  // campaign section. No per-creative spend (FB ad-level spend isn't synced; Streak is
  // ad-set level per the streak-matching finding) — spend shown at campaign level below.
  const creativeMap = new Map<string, YachtQlLead[]>()
  for (const l of leadsOut) {
    if (l.channel !== 'facebook') continue
    const key = l.creative || '(unknown)'
    if (!creativeMap.has(key)) creativeMap.set(key, [])
    creativeMap.get(key)!.push(l)
  }
  const creatives: CreativeRow[] = Array.from(creativeMap.entries())
    .map(([creative, ls]) => {
      const ql = ls.filter((l) => l.isQl).length
      const yachtQl = ls.filter((l) => l.isYachtQl).length
      // most common LP in this creative
      const lpCount = new Map<string, number>()
      for (const l of ls) if (l.lp) lpCount.set(l.lp, (lpCount.get(l.lp) || 0) + 1)
      const topLp = [...lpCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
      const ads = new Set(ls.map((l) => l.adId).filter(Boolean)).size
      return {
        creative,
        channel: ls[0]?.channel || 'facebook',
        yacht: classifyYacht(creative),
        topLp,
        ads,
        leads: ls.length,
        ql,
        yachtQl,
        qlRate: safeDiv(ql, ls.length),
        yachtQlRate: safeDiv(yachtQl, ql),
        thumbnail: matchThumb(creative), // Meta thumbnail via distinctive-token name match
      }
    })
    .sort((a, b) => b.leads - a.leads)

  // ── FB Ads — campaign level (spend + agreed metrics) ──
  // Map FB creative (source_placement) → its FB campaign by token rule. More reliable than the
  // global fuzzy matcher for the few Turkey campaigns (which missed tosca_interesi → Tosca).
  const fbCampaignNames = Object.keys(spend.fbByCampaign)
  const findFbCampaign = (kw: string) => fbCampaignNames.find((c) => c.toLowerCase().includes(kw))
  const mapFbToCampaign = (creative: string): string | undefined => {
    const c = (creative || '').toLowerCase()
    if (c.includes('tosca')) return findFbCampaign('tosca')
    if (/last[-_ ]?minute/.test(c)) return findFbCampaign('last')
    if (c.includes('belgin')) return findFbCampaign('belgin') || findFbCampaign('individual')
    return findFbCampaign('scaling') || fbCampaignNames[0] // generic landing_turkey → Scaling
  }
  const fbLeadByCampaign = new Map<string, YachtQlLead[]>()
  for (const l of leadsOut) {
    if (l.channel !== 'facebook') continue
    const camp = mapFbToCampaign(l.creative)
    if (!camp) continue
    if (!fbLeadByCampaign.has(camp)) fbLeadByCampaign.set(camp, [])
    fbLeadByCampaign.get(camp)!.push(l)
  }
  // Native Meta lead-form campaigns ("- LF", optimised on conversion:leads) capture leads via the
  // Meta native form, NOT the landing-page custom conv — so those leads never carry a Streak
  // source_placement and the Streak join shows 0. Backfill them from fb_ads_level.meta_leads (the
  // Ads Manager "Leads" metric). Scoped to TRUE native-form campaigns only (meta_leads>0 AND
  // landing_lead==0 in the ad-level export) so landing-page campaigns keep their Streak count and
  // their small incidental FB-form leads are NOT double-counted.
  const fbAdLevelByCampaign = new Map<string, { metaLeads: number; landingLead: number }>()
  for (const a of fbAdsLevel) {
    const k = normCampaign(a.campaign)
    const e = fbAdLevelByCampaign.get(k) || { metaLeads: 0, landingLead: 0 }
    e.metaLeads += a.metaLeads; e.landingLead += a.landingLead
    fbAdLevelByCampaign.set(k, e)
  }
  const metaFormLeads = (campaign: string): number => {
    const e = fbAdLevelByCampaign.get(normCampaign(campaign))
    return e && e.metaLeads > 0 && e.landingLead === 0 ? e.metaLeads : 0
  }
  const buildCampaignRow = (campaign: string, channel: 'google' | 'facebook', sp: number, ls: YachtQlLead[], extraLeads = 0): CampaignRow => {
    const ql = ls.filter((l) => l.isQl).length
    const yachtQl = ls.filter((l) => l.isYachtQl).length
    const aiVals = ls.map((l) => l.ai_score || 0).filter((v) => v > 0)
    const avgAi = aiVals.length ? Math.round(aiVals.reduce((s, v) => s + v, 0) / aiVals.length) : 0
    const leads = ls.length + extraLeads
    return {
      campaign, channel, spend: sp, leads, ql, yachtQl, avgAi,
      cpl: leads ? sp / leads : 0,
      cpql: ql ? sp / ql : 0,
      cpYachtQl: yachtQl ? sp / yachtQl : 0,
      qlRate: safeDiv(ql, leads),
    }
  }
  const fbCampaigns: CampaignRow[] = fbCampaignNames
    .map((c) => {
      const ls = fbLeadByCampaign.get(c) || []
      // Backfill native-form leads only when Streak gave nothing for this campaign.
      const extra = ls.length === 0 ? metaFormLeads(c) : 0
      return buildCampaignRow(c, 'facebook', spend.fbByCampaign[c] || 0, ls, extra)
    })
    .sort((a, b) => b.spend - a.spend)

  // ── Google Ads — campaign level ──
  // Spend source: Google Ads API tab (turkey_google_campaigns) when present — accurate spend +
  // canonical campaign names; falls back to the `daily` tab. QL/Yacht QL from Streak leads
  // grouped by source_detail (= the search campaign), joined to spend by normalised name.
  const gLeadByDetail = new Map<string, YachtQlLead[]>() // key = normalised source_detail
  const gDisplayByNorm = new Map<string, string>()
  for (const l of leadsOut) {
    if (l.channel !== 'google') continue
    const norm = normCampaign(l.creative || '(unknown)')
    if (!gLeadByDetail.has(norm)) { gLeadByDetail.set(norm, []); gDisplayByNorm.set(norm, l.creative || '(unknown)') }
    gLeadByDetail.get(norm)!.push(l)
  }
  // spend spine: API (preferred) or daily fallback → normalised name → { display, spend }
  const spendSpine = new Map<string, { display: string; spend: number }>()
  if (googleApi.length > 0) {
    for (const c of googleApi) spendSpine.set(normCampaign(c.name), { display: c.name, spend: c.spend })
  } else {
    for (const [name, sp] of Object.entries(spend.googleByCampaign)) spendSpine.set(normCampaign(name), { display: name, spend: sp })
  }
  // Spine = real campaigns with spend (drops stray search-term groups where Streak stored the
  // query in source_detail). Fall back to lead groups only if there's no spend data at all.
  const googleNorms = spendSpine.size > 0 ? Array.from(spendSpine.keys()) : Array.from(gLeadByDetail.keys())
  const googleCampaigns: CampaignRow[] = googleNorms
    .map((norm) => {
      const spineEntry = spendSpine.get(norm)
      const display = spineEntry?.display || gDisplayByNorm.get(norm) || norm
      return buildCampaignRow(display, 'google', spineEntry?.spend || 0, gLeadByDetail.get(norm) || [])
    })
    .filter((r) => r.spend >= 1 || r.leads > 0) // drop empty Turkey ad groups (e.g. Ankor €0/0)
    .sort((a, b) => b.spend - a.spend)

  return {
    generatedAt: new Date().toISOString(),
    since: CAMPAIGN_FLOOR,
    days: Math.max(1, Math.round((Date.now() - CAMPAIGN_FLOOR_MS) / 86400000)),
    config: TURKEY_CONFIG,
    fills,
    costToFill: {
      spent: spend.total,
      thresholds: TURKEY_CONFIG.thresholds,
      byYacht: {
        tosca: spend.byYacht['tosca'] || 0,
        belgin: spend.byYacht['belgin'] || 0,
        shared: spend.total - (spend.byYacht['tosca'] || 0) - (spend.byYacht['belgin'] || 0),
      },
    },
    columns,
    economics,
    traffic,
    funnel: {
      leads: leadsN, ql: qlN, yachtQl: yachtQlN, bookings: bookingsN,
      leadToQl: safeDiv(qlN, leadsN),
      qlToYachtQl: safeDiv(yachtQlN, qlN),
      yachtQlToBooking: safeDiv(bookingsN, yachtQlN),
      yachtQlRatio: safeDiv(yachtQlN, leadsN),
    },
    perYachtQl,
    creatives,
    fbCampaigns,
    googleCampaigns,
    conditionFails,
    whenBreakdown,
    hubspotMatched,
    // Newest leads first (by inquiry date); undated fall to the bottom.
    leads: leadsOut.sort((a, b) => {
      const da = parseDate(a.inquiry_date), db = parseDate(b.inquiry_date)
      return (db ? +db : 0) - (da ? +da : 0)
    }),
  }
}
