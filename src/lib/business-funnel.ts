// src/lib/business-funnel.ts
//
// Business Health Funnel — the master paid-media funnel for the Goolets Content Portal
// ("Business Health" tab) plus the campaign drill-downs. 100% live, no mock numbers:
// anything that cannot be computed from a real source comes back as `null`.
//
// Funnel (Dejan's business-health model, locked 2026-07-22, confirmed by Mitja):
//   Impressions → Clicks → LP views → Leads → QL (Streak AI ≥ 50) → Bookings (+ RVC)
//
// Sources
//   spend                         → fb_ads_api (Meta, the post-2026-08-17 cutover feed)
//                                   + daily_api (Google Ads API tab)
//   impressions / clicks          → fb_ads_raw (the ONLY FB tab carrying impressions and
//                                   link_click) + daily_api
//   lpViews                       → ga4_landing_pages (sessions, PAID ONLY — see below)
//   leads / ql                    → streak_sync (Streak is SSOT — never FB pixel counts)
//   bookings / revenue            → bookings_api (rvc IS already the commission)
//   lead → campaign join          → utm_mapping (authoritative), then regex fallback
//
// 2026-09-09 rework (all approved by Dejan):
//  1. Freshness guard now clips instead of lying: every step is computed on
//     meta.effectiveWindow = requested window ∩ coverage of EVERY paid source
//     (fb ∩ google ∩ ga4 ∩ streak), so the spend denominator and the lead/LP numerators
//     always span the SAME days. Since 2026-09-09b the intersection ignores the campaign
//     and channel filter, so every view of a range is measured over identical days and a
//     master umbrella row can never disagree with its own drill-down.
//  1b. A window with NO overlap is a gap, not a zero: every day-granular step goes null.
//     Bookings keep their own month window (history runs far behind the ad feeds) and only
//     go null when bookings_api itself does not reach the requested months.
//  2. Bookings stay month-granular but are reported with their own meta.bookingsWindow,
//     plus a date-exact `bookingsCohort` (bookings whose inquiry_date is inside the window).
//  3. Clicks = Meta link_click + Google clicks. Meta "clicks (all)" survives as `clicksAll`.
//  4. lpViews is PAID ONLY on every view (master included); organic/direct/referral/email
//     sits next to it as `lpViewsOrganic` and is never mixed into the funnel.
//  5. Master QL excludes the ASSET/RareOps umbrella (its Streak AI score is inflated);
//     `qualityLeadsIncludingAsset` keeps the old number.
//  6. 14 umbrellas instead of 6, exact platform-campaign names first, regex only as the
//     fallback for names the lists do not know yet. Every umbrella is mutually exclusive.
//
// Attribution of Streak leads to an umbrella: utm_mapping (SOURCE PLACEMENT → real campaign)
// first, then the placement/campaign-name matchers, then the umbrella regexes in an explicit
// order. Whatever matches nothing is reported as the unattributed remainder.

import { DEFAULT_WEB_APP_URL, getSheetsUrl, SHEETS_TABS } from './config'
import { isRelevantPage } from './ga4-landing-pages'
import { matchSourceToCampaign } from './fuzzy-match'
import targetsConfig from '../../config/funnel-targets.json'

// ─── Campaign registry ──────────────────────────────────────────────────────
//
// 14 umbrellas, replacing the original 6 (approved 2026-09-09). Each one carries:
//   metaNames / googleNames — the EXACT platform campaign names that must land in it. These
//                             win over every regex, so an order accident can never move a
//                             known campaign.
//   fb / google             — the fallback matcher for names the exact lists do not know
//                             (new campaigns, historic booking-only campaigns). Applied in
//                             UMBRELLA_ORDER, first match wins, so umbrellas stay disjoint.
//   sp / googleDetail       — Streak SOURCE PLACEMENT / SOURCE DETAIL matchers.
//   lp                      — GA4 landing-page paths.
//   booking                 — kept for backwards compatibility; bookings now resolve through
//                             the same exclusive resolver as spend.

export interface CampaignDef {
  slug: string
  name: string
  /** Included in master totals but excluded from CPL/CPQL comparisons by the frontend. */
  nonKpi?: boolean
  /** Streak AI scores this umbrella far above the account average — QL is not comparable. */
  aiScoreInflated?: boolean
  /** Exact Meta campaign names (fb_ads_api / fb_ads_raw / bookings_api.campaign). */
  metaNames?: string[]
  /** Exact Google Ads campaign names (daily_api / bookings_api.campaign). */
  googleNames?: string[]
  /** FB campaign_name fallback matcher */
  fb: RegExp | null
  /** Google Ads campaign name fallback matcher */
  google: RegExp | null
  /** Streak SOURCE PLACEMENT — Facebook leads */
  sp: RegExp | null
  /** Streak SOURCE DETAIL — Google leads (Streak stores the campaign name here) */
  googleDetail: RegExp | null
  /** GA4 landingPage path */
  lp: RegExp | null
  /** bookings_api.campaign (legacy — the resolver uses metaNames/googleNames/fb/google) */
  booking: RegExp | null
  /** Why lpViews is null, when it is */
  lpNote?: string
}

export const CAMPAIGNS: CampaignDef[] = [
  {
    slug: 'asset',
    name: 'ASSET / RareOps',
    aiScoreInflated: true,
    metaNames: [
      'ASSET – TOSCA – RareOps – ABO',
      'ASSET – TOSCA – RareOps – ABO - V2',
      'ASSET – Dalmatino – RareOps – ABO',
      'ASSET – DALMATINO – RareOps – ABO',
      'ASSET – Anima Maris – RareOps – ABO',
      'ASSET – ALESSANDRO I – RareOps – ABO',
      'Prava forma - ASSET – TOSCA – RareOps – ABO',
      'Prava forma - ASSET – Anima Maris – RareOps – ABO',
      'Prava forma - ASSET – Dalmatino – RareOps – ABO',
    ],
    fb: /asset|rare[\s_-]*ops/i,
    google: null,
    sp: /rare[\s_-]*ops|(^|[_\-\s])asset([_\-\s]|$)/i,
    googleDetail: null,
    lp: /^\/rare-opportunit/i,
    booking: /asset|rare[\s_-]*ops/i,
    lpNote:
      'ASSET / RareOps QL is not comparable: the Streak AI score is inflated for this umbrella (Dejan, 2026-09). Master QL therefore excludes it — see qualityLeadsIncludingAsset.',
  },
  {
    slug: 'dobrik',
    name: 'David Dobrik',
    metaNames: ['DOBRIK x CRISTAL - Croatia 2027 - CBO'],
    googleNames: ['David Dobrik - YouTube - Stage 1: Reach / Awareness)'],
    fb: /dobrik/i,
    google: /dobrik/i,
    sp: /dobrik/i,
    googleDetail: /dobrik/i,
    lp: /^\/(dobrik-|creators-smart-yachting)/i,
    booking: /dobrik/i,
  },
  {
    slug: 'matchmaker',
    name: 'Yacht Matchmaker',
    nonKpi: true,
    metaNames: ['Yacht Matchmaker - Lead Magnet - CBO'],
    fb: /yacht\s*matchmaker/i,
    google: null,
    sp: /yacht[\s_-]*matchmaker/i,
    googleDetail: null,
    lp: null,
    booking: /yacht\s*matchmaker/i,
    lpNote:
      'Lead-magnet campaign: the conversion is complete_registration, not an inquiry. No dedicated GA4 landing path, so lpViews is null rather than guessed.',
  },
  {
    slug: 'boost',
    name: 'Boost / non-KPI',
    nonKpi: true,
    metaNames: [
      'BOOST - 2026 - Engagement',
      'BOOST - 2026 - Engagement - Interactions',
      'JOB POST - 2026-01 - LJ in okolica',
      'Andraž K - Personal Brand - Boost - IG Followers - 2026-09',
    ],
    fb: /^\s*boost\b|job\s*post|personal\s*brand/i,
    google: null,
    sp: /^boost|job[\s_-]*post|personal[\s_-]*brand/i,
    googleDetail: null,
    lp: /^\/jobs\//i,
    booking: /^\s*boost\b|job\s*post|personal\s*brand/i,
    lpNote: 'Engagement / recruitment spend — no charter funnel. Excluded from CPL/CPQL by nonKpi.',
  },
  {
    slug: 'youtube',
    name: 'YouTube brand (Google)',
    nonKpi: true,
    googleNames: ['All - YouTube - Video views', 'All - YouTube subscriptions'],
    fb: null,
    google: /^all\s*-\s*youtube/i,
    sp: null,
    googleDetail: /^all\s*-\s*youtube/i,
    lp: null,
    booking: /^all\s*-\s*youtube/i,
    lpNote: 'Video-views / subscription campaigns send no landing-page traffic we can isolate in GA4.',
  },
  {
    slug: 'brand',
    name: 'Brand Search (Google)',
    googleNames: ['All - Search - Brand Campaign'],
    fb: null,
    google: /brand\s*campaign/i,
    sp: null,
    googleDetail: /brand\s*campaign/i,
    lp: null,
    booking: /brand\s*campaign/i,
    lpNote: 'Brand search lands on many pages (home, fleet, destinations) — no single GA4 path to scope it to.',
  },
  {
    slug: 'pmax',
    name: 'Performance Max (Google)',
    googleNames: ['Performance Max - BOFU - UK, CA, AUS', 'Perfromance Max - BOFU - US'],
    fb: null,
    // "Perfromance" is a live typo in the account — matched on purpose, not fixed here.
    google: /(perfor|perfro)mance\s*max/i,
    sp: null,
    googleDetail: /(perfor|perfro)mance\s*max/i,
    lp: null,
    booking: /(perfor|perfro)mance\s*max/i,
    lpNote: 'PMax spreads across the whole site — no single GA4 landing path to scope it to.',
  },
  {
    slug: 'clg',
    name: 'Croatia Luxury Gulet',
    metaNames: ['CRO LUX GULET - Avgust 2026 - Nova konverzija', 'CRO LUX GULET - Avgust 2026'],
    googleNames: ['CLG - Search - Croatia - EN'],
    fb: /cro\s*lux\s*gulet/i,
    google: /^\s*clg\b/i,
    sp: /cro-lux|cro\s*lux|(^|_)clg(_|$)/i,
    googleDetail: /^\s*clg\b/i,
    // croatialuxurygulet.com is dual-tagged into the goolets GA4 property, so only the
    // CLG-unique path resolves. LP-B (/luxury-yacht-charters-at-unmatched-value) shares its
    // path with the goolets.net original and cannot be separated in this feed → understated.
    lp: /^\/luxury-yacht-charter-in-croatia\b/i,
    booking: /cro\s*lux\s*gulet|^\s*clg\b/i,
    lpNote:
      'LP-B shares its path with the goolets.net page of the same name — CLG LP views are the LP-A path only',
  },
  {
    slug: 'earlybook',
    name: 'Early Booking 2027',
    metaNames: ['Early Booking - Croatia 2027 - CBO', 'CORE 7 Social Proof - Croatia 2027 - ABO'],
    fb: /early\s*booking|core\s*7/i,
    google: null,
    sp: /^earlybook|^early-booking|^core\s*7|^core7/i,
    googleDetail: null,
    lp: /^\/private-yacht-charters-in-croatia-2027\b/i,
    booking: /early\s*booking|core\s*7/i,
  },
  {
    slug: 'turkey',
    name: 'Turkey',
    metaNames: [
      'Belgin Sultan - Turkey - Cold - ABO',
      'Belgin Sultan - Turkey - Cold - ABO - LF',
      'Tosca - Turkey - Cold - ABO',
      'Tosca - Turkey - Cold - ABO - LF',
      'Landing Turkey  - Scaling - CBO',
      'Landing Turkey  - Last Minute - CBO',
      'TURKEY – Creative Test – ABO',
      'TURKEY – Calculator - ABO',
    ],
    googleNames: ['Search - Turkey - EN', 'Turkey - YouTube - Remarketing'],
    fb: /turkey|tosca|belgin|esma/i,
    google: /turkey/i,
    sp: /turkey|tosca|belgin|esma|makri|la-bella-vita/i,
    googleDetail: /turkey/i,
    lp: /turkey|belgin|tosca|esma|arabella|makri/i,
    booking: /turkey|tosca|belgin|esma/i,
  },
  {
    slug: 'dalmatincki',
    name: 'Last minute Dalmatinčki',
    metaNames: [
      'Test - Dalmatinčki - Sail Smarter - CRO-001 Test',
      'Dalmatinčki - Julij 2026',
      'Nocturno - Julij 2026',
      'Dalmatino - Julij 2026',
      'Dalmatinčki - ABO - LF',
      'Dalmatinčki - Last Minute',
    ],
    fb: /dalmatin|nocturno/i,
    google: null,
    sp: /dalmatin|nocturno|maxita|anima-maris|smart-luxury-sailing|sail[\s_-]*smarter/i,
    googleDetail: null,
    lp: /^\/(smart-luxury-sailing|sail-smarter|exclusive-seasonal-selection|motor-sailing-yachts-exclusive-seasonal-selection|luxury-motor-sailing-yacht-(dalmatino|nocturno))/i,
    booking: /dalmatin|nocturno/i,
  },
  {
    slug: 'smarter',
    name: 'Alessandro / Smarter Way',
    metaNames: ['Alessandro I - The Smarter Way - CBO - New', 'Alessandro - August 2026'],
    fb: /the\s*smarter\s*way|^alessandro\b/i,
    google: null,
    sp: /^alessandro[_\s-]|smarter[-_\s]way/i,
    googleDetail: null,
    lp: /^\/alessandro-/i,
    booking: /the\s*smarter\s*way|^alessandro\b/i,
  },
  {
    slug: 'bofu',
    name: 'BOFU / Landing',
    metaNames: [
      'BOFU - Landing Attainable Luxury - Objections crusher',
      'Landing Gulets  - Scaling - CBO 150',
      'P1: Landing Attainable Luxury - US - Audience test',
      'P1: Landing CNN - Interesi - Videos',
      'Test - Landing Unmatched Value Forma 2 - Objections crusher ads',
    ],
    fb: /\bbofu\b|landing\s*gulets?|landing\s*attainable|landing\s*cnn|unmatched\s*value|^\s*landing[\s_-]*b\b|(^|\s)(interesi|warm)\s*-\s*(bella|riva|ohana)\b/i,
    google: null,
    // interesi_/warm_ + bella|riva|ohana resolve to the BOFU campaign in utm_mapping —
    // encoded here too so the fallback agrees with the authoritative table.
    sp: /\bbofu\b|landing[_\s-]attainable|landing[_\s-]gulet|unmatched[_\s-]value|risk[\s_-]reversal|^(interesi|warm)_(bella|riva|ohana)/i,
    googleDetail: null,
    lp: /^\/(luxury-yacht-charters-at-unmatched-value|yacht-charters-at-unmatched-value|luxury-yacht-charters-unmatched-value|private-gulet-charters-in-croatia|croatia-private-gulet-charters|luxury-private-large-group-yacht-charters-in-croatia|bella-|riva-|ohana-|freedom-)/i,
    booking: /\bbofu\b|landing\s*gulets?|landing\s*attainable|landing\s*cnn|unmatched\s*value/i,
  },
  {
    slug: 'croatia',
    name: 'Croatia generic / Last minute',
    metaNames: [
      'Last Minute - Croatia 2026 - CBO',
      'YOLO - August 2026',
      'CROATIA CALCULATOR - Sept 2026 - ABO',
    ],
    googleNames: ['Search - Croatia - EN', 'Posamezne ladje - Leads', 'Search - Croatia, Turkey - LATM'],
    // Deliberately LAST in UMBRELLA_ORDER: these tokens are generic enough to swallow other
    // umbrellas' campaigns, so they only ever see what nothing more specific claimed.
    fb: /croatia|yolo|last\s*minute|posamezne\s*ladje/i,
    google: /croatia|yolo|latm|latam|posamezne\s*ladje/i,
    sp: /^yolo|^last_minute|croatia-calculator|^croatia/i,
    googleDetail: /croatia|latm|latam|posamezne\s*ladje/i,
    lp: /^\/(charter-yolo|croatia-calculator|yacht-rentals|luxury-yachting-holidays-croatia)/i,
    booking: /croatia|yolo|last\s*minute|posamezne\s*ladje/i,
  },
]

/**
 * Explicit first-match order — most specific first, `croatia` (the generic bucket) last.
 * Applies ONLY to the regex fallback: metaNames/googleNames always win, so a known campaign
 * cannot be moved by reordering this list.
 */
export const UMBRELLA_ORDER = [
  'asset',
  'dobrik',
  'matchmaker',
  'boost',
  'youtube',
  'brand',
  'pmax',
  'clg',
  'earlybook',
  'turkey',
  'dalmatincki',
  'smarter',
  'bofu',
  'croatia',
] as const

const ORDERED = UMBRELLA_ORDER.map((s) => CAMPAIGNS.find((c) => c.slug === s)!).filter(Boolean)

export const QL_THRESHOLD = 50

/** The umbrella whose Streak AI score is inflated — excluded from master QL. */
const AI_INFLATED_SLUGS = new Set(CAMPAIGNS.filter((c) => c.aiScoreInflated).map((c) => c.slug))

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

function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** `ym` shifted by n months, as YYYY-MM. */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** Today in Europe/Ljubljana (the business day every feed is aligned to). */
export function todayLjubljana(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Ljubljana',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Days of a source's coverage that fall inside [from,to]. */
function overlapDays(cov: Coverage, from: string, to: string): number {
  if (!cov.min || !cov.max) return 0
  const lo = cov.min > from ? cov.min : from
  const hi = cov.max < to ? cov.max : to
  if (lo > hi) return 0
  return daysBetween(lo, hi)
}

// ─── Date ranges ────────────────────────────────────────────────────────────
//
// `3m` (approved 2026-09-09) = from the 1st of the month three months back from the current
// month, to today. On 2026-09-09 that is 2026-06-01 → 2026-09-09. `90d` is kept as an alias
// so the old links keep working; the response says which key was requested and which was
// actually used (meta.range.requested / .effective).

export type RangeKey = '3m' | '90d' | 'this_month' | 'last_month' | 'ytd' | 'custom'

export const RANGE_KEYS: RangeKey[] = ['3m', '90d', 'this_month', 'last_month', 'ytd', 'custom']

export interface ResolvedRange {
  requested: RangeKey
  effective: RangeKey
  from: string
  to: string
}

export function resolveRange(
  requested: string | null | undefined,
  start: string,
  end: string,
  today: string = todayLjubljana()
): ResolvedRange {
  const key = (String(requested || '').trim().toLowerCase() || 'custom') as RangeKey
  const month = today.slice(0, 7)
  switch (key) {
    case '3m':
    case '90d':
      return { requested: key, effective: '3m', from: `${shiftMonth(month, -3)}-01`, to: today }
    case 'this_month':
      return { requested: key, effective: 'this_month', from: `${month}-01`, to: today }
    case 'last_month': {
      const prev = shiftMonth(month, -1)
      return { requested: key, effective: 'last_month', from: `${prev}-01`, to: monthEnd(prev) }
    }
    case 'ytd':
      return { requested: key, effective: 'ytd', from: `${today.slice(0, 4)}-01-01`, to: today }
    default:
      return { requested: 'custom', effective: 'custom', from: start, to: end }
  }
}

// ─── Fetching (object rows, with retry + module-level TTL cache) ────────────
//
// The portal calls this endpoint once per view. Parsing the 27 MB GA4 tab and the 5 MB
// fb_ads_raw tab once per warm lambda instead of once per request is the difference between
// "instant" and "times out".

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
  /** Meta link_click / Google clicks — the funnel's Clicks step. */
  clicks: number
  /** Meta "clicks (all)" / Google clicks — kept for reference only. */
  clicksAll: number
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
  /** bookings_api.inquiry_date — a full date, present on ~2/3 of the rows. */
  inquiryDay: string
  campaign: string
  rvc: number
  /** bookings_api.source — 'fb_landing' | 'fb_lead' | 'google'. The channel-split key. */
  source: string
}

function coverageOf(days: string[]): Coverage {
  let min = '',
    max = ''
  for (const d of days) {
    if (!d) continue
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  return { min, max }
}

/** Intersection of two coverages (empty when either is empty or they do not overlap). */
function intersectCoverage(a: Coverage, b: Coverage): Coverage {
  if (!a.min || !a.max) return b
  if (!b.min || !b.max) return a
  const min = a.min > b.min ? a.min : b.min
  const max = a.max < b.max ? a.max : b.max
  return min > max ? { min: '', max: '' } : { min, max }
}

/**
 * FB metrics: fb_ads_raw is the only FB tab carrying impressions AND link_click.
 * fb_ads_api (the 2026-08-17 cutover feed) carries date/campaign/SPEND only, so a full
 * cutover is impossible — spend comes from fb_ads_api, the counts from fb_ads_raw, and the
 * two agree within 0.5% on every full month they share (verified 2026-09-09).
 */
async function loadFb(): Promise<{ rows: AdDay[]; coverage: Coverage }> {
  return cached('fb', async () => {
    const raw = await fetchRows(SHEETS_TABS.FB_RAW)
    if (!raw.length) return { rows: [], coverage: { min: '', max: '' } }
    const s = raw[0]
    const kC = keyOf(s, /campaign_name$/i)
    const kD = keyOf(s, /date_start$/i)
    const kI = keyOf(s, /\bimpressions$/i)
    const kK = keyOf(s, /(^|\.)clicks$/i)
    const kL = keyOf(s, /actions\.link_click$/i, /link_clicks?$/i)
    const kS = keyOf(s, /(^|\.)spend$/i)
    const rows: AdDay[] = []
    for (const r of raw) {
      const campaign = String((kC && r[kC]) ?? '')
      const day = toDay(kD ? r[kD] : '')
      if (!campaign || !day) continue
      const clicksAll = kK ? num(r[kK]) : 0
      rows.push({
        day,
        campaign,
        impressions: kI ? num(r[kI]) : 0,
        // Link clicks are the honest denominator for LP views. If the column ever vanishes
        // we fall back to clicks(all) rather than reporting 0 traffic.
        clicks: kL ? num(r[kL]) : clicksAll,
        clicksAll,
        spend: kS ? num(r[kS]) : 0,
      })
    }
    return { rows, coverage: coverageOf(rows.map((r) => r.day)) }
  })
}

/** FB spend, post-cutover feed (code/facebook/sync-fb-ads-api.js). date / campaign / spend. */
async function loadFbSpend(): Promise<{
  rows: { day: string; campaign: string; spend: number }[]
  coverage: Coverage
}> {
  return cached('fbSpend', async () => {
    const raw = await fetchRows(SHEETS_TABS.FB_SPEND_DAILY)
    const rows: { day: string; campaign: string; spend: number }[] = []
    for (const r of raw) {
      const campaign = String(r.campaign ?? '')
      const day = toDay(r.date)
      if (!campaign || !day) continue
      rows.push({ day, campaign, spend: num(r.spend) })
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
      const clicks = num(r.clicks)
      // Google reports one clicks figure; it IS the link click.
      rows.push({ day, campaign, impressions: num(r.impr), clicks, clicksAll: clicks, spend: num(r.cost) })
    }
    return { rows, coverage: coverageOf(rows.map((r) => r.day)) }
  })
}

/**
 * GA4 `sessionSourceMedium` -> channel. Same rule turkey-kpis/route.ts applies: a session
 * counts as paid only if the source/medium carries a paid|cpc|ppc token, and it then splits
 * by platform. Everything else (organic, direct, referral, email, unpaid social) is 'other'.
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

/** Bookings + RVC. booking_date is month-granular (YYYY-MM) at source; inquiry_date is exact. */
async function loadBookings(): Promise<{ rows: BookingRow[]; coverage: Coverage; inquiryCoverage: Coverage }> {
  return cached('bookings', async () => {
    const raw = await fetchRows(SHEETS_TABS.BOOKINGS)
    const rows: BookingRow[] = []
    for (const r of raw) {
      const bd = String(r.booking_date ?? '')
      const month = bd.includes('T') ? toDay(bd).slice(0, 7) : bd.slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      rows.push({
        month,
        inquiryDay: toDay(r.inquiry_date ?? ''),
        campaign: String(r.campaign ?? ''),
        rvc: num(r.rvc),
        source: String(r.source ?? '')
          .toLowerCase()
          .trim(),
      })
    }
    const months = rows.map((r) => r.month).sort()
    return {
      rows,
      coverage: {
        min: months.length ? `${months[0]}-01` : '',
        max: months.length ? monthEnd(months[months.length - 1]) : '',
      },
      inquiryCoverage: coverageOf(rows.map((r) => r.inquiryDay)),
    }
  })
}

/**
 * utm_mapping — Dejan's confirmed utm_content → real campaign table. It is the authoritative
 * lead→campaign join (Meta never exported url_tags), so it runs BEFORE any regex. It is
 * maintained by hand and therefore always a little behind the newest campaigns; the regex
 * fallback covers those. A failed fetch degrades to "no table", never to an error.
 */
async function loadUtmIndex(): Promise<Map<string, string>> {
  return cached('utmIndex', async () => {
    const byUtm = new Map<string, string>()
    try {
      const raw = await fetchRows(SHEETS_TABS.UTM_MAPPING)
      for (const r of raw) {
        const utm = nk(r.utm)
        const campaign = String(r.campaign ?? '').trim()
        if (!utm || !campaign) continue
        if (!byUtm.has(utm)) byUtm.set(utm, campaign)
      }
    } catch (e) {
      console.warn('[funnel] utm_mapping unavailable, falling back to regex only', (e as Error).message)
    }
    return byUtm
  })
}

// ─── Attribution ────────────────────────────────────────────────────────────

/** lowercase, strip diacritics, collapse every non-alphanumeric run to one space. */
export const nk = (s: any): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const EXACT_META = new Map<string, string>()
const EXACT_GOOGLE = new Map<string, string>()
for (const c of CAMPAIGNS) {
  for (const n of c.metaNames || []) EXACT_META.set(nk(n), c.slug)
  for (const n of c.googleNames || []) EXACT_GOOGLE.set(nk(n), c.slug)
}

const adSlugCache = new Map<string, string | null>()

/**
 * Which umbrella a real platform campaign belongs to. Exclusive by construction:
 * exact name first, then the fallback regexes in UMBRELLA_ORDER, first match wins.
 * `platform: null` = "either side" (used for booking rows, whose campaign column mixes both).
 */
export function adSlug(platform: 'meta' | 'google' | null, name: string): string | null {
  const key = `${platform ?? 'any'}|${name}`
  const hit = adSlugCache.get(key)
  if (hit !== undefined) return hit
  const k = nk(name)
  let out: string | null = null
  if (k) {
    if (platform !== 'google') out = EXACT_META.get(k) ?? null
    if (!out && platform !== 'meta') out = EXACT_GOOGLE.get(k) ?? null
    if (!out && platform === null) out = EXACT_META.get(k) ?? EXACT_GOOGLE.get(k) ?? null
    if (!out) {
      for (const c of ORDERED) {
        const metaHit = platform !== 'google' && c.fb && c.fb.test(name)
        const googleHit = platform !== 'meta' && c.google && c.google.test(name)
        if (metaHit || googleHit) {
          out = c.slug
          break
        }
      }
    }
  }
  adSlugCache.set(key, out)
  return out
}

/** bookings_api.campaign → umbrella. The campaign column mixes Meta and Google names. */
export function bookingSlug(b: { campaign: string; source: string }): string | null {
  const platform = b.source.startsWith('fb') ? 'meta' : b.source === 'google' ? 'google' : null
  return adSlug(platform, b.campaign) ?? adSlug(null, b.campaign)
}

/**
 * Which umbrella a Streak lead belongs to, or null (the unattributed remainder).
 * Resolution order:
 *   Google leads: SOURCE DETAIL is the campaign name → exact/regex campaign resolve, then
 *                 the umbrella's googleDetail matcher, then the placement matcher.
 *   FB leads:     utm_mapping (authoritative), then the placement read as a campaign name,
 *                 then the umbrella's sp matcher.
 * Placements that carry no campaign signal at all (empty, bare "facebook",
 * "ig / instagram_stories", a numeric id) resolve to null on purpose.
 */
export function leadSlug(lead: LeadRow, utmIndex?: Map<string, string>): string | null {
  if (lead.isGoogle) {
    const byName = adSlug('google', lead.detail)
    if (byName) return byName
    for (const c of ORDERED) if (c.googleDetail && c.googleDetail.test(lead.detail)) return c.slug
    // Google leads sometimes carry the raw search term in SOURCE DETAIL rather than the
    // campaign name; fall back to the placement token before giving up.
    for (const c of ORDERED) if (c.sp && c.sp.test(lead.sp)) return c.slug
    return null
  }
  if (utmIndex && utmIndex.size) {
    const campaign = utmIndex.get(nk(lead.sp))
    if (campaign) {
      const s = adSlug('meta', campaign)
      if (s) return s
    }
  }
  const byName = adSlug('meta', lead.sp)
  if (byName) return byName
  for (const c of ORDERED) if (c.sp && c.sp.test(lead.sp)) return c.slug
  return null
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export interface RawStepValues {
  impressions: number | null
  /** Meta link_click + Google clicks. */
  clicks: number | null
  /** Meta clicks(all) + Google clicks — reference only, never the funnel denominator. */
  clicksAll: number | null
  /** PAID sessions only (GA4 sessionSourceMedium carries a paid|cpc|ppc token). */
  lpViews: number | null
  /** Organic / direct / referral / email sessions on the same pages. Never in the funnel. */
  lpViewsOrganic: number | null
  leads: number | null
  /** QL, master-level EXCLUDING the ASSET umbrella (inflated AI score). */
  ql: number | null
  /** QL including ASSET — the pre-2026-09-09 number. */
  qlAll: number | null
  bookings: number | null
  revenue: number
  /** Bookings whose inquiry_date (exact date) falls inside the window. */
  bookingsCohort: number
  revenueCohort: number
  spend: number
}

interface Datasets {
  fb: { rows: AdDay[]; coverage: Coverage }
  fbSpend: { rows: { day: string; campaign: string; spend: number }[]; coverage: Coverage }
  google: { rows: AdDay[]; coverage: Coverage }
  ga4: { rows: LpDay[]; coverage: Coverage }
  streak: { rows: LeadRow[]; coverage: Coverage }
  bookings: { rows: BookingRow[]; coverage: Coverage; inquiryCoverage: Coverage }
  utmIndex: Map<string, string>
  /** memoised leadSlug per streak row index */
  leadSlugs: (string | null)[]
  /** memoised bookingSlug per bookings row index */
  bookingSlugs: (string | null)[]
}

export type Channel = 'all' | 'meta' | 'google'

const leadChannel = (l: LeadRow): Channel | null =>
  /face|meta|instagram/.test(l.platform) ? 'meta' : /google|adwords/.test(l.platform) ? 'google' : null

const bookingChannel = (b: { source: string }): 'meta' | 'google' | null =>
  b.source.startsWith('fb') ? 'meta' : b.source === 'google' ? 'google' : null

interface AggOpts {
  /** Month window for the bookings step (bookings are month-granular at source). */
  fromM: string
  toM: string
}

/** null-safe: a step is null only when NO source can answer it for this scope. */
function aggregate(
  ds: Datasets,
  def: CampaignDef | null,
  from: string,
  to: string,
  channel: Channel = 'all',
  opts?: AggOpts
): RawStepValues {
  const inRange = (d: string) => d >= from && d <= to
  const isMaster = def === null
  const wantSlug = def?.slug ?? null

  // ── Ads (impressions / clicks / spend) ──
  let impressions = 0
  let clicks = 0
  let clicksAll = 0
  let spend = 0
  let adSources = 0
  const metaInScope = (isMaster || !!def!.metaNames?.length || !!def!.fb) && channel !== 'google'
  const googleInScope = (isMaster || !!def!.googleNames?.length || !!def!.google) && channel !== 'meta'

  if (metaInScope) {
    adSources++
    const useApiSpend = ds.fbSpend.rows.length > 0
    for (const r of ds.fb.rows) {
      if (!inRange(r.day)) continue
      if (!isMaster && adSlug('meta', r.campaign) !== wantSlug) continue
      impressions += r.impressions
      clicks += r.clicks
      clicksAll += r.clicksAll
      if (!useApiSpend) spend += r.spend
    }
    if (useApiSpend) {
      for (const r of ds.fbSpend.rows) {
        if (!inRange(r.day)) continue
        if (!isMaster && adSlug('meta', r.campaign) !== wantSlug) continue
        spend += r.spend
      }
    }
  }
  if (googleInScope) {
    adSources++
    for (const r of ds.google.rows) {
      if (!inRange(r.day)) continue
      if (!isMaster && adSlug('google', r.campaign) !== wantSlug) continue
      impressions += r.impressions
      clicks += r.clicks
      clicksAll += r.clicksAll
      spend += r.spend
    }
  }

  // ── LP views (GA4) — PAID ONLY on every view, master included ──
  // Organic/direct/referral/email is reported separately as lpViewsOrganic and never mixed
  // into the funnel: leads and bookings are paid-only at source, so an all-traffic LP-view
  // number made every downstream rate look ~25% worse than it is.
  let lpViews: number | null = null
  let lpViewsOrganic: number | null = null
  if (isMaster || def!.lp) {
    lpViews = 0
    lpViewsOrganic = 0
    for (const r of ds.ga4.rows) {
      if (!inRange(r.day)) continue
      if (def?.lp && !def.lp.test(r.lp)) continue
      if (r.channel === 'other') {
        lpViewsOrganic += r.sessions
        continue
      }
      if (channel !== 'all' && r.channel !== channel) continue
      lpViews += r.sessions
    }
  }

  // ── Leads / QL (Streak) ──
  let leads = 0
  let ql = 0
  let qlAll = 0
  for (let i = 0; i < ds.streak.rows.length; i++) {
    const r = ds.streak.rows[i]
    if (!inRange(r.day)) continue
    if (channel !== 'all' && leadChannel(r) !== channel) continue
    const slug = ds.leadSlugs[i]
    if (!isMaster && slug !== wantSlug) continue
    leads++
    if (r.ai >= QL_THRESHOLD) {
      qlAll++
      // Master QL excludes the ASSET umbrella — its Streak AI score is inflated, so keeping
      // it in made master CPQL read better than the account really performs.
      if (!(isMaster && slug && AI_INFLATED_SLUGS.has(slug))) ql++
    }
  }

  // ── Bookings / RVC — month-granular at source (bookings_api.booking_date = YYYY-MM) ──
  const fromM = opts?.fromM ?? from.slice(0, 7)
  const toM = opts?.toM ?? to.slice(0, 7)
  let bookings = 0
  let revenue = 0
  let bookingsCohort = 0
  let revenueCohort = 0
  for (let i = 0; i < ds.bookings.rows.length; i++) {
    const r = ds.bookings.rows[i]
    if (channel !== 'all' && bookingChannel(r) !== channel) continue
    if (!isMaster && ds.bookingSlugs[i] !== wantSlug) continue
    if (r.month >= fromM && r.month <= toM) {
      bookings++
      revenue += r.rvc // RVC IS the commission — never multiply by a margin
    }
    // Cohort: the booking is counted in the window its INQUIRY landed in, so it lines up
    // date-exactly with spend and leads. inquiry_date is empty on part of the feed.
    if (r.inquiryDay && r.inquiryDay >= from && r.inquiryDay <= to) {
      bookingsCohort++
      revenueCohort += r.rvc
    }
  }

  return {
    impressions: adSources ? impressions : null,
    clicks: adSources ? clicks : null,
    clicksAll: adSources ? clicksAll : null,
    lpViews,
    lpViewsOrganic,
    leads,
    ql,
    qlAll,
    bookings,
    revenue,
    bookingsCohort,
    revenueCohort,
    spend,
  }
}

// ─── Real campaign breakdown inside an umbrella ─────────────────────────────
//
// Each umbrella covers one or more real ad-platform campaigns. This resolves it into the
// exact platform campaign names — the same strings that live in fb_ads_api / fb_ads_raw /
// daily_api and in the Acq Channel sheet's Campaign column. Nothing is prettified.
//
// Attribution per sub-row:
//   spend      — exact, straight from the ads feeds.
//   Google leads — Streak SOURCE DETAIL is the lowercased Google campaign name: exact match.
//   FB leads     — utm_mapping first, then lib/fuzzy-match.ts, restricted to this umbrella's
//                  campaigns. If the umbrella has exactly ONE live FB campaign, an umbrella
//                  lead can only have come from it, so it pins there by deduction.
//   bookings     — bookings_api.campaign already holds exact real names: exact match. A
//                  booking naming a campaign with no spend in range (a historic campaign)
//                  still gets its own row under its real name, with spend 0.

export const UNASSIGNED = '(unassigned within funnel)'

/** lowercase, strip diacritics, drop every non-alphanumeric — used to join placements. */
const sqKey = (s: string): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')

/**
 * Streak SOURCE PLACEMENT → real campaign, resolved 2026-08-07 against the LIVE Meta entity
 * graph. Every entry is a case where the placement token matches an entity that ran in
 * EXACTLY ONE campaign in that window — a deduction from the platform's own structure.
 * utm_mapping now runs first; this table stays as the resolution for placements it lacks.
 */
const PLACEMENT_CAMPAIGN: Record<string, string> = {
  // ── A) ad-name join ──────────────────────────────────────────────────────
  maxitaonetakeverticaldesirelastminutedalmatincki: 'Dalmatinčki - Julij 2026',
  dalmatinosalesverticalwaitlastminutedalmatincki: 'Dalmatinčki - Julij 2026',
  socialbestanimamarisverticalfearlastminutedalmatinckiv2: 'Dalmatinčki - Julij 2026',
  socialbestanimamarisverticalfearlastminutedalmatinckiv3: 'Dalmatinčki - Julij 2026',

  // ── B) ad-set join ───────────────────────────────────────────────────────
  turkeygeneralinteresilabellavitavo: 'TURKEY – Creative Test – ABO',
  turkeygeneralinteresiesmasultankids: 'TURKEY – Creative Test – ABO',
  turkeycalculatorretargetingbelginwalkthrough: 'TURKEY – Calculator - ABO',
  turkeycalculatorretargetingcalculator1: 'TURKEY – Calculator - ABO',

  // ── B2) `-jul` ad-set suffixes — APPROVED BY DEJAN 2026-08-07 ────────────
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
 * RareOps placements → their ASSET campaign, by VESSEL TOKEN (Dejan-confirmed 2026-08-07).
 * Returns null when the vessel is ambiguous or absent — those stay in UNASSIGNED.
 */
function pinRareOps(sp: string, fbNames: string[]): string | null {
  const key = sqKey(sp)
  if (!key.startsWith('rareops')) return null
  const isFormVariant = /form\d/.test(key)

  const matches: string[] = []
  for (const name of fbNames) {
    const m = name.match(/asset\s*[–—-]\s*(.+?)\s*[–—-]\s*rare\s*ops/i)
    if (!m) continue
    const vessel = sqKey(m[1])
    if (!vessel || !key.includes(vessel)) continue
    const isPravaForma = /^pravaforma/.test(sqKey(name))
    if (isPravaForma === isFormVariant) matches.push(name)
  }
  return matches.length === 1 ? matches[0] : null
}

function campaignBreakdown(
  ds: Datasets,
  def: CampaignDef,
  from: string,
  to: string,
  channel: Channel,
  opts: AggOpts
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
  if (channel !== 'google') {
    const useApiSpend = ds.fbSpend.rows.length > 0
    for (const r of ds.fb.rows) {
      if (!inRange(r.day) || adSlug('meta', r.campaign) !== def.slug) continue
      const e = row(r.campaign, 'meta')
      if (!useApiSpend) e.spend += r.spend
      if (!fbNames.includes(r.campaign)) fbNames.push(r.campaign)
    }
    if (useApiSpend) {
      for (const r of ds.fbSpend.rows) {
        if (!inRange(r.day) || adSlug('meta', r.campaign) !== def.slug) continue
        row(r.campaign, 'meta').spend += r.spend
        if (!fbNames.includes(r.campaign)) fbNames.push(r.campaign)
      }
    }
  }
  const googleByNorm = new Map<string, string>()
  if (channel !== 'meta') {
    for (const r of ds.google.rows) {
      if (!inRange(r.day) || adSlug('google', r.campaign) !== def.slug) continue
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
    // 0. utm_mapping — Dejan's confirmed table, the authoritative join.
    let resolved: string | null = null
    const fromUtm = ds.utmIndex.get(nk(sp))
    if (fromUtm) resolved = fbNames.find((n) => sqKey(n) === sqKey(fromUtm)) || null
    // 1. Some placements ARE the campaign name verbatim ("dalmatinčki - abo - lf").
    if (!resolved) resolved = fbNames.find((n) => sqKey(n) === sqKey(sp)) || null
    // 2. Meta entity-graph resolution (ad / ad-set name unique to one campaign).
    if (!resolved) {
      const mapped = PLACEMENT_CAMPAIGN[sqKey(sp)]
      if (mapped) {
        const k = sqKey(mapped)
        resolved = fbNames.find((n) => sqKey(n) === k) || null
      }
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

  for (let i = 0; i < ds.streak.rows.length; i++) {
    const l = ds.streak.rows[i]
    if (!inRange(l.day)) continue
    if (channel !== 'all' && leadChannel(l) !== channel) continue
    if (ds.leadSlugs[i] !== def.slug) continue
    const name = l.isGoogle ? googleByNorm.get(normName(l.detail)) || null : pinFb(l.sp)
    const e = name ? row(name, l.isGoogle ? 'google' : 'meta') : row(UNASSIGNED, null)
    e.leads = (e.leads || 0) + 1
    if (l.ai >= QL_THRESHOLD) e.ql = (e.ql || 0) + 1
  }

  // ── 3. Bookings + RVC ──
  for (let i = 0; i < ds.bookings.rows.length; i++) {
    const b = ds.bookings.rows[i]
    if (b.month < opts.fromM || b.month > opts.toM) continue
    if (channel !== 'all' && bookingChannel(b) !== channel) continue
    if (ds.bookingSlugs[i] !== def.slug) continue
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
// APPROVED 2026-09-09: the benchmark for a step is this account's own conversion rate over
// the PREVIOUS PERIOD OF THE SAME LENGTH, immediately before the window — clipped to the
// coverage of every source the step uses. When too little of that period is covered the
// benchmark is null and `basis` says why. Colour semantics are unchanged.

const MIN_BENCH_DAYS = 7

type SourceKey = 'fb' | 'google' | 'ga4' | 'streak' | 'bookings'

const STEP_SOURCES: Record<string, SourceKey[]> = {
  impressions: ['fb', 'google'],
  clicks: ['fb', 'google'],
  lpViews: ['ga4', 'fb', 'google'],
  leads: ['streak', 'ga4'],
  ql: ['streak'],
  bookings: ['bookings', 'streak'],
}

function sourcesUsed(def: CampaignDef | null, keys: SourceKey[], channel: Channel = 'all'): SourceKey[] {
  return keys.filter((k) => {
    if (k === 'fb' && channel === 'google') return false
    if (k === 'google' && channel === 'meta') return false
    if (!def) return true
    if (k === 'fb') return !!(def.metaNames?.length || def.fb)
    if (k === 'google') return !!(def.googleNames?.length || def.google)
    if (k === 'ga4') return !!def.lp
    return true
  })
}

// ─── Targets ────────────────────────────────────────────────────────────────

export interface FunnelTargets {
  spend: number | null
  leads: number | null
  qualityLeads: number | null
  bookings: number | null
  revenue: number | null
  cpl: number | null
  cpql: number | null
  costPerBooking: number | null
  roas: number | null
}

const TARGETS_SOURCE = 'config/funnel-targets.json'

function targetsFor(slug: string): FunnelTargets | null {
  const cfg = targetsConfig as unknown as {
    master?: Partial<FunnelTargets>
    umbrellas?: Record<string, Partial<FunnelTargets>>
  }
  const raw = slug === 'master' ? cfg.master : cfg.umbrellas?.[slug]
  if (!raw) return null
  const t: FunnelTargets = {
    spend: raw.spend ?? null,
    leads: raw.leads ?? null,
    qualityLeads: raw.qualityLeads ?? null,
    bookings: raw.bookings ?? null,
    revenue: raw.revenue ?? null,
    cpl: raw.cpl ?? null,
    cpql: raw.cpql ?? null,
    costPerBooking: raw.costPerBooking ?? null,
    roas: raw.roas ?? null,
  }
  // Nothing filled in yet → keep the old `targets: null` contract.
  return Object.values(t).some((v) => v != null) ? t : null
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
  /** Bookings step only. null = the bookings source does not cover the window at all. */
  revenue?: number | null
  /** Only present when the natural previous step is null and a different denominator was
   *  used (today: leads measured off clicks because a channel view cannot split LP views). */
  cvrBasis?: string
  /** Clicks step only: Meta clicks(all) + Google clicks. The step value itself is link clicks. */
  clicksAll?: number | null
  /** LP-views step only: organic / direct / referral / email sessions on the same pages. */
  lpViewsOrganic?: number | null
  /** QL step only: QL including the ASSET umbrella (the step value excludes it on master). */
  qualityLeadsIncludingAsset?: number | null
  /** Bookings step only: bookings counted by inquiry_date inside the window (date-exact). */
  bookingsCohort?: { count: number; revenue: number }
  /** Bookings step only: bookingsCohort.count ÷ leads. */
  leadsToBookingCohortRate?: number | null
  /** Per-step channel split. Present on all-channel views; omitted on ?channel= views. */
  channels?: FunnelStepChannel[]
}

export interface FunnelStepChannel {
  key: 'meta' | 'google' | 'other'
  label: string
  /** This channel's count for this step. null = the source cannot answer it. */
  value: number | null
  /** value ÷ this step's total in the CURRENT view. */
  share: number | null
  /** NEXT step's value for this channel ÷ THIS step's value. */
  cvrToNext: number | null
  benchmarkCvr: number | null
  status: 'g' | 'a' | 'r' | null
  /** false = the feed genuinely cannot answer this. */
  available: boolean
  /** true = the concept does not exist for this channel/step (organic has no impressions). */
  notApplicable?: boolean
  /** Bookings step only: that channel's RVC in €. */
  revenue?: number | null
  /** Bookings step only: that channel's ad spend in €. null for "other". */
  spend?: number | null
  /** Bookings step only: revenue ÷ spend. */
  roas?: number | null
}

const CHANNEL_LABELS = [
  { key: 'meta', label: 'Paid Meta' },
  { key: 'google', label: 'Paid Google' },
  { key: 'other', label: 'Organic + Direct' },
] as const

export interface UmbrellaMember {
  platform: 'meta' | 'google' | null
  name: string
  spend: number
  /** member spend ÷ this umbrella's spend */
  spendShare: number | null
  leads: number | null
  ql: number | null
  bookings: number | null
  revenue: number | null
}

export interface UmbrellaMembership {
  key: string
  label: string
  nonKpi: boolean
  aiScoreInflated: boolean
  channels: ('meta' | 'google')[]
  totals: {
    spend: number
    /** umbrella spend ÷ master spend for the same window/channel */
    spendShare: number | null
    leads: number
    qualityLeads: number
    bookings: number
    revenue: number
  }
  members: UmbrellaMember[]
}

export interface CampaignMembership {
  selected: string
  umbrellas: UmbrellaMembership[]
  unattributed: {
    leads: number
    qualityLeads: number
    bookings: number
    revenue: number
    spend: number
    members: { platform: 'meta' | 'google'; name: string; spend: number }[]
  }
}

export interface FunnelResponse {
  meta: Record<string, unknown>
  campaigns: { slug: string; name: string; nonKpi: boolean; aiScoreInflated: boolean }[]
  steps: FunnelStep[]
  efficiency: {
    spend: number | null
    cpm: number | null
    cpc: number | null
    cpl: number | null
    cpql: number | null
    costPerBooking: number | null
    roas: number | null
  }
  targets: FunnelTargets | null
  retention: { available: false; note: string }
  attribution: { unattributedLeads: number; unattributedShare: number }
  campaignMembership: CampaignMembership
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
  { key: 'clicks', label: 'Clicks', source: 'Meta link_click + Google Ads' },
  { key: 'lpViews', label: 'LP Views', source: 'GA4 · paid only' },
  { key: 'leads', label: 'Leads', source: 'Streak' },
  { key: 'ql', label: 'Quality Leads', source: 'Streak · AI≥50' },
  { key: 'bookings', label: 'Bookings', source: 'bookings_api' },
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
  /** Optional range key; when given it has already been resolved into start/end. */
  range?: ResolvedRange
}): Promise<FunnelResponse> {
  const reqStart = opts.start
  const reqEnd = opts.end
  const channel: Channel = opts.channel || 'all'
  const slug = opts.campaign && opts.campaign !== 'master' ? opts.campaign : 'master'
  const def = slug === 'master' ? null : CAMPAIGNS.find((c) => c.slug === slug) || null
  if (slug !== 'master' && !def) throw new Error(`Unknown campaign "${slug}"`)

  const [fb, fbSpend, google, ga4, streak, bookings, utmIndex] = await Promise.all([
    loadFb(),
    loadFbSpend(),
    loadGoogle(),
    loadGa4(),
    loadStreak(),
    loadBookings(),
    loadUtmIndex(),
  ])

  const ds: Datasets = {
    fb,
    fbSpend,
    google,
    ga4,
    streak,
    bookings,
    utmIndex,
    leadSlugs: streak.rows.map((r) => leadSlug(r, utmIndex)),
    bookingSlugs: bookings.rows.map((r) => bookingSlug(r)),
  }

  // Meta coverage = the days BOTH Meta feeds can answer (spend from fb_ads_api, counts from
  // fb_ads_raw). Anything outside it would mix a covered numerator with a missing denominator.
  const fbCombined = intersectCoverage(fb.coverage, fbSpend.coverage)
  const coverage: Record<SourceKey, Coverage> = {
    fb: fbCombined,
    google: google.coverage,
    ga4: ga4.coverage,
    streak: streak.coverage,
    bookings: bookings.coverage,
  }

  // ── Effective window: requested ∩ EVERY paid source ──
  // FIXED 2026-09-09: the intersection deliberately ignores the campaign and channel filter.
  // Scoping it to the sources a view happens to use made the window drift per view — a
  // Google-only umbrella (brand/pmax/youtube) or ?channel=google clipped to Google coverage
  // (…09-09) while the mixed master clipped to Meta (…09-08), so the master row "Brand €9,094"
  // opened a drill-down showing €9,133 for the very same campaign and range. Every view of a
  // given range must be measured over the SAME days, so all four day-granular sources clip it.
  // Bookings are deliberately NOT part of the intersection: they have full history and are
  // month-granular, so they get their own window (meta.bookingsWindow).
  const stepSources: SourceKey[] = ['fb', 'google', 'ga4', 'streak']
  let effFrom = reqStart
  let effTo = reqEnd
  const clippedBy: string[] = []
  for (const k of stepSources) {
    const c = coverage[k]
    if (!c.min || !c.max) continue
    if (c.min > effFrom) {
      effFrom = c.min
      clippedBy.push(`${k} starts ${c.min}`)
    }
    if (c.max < effTo) {
      effTo = c.max
      clippedBy.push(`${k} ends ${c.max}`)
    }
  }
  const windowEmpty = effFrom > effTo
  if (windowEmpty) {
    // Nothing in common — report the requested window and let every step come back at 0/null.
    effFrom = reqStart
    effTo = reqStart
  }
  const clipped = effFrom !== reqStart || effTo !== reqEnd

  // ── Bookings window: whole months intersecting the REQUESTED window ──
  const bookingsFromM = reqStart.slice(0, 7)
  const bookingsToM = reqEnd.slice(0, 7)
  const bookingOpts: AggOpts = { fromM: bookingsFromM, toM: bookingsToM }
  const bookingsAligned = `${bookingsFromM}-01` !== reqStart || monthEnd(bookingsToM) !== reqEnd

  // ── Coverage gap → null, never 0 ──
  // A window with no overlap at all is a GAP. Printing 0 there reads as "we ran ads and
  // nothing converted", which is the exact lie the freshness contract exists to prevent, so
  // every day-granular step goes null (the UI prints "—"). Bookings are the exception: they
  // have their own month window and history far behind the ad feeds, so a 2025 month can carry
  // real bookings even when no ad source reaches it. They only go null when bookings_api
  // ITSELF does not reach the requested months.
  const bookingsGap =
    !bookings.coverage.min ||
    !bookings.coverage.max ||
    monthEnd(bookingsToM) < bookings.coverage.min ||
    `${bookingsFromM}-01` > bookings.coverage.max
  const gapAll = windowEmpty

  const cur = aggregate(ds, def, effFrom, effTo, channel, bookingOpts)

  // ── Benchmark window: the previous period of the same length ──
  const windowDays = daysBetween(effFrom, effTo)
  const prevTo = addDays(effFrom, -1)
  const prevFrom = addDays(prevTo, -(windowDays - 1))

  const histCache = new Map<string, RawStepValues>()
  const histFor = (from: string, to: string) => {
    const k = `${from}|${to}`
    let v = histCache.get(k)
    if (!v) {
      v = aggregate(ds, def, from, to, channel, { fromM: from.slice(0, 7), toM: to.slice(0, 7) })
      histCache.set(k, v)
    }
    return v
  }

  /** Clip the previous period to the coverage of the sources a step uses. */
  function benchWindow(used: SourceKey[]): { from: string; to: string; covered: number } | null {
    let from = prevFrom
    let to = prevTo
    for (const k of used) {
      const c = coverage[k]
      if (!c?.min || !c?.max) return null
      if (c.min > from) from = c.min
      if (c.max < to) to = c.max
    }
    if (from > to) return null
    const covered = daysBetween(from, to)
    // A previous period that is mostly missing is not a benchmark, it is noise.
    if (covered < MIN_BENCH_DAYS || covered * 2 < windowDays) return null
    return { from, to, covered }
  }

  const values: Record<string, number | null> = {
    impressions: gapAll ? null : cur.impressions,
    clicks: gapAll ? null : cur.clicks,
    lpViews: gapAll ? null : cur.lpViews,
    leads: gapAll ? null : cur.leads,
    ql: gapAll ? null : cur.ql,
    bookings: bookingsGap ? null : cur.bookings,
  }
  const pick = (v: RawStepValues, key: string): number | null =>
    (v as unknown as Record<string, number | null>)[key]

  // ── Per-step channel split (all-channel views only) ──
  const splitOn = channel === 'all'
  const chCur: Record<'meta' | 'google', RawStepValues> | null = splitOn
    ? {
        meta: aggregate(ds, def, effFrom, effTo, 'meta', bookingOpts),
        google: aggregate(ds, def, effFrom, effTo, 'google', bookingOpts),
      }
    : null
  const chHistCache = new Map<string, RawStepValues>()
  const chHistFor = (ch: 'meta' | 'google', from: string, to: string) => {
    const k = `${ch}|${from}|${to}`
    let v = chHistCache.get(k)
    if (!v) {
      v = aggregate(ds, def, from, to, ch, { fromM: from.slice(0, 7), toM: to.slice(0, 7) })
      chHistCache.set(k, v)
    }
    return v
  }

  const benchmarkMeta: Record<string, unknown> = {}
  const steps: FunnelStep[] = STEP_DEFS.map((s, i) => {
    const naturalPrev = i > 0 ? STEP_DEFS[i - 1].key : null
    // When LP views cannot be measured, the Leads step would lose its rate entirely.
    // Fall back to clicks→leads and say so.
    const fellBack = s.key === 'leads' && naturalPrev === 'lpViews' && values.lpViews === null
    const prevKey = fellBack ? 'clicks' : naturalPrev
    const cvrFromPrev = prevKey ? div(values[s.key], values[prevKey]) : null

    let benchmarkCvr: number | null = null
    let reason = 'first step — no previous step'
    let win: { from: string; to: string; covered: number } | null = null
    if (prevKey) {
      const used = sourcesUsed(
        def,
        [...(STEP_SOURCES[s.key] || []), ...(STEP_SOURCES[prevKey] || [])],
        channel
      ).filter((v, idx, arr) => arr.indexOf(v) === idx)
      win = benchWindow(used)
      if (!win) {
        const thin = used.filter((k) => overlapDays(coverage[k], prevFrom, prevTo) < MIN_BENCH_DAYS)
        reason = `previous period ${prevFrom}…${prevTo} not covered by ${thin.join(', ') || used.join(', ')}`
      } else {
        const h = histFor(win.from, win.to)
        benchmarkCvr = div(pick(h, s.key), pick(h, prevKey))
        reason =
          benchmarkCvr == null
            ? 'zero denominator in the previous period'
            : win.covered < windowDays
              ? `ok (previous period clipped to ${win.from}…${win.to}, ${win.covered}/${windowDays}d covered)`
              : 'ok'
      }
    }
    benchmarkMeta[s.key] = {
      benchmarkCvr,
      basis: reason,
      window: win ? { from: win.from, to: win.to } : null,
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
    if (s.key === 'clicks') step.clicksAll = gapAll ? null : cur.clicksAll
    if (s.key === 'lpViews') step.lpViewsOrganic = gapAll ? null : cur.lpViewsOrganic
    if (s.key === 'ql') step.qualityLeadsIncludingAsset = gapAll ? null : cur.qlAll
    if (s.key === 'bookings') {
      step.revenue = bookingsGap ? null : cur.revenue
      // The cohort is counted by inquiry_date inside the DAY window, so it is a gap whenever
      // either side of it is — omitted rather than printed as a 0 that means "none happened".
      if (!gapAll && !bookingsGap) {
        step.bookingsCohort = { count: cur.bookingsCohort, revenue: cur.revenueCohort }
        step.leadsToBookingCohortRate = div(cur.bookingsCohort, cur.leads)
      } else {
        step.leadsToBookingCohortRate = null
      }
    }
    if (fellBack) step.cvrBasis = 'clicks'

    // ── channels: value/share for THIS step, plus the rate DOWN to the next step ──
    if (splitOn && chCur) {
      const nextKey = i < STEP_DEFS.length - 1 ? STEP_DEFS[i + 1].key : null
      step.channels = CHANNEL_LABELS.map((cm): FunnelStepChannel => {
        if (cm.key === 'other') {
          // LP views is the ONLY step with a real non-paid number, and even there it sits
          // NEXT TO the funnel rather than inside it (the step total is paid-only). For
          // impressions/clicks the concept does not exist; for leads/ql/bookings the feeds
          // are paid-only at source — both are notApplicable, never 0.
          const isLp = s.key === 'lpViews'
          const val = isLp ? cur.lpViewsOrganic : null
          const o: FunnelStepChannel = {
            key: 'other',
            label: cm.label,
            value: val,
            // Deliberately null: organic is NOT part of the paid-only step total, so a share
            // of it would be a fraction of the wrong denominator.
            share: null,
            cvrToNext: null,
            benchmarkCvr: null,
            status: null,
            available: val != null,
            notApplicable: !isLp,
          }
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
          const w = benchWindow(used)
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
  // Every cost metric divides by spend. Because every step is computed on effectiveWindow,
  // the denominator and the numerators now span exactly the same days — the 2026-08 failure
  // (fb_ads_raw froze, ROAS printed 69.75x on Google-only spend) cannot recur by clipping.
  // The metrics only go null when the Meta feed cannot answer the window AT ALL.
  const metaInScope = channel !== 'google' && (def === null || !!def.metaNames?.length || !!def.fb)
  // On a window with no coverage at all NOTHING is measurable, not even on a Google-only view:
  // spend would otherwise print 0 next to null steps.
  const metaFeedUsable =
    !windowEmpty && (!metaInScope || (!!fbCombined.min && !!fbCombined.max))
  // Bookings are month-granular and never clipped, so cost/booking and ROAS are only honest
  // while the bookings months ARE the effective window's months. On YTD, where clipping drops
  // the window to 2026-06-11…, revenue would still carry January–May and ROAS would print
  // ~8x on three months of spend. Better null than flattering.
  const bookingsMonthsMatchWindow =
    bookingsFromM === effFrom.slice(0, 7) && bookingsToM === effTo.slice(0, 7)
  const spend = metaFeedUsable ? cur.spend : null
  const efficiency = {
    spend,
    cpm: metaFeedUsable && cur.impressions ? (cur.spend / cur.impressions) * 1000 : null,
    cpc: metaFeedUsable && cur.clicks ? cur.spend / cur.clicks : null,
    cpl: metaFeedUsable && cur.leads ? cur.spend / cur.leads : null,
    cpql: metaFeedUsable && cur.ql ? cur.spend / cur.ql : null,
    costPerBooking:
      metaFeedUsable && bookingsMonthsMatchWindow && cur.bookings ? cur.spend / cur.bookings : null,
    roas:
      metaFeedUsable && bookingsMonthsMatchWindow && cur.spend > 0 ? cur.revenue / cur.spend : null,
  }

  // ── Attribution remainder (Streak leads in range that match no umbrella) ──
  let totalLeads = 0
  let unattributedLeads = 0
  for (let i = 0; i < streak.rows.length; i++) {
    const r = streak.rows[i]
    if (r.day < effFrom || r.day > effTo) continue
    if (channel !== 'all' && leadChannel(r) !== channel) continue
    totalLeads++
    if (ds.leadSlugs[i] === null) unattributedLeads++
  }

  // ── Membership: every umbrella + the unattributed remainder ──
  const masterAgg = slug === 'master' ? cur : aggregate(ds, null, effFrom, effTo, channel, bookingOpts)
  const shownUmbrellas = slug === 'master' ? CAMPAIGNS : [def!]
  const perUmbrella = shownUmbrellas.map((c) => {
    const a = aggregate(ds, c, effFrom, effTo, channel, bookingOpts)
    const members = campaignBreakdown(ds, c, effFrom, effTo, channel, bookingOpts)
    const hasMeta = !!(c.metaNames?.length || c.fb)
    const hasGoogle = !!(c.googleNames?.length || c.google)
    const channels: ('meta' | 'google')[] = []
    if (hasMeta && channel !== 'google') channels.push('meta')
    if (hasGoogle && channel !== 'meta') channels.push('google')
    const u: UmbrellaMembership = {
      key: c.slug,
      label: c.name,
      nonKpi: !!c.nonKpi,
      aiScoreInflated: !!c.aiScoreInflated,
      channels,
      totals: {
        spend: a.spend,
        spendShare: masterAgg.spend > 0 ? a.spend / masterAgg.spend : null,
        leads: a.leads ?? 0,
        // Per-umbrella QL is always that umbrella's own QL (ASSET included on its own view).
        qualityLeads: a.qlAll ?? 0,
        bookings: a.bookings ?? 0,
        revenue: a.revenue,
      },
      members: members.map((m) => ({
        platform: m.platform,
        name: m.name,
        spend: m.spend,
        spendShare: a.spend > 0 ? m.spend / a.spend : null,
        leads: m.leads,
        ql: m.ql,
        bookings: m.bookings,
        revenue: m.revenue,
      })),
      _agg: a,
    } as UmbrellaMembership & { _agg: RawStepValues }
    return u as UmbrellaMembership & { _agg: RawStepValues }
  })

  // Platform campaigns that land in no umbrella at all (should be empty — the report checks it).
  const orphanSpend = new Map<string, { platform: 'meta' | 'google'; name: string; spend: number }>()
  if (channel !== 'google') {
    const useApiSpend = fbSpend.rows.length > 0
    const src = useApiSpend ? fbSpend.rows : fb.rows
    for (const r of src) {
      if (r.day < effFrom || r.day > effTo) continue
      if (adSlug('meta', r.campaign) !== null) continue
      const k = `meta|${r.campaign}`
      const e = orphanSpend.get(k) || { platform: 'meta' as const, name: r.campaign, spend: 0 }
      e.spend += r.spend
      orphanSpend.set(k, e)
    }
  }
  if (channel !== 'meta') {
    for (const r of google.rows) {
      if (r.day < effFrom || r.day > effTo) continue
      if (adSlug('google', r.campaign) !== null) continue
      const k = `google|${r.campaign}`
      const e = orphanSpend.get(k) || { platform: 'google' as const, name: r.campaign, spend: 0 }
      e.spend += r.spend
      orphanSpend.set(k, e)
    }
  }

  // On master the umbrellas cover the whole account, so the remainder is master − Σ umbrellas.
  const sumOf = (f: (a: RawStepValues) => number) =>
    slug === 'master' ? perUmbrella.reduce((n, u) => n + f(u._agg), 0) : 0
  /** Float noise from summing 50+ campaign spends must not print as "1e-10 unattributed". */
  const zeroish = (x: number) => (Math.abs(x) < 1e-6 ? 0 : x)
  const campaignMembership: CampaignMembership = {
    selected: slug,
    umbrellas: perUmbrella
      .map(({ _agg, ...rest }) => rest)
      .sort((a, b) => b.totals.spend - a.totals.spend),
    unattributed:
      slug === 'master'
        ? {
            leads: (masterAgg.leads ?? 0) - sumOf((a) => a.leads ?? 0),
            qualityLeads: (masterAgg.qlAll ?? 0) - sumOf((a) => a.qlAll ?? 0),
            bookings: (masterAgg.bookings ?? 0) - sumOf((a) => a.bookings ?? 0),
            revenue: zeroish(masterAgg.revenue - sumOf((a) => a.revenue)),
            spend: zeroish(masterAgg.spend - sumOf((a) => a.spend)),
            members: [...orphanSpend.values()].sort((a, b) => b.spend - a.spend),
          }
        : { leads: 0, qualityLeads: 0, bookings: 0, revenue: 0, spend: 0, members: [] },
  }

  // ── Per-campaign summary (master only) — unchanged shape, backwards compatible ──
  const campaignSummary =
    slug === 'master'
      ? perUmbrella.map((u) => ({
          slug: u.key,
          name: u.label,
          spend: u.totals.spend,
          leads: u.totals.leads,
          ql: u.totals.qualityLeads,
          bookings: u.totals.bookings,
          revenue: u.totals.revenue,
          campaigns: u.members.map((m) => ({
            name: m.name,
            platform: m.platform,
            spend: m.spend,
            leads: m.leads,
            ql: m.ql,
            bookings: m.bookings,
            revenue: m.revenue,
          })),
        }))
      : null

  const range: ResolvedRange =
    opts.range || { requested: 'custom', effective: 'custom', from: reqStart, to: reqEnd }

  const cov = (c: Coverage) => ({ from: c.min || null, to: c.max || null, min: c.min, max: c.max })

  return {
    meta: {
      start: effFrom,
      end: effTo,
      requestedStart: reqStart,
      requestedEnd: reqEnd,
      campaign: slug,
      channel,
      generatedAt: new Date().toISOString(),
      qlThreshold: QL_THRESHOLD,
      range,
      effectiveWindow: { from: effFrom, to: effTo, clipped },
      bookingsWindow: {
        from: `${bookingsFromM}-01`,
        to: monthEnd(bookingsToM),
        alignedToMonths: true,
      },
      targetsSource: TARGETS_SOURCE,
      benchmark: {
        method:
          "account-own CVR per step over the PREVIOUS PERIOD OF THE SAME LENGTH immediately before the effective window, clipped to the coverage of every source that step uses. null when fewer than 7 days — or less than half the window — of that period are covered.",
        window: { from: prevFrom, to: prevTo },
        minBenchDays: MIN_BENCH_DAYS,
        steps: benchmarkMeta,
      },
      coverage: {
        fb: cov(fbCombined),
        fbSpend: cov(fbSpend.coverage),
        fbMetrics: cov(fb.coverage),
        google: cov(google.coverage),
        ga4: cov(ga4.coverage),
        streak: cov(streak.coverage),
        bookings: cov(bookings.coverage),
        bookingsInquiry: cov(bookings.inquiryCoverage),
      },
      notes: [
        clipped
          ? `Window clipped from ${reqStart}…${reqEnd} to ${effFrom}…${effTo} so every step is measured over the same days (${[...new Set(clippedBy)].join('; ')}). Without this the spend denominator misses days the lead numerator still counts.`
          : null,
        windowEmpty
          ? `The requested window ${reqStart}…${reqEnd} lies entirely outside the coverage of at least one paid source — every day-granular step, and every efficiency metric, is null rather than 0. This is a coverage gap, not a performance collapse.`
          : null,
        bookingsGap
          ? `bookings_api covers ${bookings.coverage.min || 'n/a'}…${bookings.coverage.max || 'n/a'} and does not reach ${bookingsFromM}…${bookingsToM}, so bookings and revenue are null (unknown), not 0.`
          : null,
        metaInScope && fbCombined.max && fbCombined.max < reqEnd
          ? `FB spend covered to ${fbCombined.max} (requested window ends ${reqEnd}). Rather than null every cost metric, the whole funnel is measured on the covered sub-window — so spend, CPM, CPC, CPL, CPQL and ROAS are real numbers over ${effFrom}…${effTo}, not a full-window numerator over a part-window denominator.`
          : null,
        'Spend comes from fb_ads_api (the 2026-08-17 Meta cutover feed) + daily_api; impressions and clicks from fb_ads_raw, the only Meta tab carrying them. The two Meta feeds agree within 0.5% on every full month they share.',
        'Clicks = Meta link_click + Google clicks. Meta "clicks (all)" (post reactions, profile taps, …) is reported next to it as clicksAll and is never the funnel denominator.',
        'lpViews counts PAID sessions only on EVERY view, master included (GA4 sessionSourceMedium carries a paid|cpc|ppc token). Organic/direct/referral/email is reported as lpViewsOrganic and is deliberately outside the funnel, because leads and bookings are paid-only at source.',
        'Known upstream leak: some paid Meta traffic is mis-tagged in GA4 without a paid token (e.g. "ig / <campaign name>", "fb / Facebook_Mobile_Feed"), so lpViews is a slight undercount for meta.',
        slug === 'master'
          ? 'Master Quality Leads EXCLUDE the ASSET / RareOps umbrella: its Streak AI score is inflated, so counting it made master QL and CPQL read better than the account performs. qualityLeadsIncludingAsset keeps the old number, and the ASSET view itself shows its own QL.'
          : def?.aiScoreInflated
            ? 'AI score inflated for ASSET: this umbrella\'s QL is not comparable with the rest of the account, and master QL deliberately excludes it.'
            : null,
        `Bookings are month-granular at source (bookings_api.booking_date = YYYY-MM), so the bookings step covers whole months ${bookingsFromM}…${bookingsToM}${bookingsAligned ? ' — WIDER than the spend window, which starts/ends mid-month' : ''}. Bookings and revenue are the only steps NOT clipped to source coverage: bookings_api has full history back to 2025-10.`,
        !bookingsMonthsMatchWindow
          ? `efficiency.costPerBooking and efficiency.roas are null on purpose: the bookings months (${bookingsFromM}…${bookingsToM}) are wider than the months the spend window covers (${effFrom.slice(0, 7)}…${effTo.slice(0, 7)}), so a ratio between them would divide full-history revenue by part-history spend. Use steps.bookings.bookingsCohort for a date-exact revenue figure.`
          : null,
        'bookingsCohort counts the same bookings by inquiry_date instead, so it lines up date-exactly with spend and leads. inquiry_date is empty on part of the feed, so the cohort is a floor, not a total.',
        'Revenue = RVC, which is already the Goolets commission — it is never multiplied by a margin.',
        'Leads and QL come from Streak (SSOT), never from FB pixel counts.',
        `bookings_api currently ends ${bookings.coverage.max || 'n/a'} — months after that are null (not synced yet), never 0.`,
        `streak_sync starts ${streak.coverage.min || 'n/a'}: there are no lead or QL numbers before that date, at all.`,
        'attribution.unattributed is the GLOBAL remainder: Streak leads in range that match none of the umbrellas (empty utm_content, bare "Facebook", "ig / instagram_stories", raw ids). It is the same figure on every view (channel-filtered when a channel is set).',
        'campaignMembership.umbrellas: 14 mutually-exclusive umbrellas resolved by EXACT platform campaign name first, then the fallback regexes in an explicit order. umbrellas + unattributed = master for spend, leads, bookings and revenue (for QL use qualityLeadsIncludingAsset — the master QL step excludes ASSET by design). nonKpi umbrellas (boost, youtube, matchmaker) are inside master totals but flagged so the frontend can drop them from CPL/CPQL comparisons.',
        `campaignMembership.unattributed.members lists platform campaigns whose spend lands in no umbrella — it must be empty, and unattributed.spend must be 0. Currently ${orphanSpend.size} such campaign(s).`,
        slug === 'master'
          ? `campaignSummary[].campaigns lists the EXACT platform campaign names under each umbrella (same strings as fb_ads_api / daily_api / the Acq Channel sheet). Sub-rows always sum back to the umbrella totals; whatever cannot be pinned to one real campaign sits in "${UNASSIGNED}" rather than being guessed onto one.`
          : null,
        splitOn
          ? 'steps[].channels: meta + google = the step total on every step, lpViews included (it is paid-only now). The "other" entry carries organic LP views for reference with share:null, and is notApplicable:true on every other step — impressions/clicks have no organic concept, leads/ql/bookings feeds are paid-only at source.'
          : 'steps[].channels is omitted on a ?channel= view: the whole view is already that one channel.',
        `Targets are read from ${TARGETS_SOURCE}; targets is null until values are filled in there.`,
        def?.lpNote,
      ].filter(Boolean),
    },
    campaigns: CAMPAIGNS.map((c) => ({
      slug: c.slug,
      name: c.name,
      nonKpi: !!c.nonKpi,
      aiScoreInflated: !!c.aiScoreInflated,
    })),
    steps,
    efficiency,
    targets: targetsFor(slug),
    retention: { available: false, note: 'source in progress (Aymen)' },
    attribution: {
      unattributedLeads,
      unattributedShare: totalLeads > 0 ? unattributedLeads / totalLeads : 0,
    },
    campaignMembership,
    campaignSummary,
  }
}
