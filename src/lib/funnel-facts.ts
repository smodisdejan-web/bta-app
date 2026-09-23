// src/lib/funnel-facts.ts
//
// Builds the FACTS BLOCK handed to the model by POST /api/insights/funnel-ask.
//
// Rules that must never be relaxed:
//   1. Numbers stay numbers. Nothing is stringified, rounded into a label, or prefixed with €.
//   2. null stays null. A missing value is NEVER a 0 — "we could not measure it" and
//      "it measured zero" are different answers and the model must be able to tell them apart.
//   3. Everything is scoped to the SAME window / umbrella / channel the portal is looking at.
//      The ads table is the one place that cannot honour that exactly: Meta's dumps are ad ×
//      MONTH aggregates, so a range that clips a month gets the whole month and coverage.ads
//      says which months were partial, incomplete or missing outright.
//
// Three sources, three attribution models — that is deliberate, and the glossary
// (src/lib/knowledge/funnel-glossary.md) tells the model why the totals may not tie:
//   funnel  GA4 paid sessions + Streak leads + bookings_api          (lib/business-funnel.ts)
//   lps     HubSpot first_url → Streak AI score → bookings by month  (lib/lp-attribution.ts)
//   ads     fb-ads-monthly.json + the per-ad QL join                 (lib/fb-ads-monthly.ts)
//
// APPS SCRIPT LOAD. The per-tab cache used to live here; it now lives in lib/sheetsData.ts
// (fetchTabJson) so EVERY route shares one request per tab, not just this file. What stays here
// is the whole-result cache, keyed by the scope of the question, which is what makes a second
// question about the same window/umbrella/channel cost zero sheet fetches at all.
//
// TURKEY. Turkey rows are stripped from the facts before the model ever sees them, unless the
// selected umbrella IS Turkey or the question asked about it. The system prompt used to carry
// that as a rule and the model obeyed it by writing "Turkish LPs are excluded from the
// comparison" — which names Turkey just as loudly as ranking it would. A rule the model has to
// remember is not a rule; removing the rows is.

import {
  loadBusinessFunnel,
  CAMPAIGNS,
  adSlug,
  type Channel,
  type FunnelResponse,
  type FunnelStep,
  type FunnelTargets,
  type CampaignSubRow,
  type UmbrellaMember,
} from '@/lib/business-funnel'
import {
  fetchSheet,
  fetchHubspotContacts,
  fetchGA4LandingPages,
  fetchBookings,
  fetchStreakSync,
  type StreakLeadRow,
} from '@/lib/sheetsData'
import {
  joinHubspotStreak,
  filterByDateRange,
  isAttributableLP,
  aggregateByLP,
  aggregateGA4ByLP,
  buildEmailToLpMap,
  filterBookingsByBookingMonth,
  aggregateBookingsByLp,
  UNATTRIBUTED_LP,
  type LpBookingBucket,
} from '@/lib/lp-attribution'
import { fetchStreakLeadsUnion } from '@/lib/streak-leads'
import {
  getAdTableWithQl,
  getMonthEntry,
  BUILT_AT as ADS_BUILT_AT,
  AVAILABLE_MONTHS as AD_MONTHS,
  type AdWithQl,
  type AdTableQlCoverage,
} from '@/lib/fb-ads-monthly'
import type { AdQlUnmatchedSource } from '@/lib/ad-ql-join'

const MAX_UMBRELLAS = 15
const MAX_SUBROWS = 8
const MAX_MEMBERS = 8
const MAX_LPS = 20
const MAX_ADS = 25
/** An ad below this QL count cannot carry a CPQL ranking — too few leads to mean anything. */
export const MIN_QL_FOR_CPQL = 5
/** Trailing days of MTD lag that are a footnote rather than a data gap. */
export const TRAILING_LAG_DAYS = 3

export interface FunnelFactsInput {
  start: string
  end: string
  campaign?: string
  channel?: Channel
  /**
   * Keep Turkey rows in the facts. Only true when the selected umbrella IS Turkey or the
   * question asked about it; otherwise every Turkey row is removed before the model sees it,
   * so it cannot name one, rank one, or announce that it left one out.
   */
  includeTurkey?: boolean
}

const TURKEY_SLUG = 'turkey'
/** Turkey by any of the names it actually appears under in LP paths, ads and placements. */
const TURKEY_RE = /turkey|turkish|tur[cč]|tosca|belgin|esma|onur|la[-_\s]*bella[-_\s]*vita/i

export interface LpFact {
  path: string
  leads: number
  matchedInStreak: number
  ql: number | null
  qlRate: number | null
  avgAiScore: number | null
  sessions: number | null
  cvr: number | null
  bookings: number | null
  revenue: number | null
  topChannel: string | null
  topForm: string | null
}

export interface AdFact {
  adId: string
  adName: string
  adsetName: string | null
  campaignName: string | null
  umbrella: string | null
  status: string | null
  months: string[]
  spend: number
  impressions: number
  ctr: number | null
  landingLeads: number | null
  cpl: number | null
  hookRate: number | null
  holdRate: number | null
  /** Streak Meta leads the utm → ad-name join placed on THIS ad. */
  leadsStreak: number
  ql: number
  cpql: number | null
  qualityRate: number | null
}

export interface LpsCoverage {
  /** false = the GA4 landing-page feed could not be read, so every sessions/cvr is null. */
  sessionsAvailable: boolean
  note: string | null
  /**
   * Booking → landing page join coverage for the window (bookings by booking month). A booking is
   * credited by the booking sheet's landing_page first, else by its booker's HubSpot first page
   * (email match); bookings with neither sit in no LP row, so a 0 on a row means "none matched",
   * not "none booked". null = LP table failed to load.
   */
  bookingAttribution: LpBookingCoverage | null
  /** Plain-language version of bookingAttribution for the model. */
  lpBookingCoverage: string | null
}

export interface LpBookingCoverage {
  bookings: number
  revenue: number
  attributedBookings: number
  attributedRevenue: number
  unattributedBookings: number
  unattributedRevenue: number
  /** attributedRevenue / revenue, 0..1; null when there is no revenue in the window. */
  revenueShare: number | null
  /** How the attributed bookings were credited: booking-sheet landing_page vs email → HubSpot. */
  viaLandingBookings: number
  viaLandingRevenue: number
  viaEmailBookings: number
  viaEmailRevenue: number
}

export interface AdsCoverage {
  granularity: 'month'
  monthsUsed: string[]
  partialMonths: string[]
  incompleteMonths: string[]
  missingMonths: string[]
  uncoveredDays: number
  /** Last day of the requested range that the ad dumps actually reach. null when none do. */
  lastCoveredDate: string | null
  note: string
}

export interface AdQlJoinCoverage {
  status: 'partial' | 'unavailable'
  matchedShare: number | null
  matchedLeads: number | null
  fbLeadsInWindow: number | null
  /** Where the unplaced Meta leads sit. Never spread across ads — listed, or not counted. */
  unmatchedBySource: AdQlUnmatchedSource[]
}

export interface FunnelFactsCoverage {
  window: {
    start: string
    end: string
    campaign: string
    campaignName: string
    channel: Channel
  }
  ads: AdsCoverage
  adQlJoin: AdQlJoinCoverage
  lps: LpsCoverage
  unattributedLeadsShare: number | null
}

export interface FunnelFacts {
  funnel: {
    steps: FunnelStep[]
    efficiency: FunnelResponse['efficiency']
    targets: FunnelTargets | null
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
          campaignsTruncated: number
        }[]
      | null
    campaignsTruncated: number
    campaignMembership: {
      selected: string
      /** Only on umbrella views: the platform campaigns inside the selected umbrella. */
      members?: UmbrellaMember[]
      membersTruncated?: number
      unattributed: FunnelResponse['campaignMembership']['unattributed']
    }
  }
  lps: LpFact[]
  ads: AdFact[]
  coverage: FunnelFactsCoverage
}

const nOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** 0 is a real measurement here; only undefined/NaN become null. */
const numOr = (v: unknown, fallback: number | null): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

// ─── Caches ─────────────────────────────────────────────────────────────────
// Both are per-lambda-instance, like the one inside business-funnel.ts. They cut Apps Script
// calls, they are not a correctness mechanism: a cold instance simply fetches again.

const TTL_MS = 10 * 60 * 1000

interface Cache<T> {
  (key: string, fn: () => Promise<T>): Promise<T>
  /** Is there a live entry for this key? Used to report warm-up hits, never to skip work. */
  has(key: string): boolean
}

function makeCache<T>(): Cache<T> {
  const memo = new Map<string, { at: number; data: T }>()
  const inflight = new Map<string, Promise<T>>()
  const get = (key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = memo.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data)
    const running = inflight.get(key)
    if (running) return running
    const p = fn()
      .then((data) => {
        memo.set(key, { at: Date.now(), data })
        inflight.delete(key)
        return data
      })
      .catch((e) => {
        inflight.delete(key)
        // Serve stale rather than fail the whole answer on one flaky Apps Script call.
        if (hit) {
          console.warn('[funnel-facts] %s failed, serving stale: %s', key, (e as Error).message)
          return hit.data
        }
        throw e
      })
    inflight.set(key, p)
    return p
  }
  const cache = get as Cache<T>
  cache.has = (key: string) => {
    const hit = memo.get(key)
    return Boolean(hit && Date.now() - hit.at < TTL_MS)
  }
  return cache
}

const cachedFacts = makeCache<FunnelFacts>()

/**
 * The sheet reader the LP pipeline and fetchStreakLeadsUnion share. The de-duplication now
 * happens one level down, inside lib/sheetsData.ts, so this is a plain adapter — and every
 * other route gets the same single-request-per-tab benefit rather than only this one.
 */
const fetchSheetShared = (args: { sheetUrl: string; tab: string }): Promise<any[][]> =>
  fetchSheet({ sheetUrl: args.sheetUrl, tab: args.tab })

export async function buildFunnelFacts(input: FunnelFactsInput): Promise<FunnelFacts> {
  const start = input.start
  const end = input.end
  const slug = input.campaign && input.campaign !== 'master' ? input.campaign : 'master'
  const channel: Channel = input.channel || 'all'
  if (slug !== 'master' && !CAMPAIGNS.some((c) => c.slug === slug)) {
    throw new Error(`Unknown campaign "${slug}"`)
  }
  // The umbrella's OWN view always keeps its rows — asking about Turkey is asking about Turkey.
  const keepTurkey = Boolean(input.includeTurkey) || slug === TURKEY_SLUG
  return cachedFacts(factsKey(start, end, slug, channel, keepTurkey), () =>
    assembleFunnelFacts(start, end, slug, channel, keepTurkey)
  )
}

const factsKey = (start: string, end: string, slug: string, channel: Channel, keepTurkey: boolean) =>
  `${start}|${end}|${slug}|${channel}|${keepTurkey ? 'tk' : 'no-tk'}`

/**
 * Is this scope already assembled and still live? The pre-warm path reports it so the portal
 * (and the logs) can tell a real warm-up from a no-op. It never changes what gets built.
 */
export function isFunnelFactsCached(input: FunnelFactsInput): boolean {
  const slug = input.campaign && input.campaign !== 'master' ? input.campaign : 'master'
  const channel: Channel = input.channel || 'all'
  const keepTurkey = Boolean(input.includeTurkey) || slug === TURKEY_SLUG
  return cachedFacts.has(factsKey(input.start, input.end, slug, channel, keepTurkey))
}

const isTurkeyText = (...parts: (string | null | undefined)[]): boolean =>
  parts.some((v) => (v ? TURKEY_RE.test(v) : false))

async function assembleFunnelFacts(
  start: string,
  end: string,
  slug: string,
  channel: Channel,
  keepTurkey: boolean
): Promise<FunnelFacts> {
  const def = slug === 'master' ? null : CAMPAIGNS.find((c) => c.slug === slug) || null

  // Ads are Meta-only: a Google / Bing / ChatGPT view has no ad rows at all, and an empty
  // array says that honestly rather than showing Meta ads under a Google heading.
  const wantAds = channel === 'all' || channel === 'meta'

  const [funnel, lpResult, adResult] = await Promise.all([
    loadBusinessFunnel({ start, end, campaign: slug, channel }),
    loadLpFacts(start, end, def?.lp ?? null, keepTurkey).catch((err) => {
      console.warn('[funnel-facts] LP table unavailable:', err)
      return { rows: [] as LpFact[], sessionsAvailable: false, bookingCoverage: null }
    }),
    wantAds
      ? loadAdFacts(start, end, slug, keepTurkey).catch((err) => {
          console.warn('[funnel-facts] ad table unavailable:', err)
          return null
        })
      : Promise.resolve(null),
  ])

  const dropTurkey = !keepTurkey
  const fullSummary = (funnel.campaignSummary || null)?.filter(
    (u) => !dropTurkey || (u.slug !== TURKEY_SLUG && !isTurkeyText(u.name))
  ) ?? null
  const campaignSummary = fullSummary
    ? fullSummary.slice(0, MAX_UMBRELLAS).map((u) => ({
        slug: u.slug,
        name: u.name,
        spend: u.spend,
        leads: u.leads,
        ql: u.ql,
        bookings: u.bookings,
        revenue: u.revenue,
        campaigns: subRows(u.campaigns, dropTurkey).slice(0, MAX_SUBROWS),
        campaignsTruncated: Math.max(0, subRows(u.campaigns, dropTurkey).length - MAX_SUBROWS),
      }))
    : null

  // campaignSummary is null on umbrella views by design, so without this an umbrella answer
  // has no platform campaign it is allowed to name. These are the same rows the portal's
  // membership panel shows.
  const selectedUmbrella =
    slug === 'master'
      ? null
      : funnel.campaignMembership.umbrellas.find((u) => u.key === slug) ||
        funnel.campaignMembership.umbrellas[0] ||
        null
  const allMembers = (selectedUmbrella?.members ?? []).filter(
    (m) => !dropTurkey || !isTurkeyText(m.name)
  )

  return {
    funnel: {
      steps: funnel.steps,
      efficiency: funnel.efficiency,
      targets: funnel.targets,
      campaignSummary,
      campaignsTruncated: fullSummary ? Math.max(0, fullSummary.length - MAX_UMBRELLAS) : 0,
      campaignMembership: {
        selected: funnel.campaignMembership.selected,
        ...(selectedUmbrella
          ? {
              members: allMembers.slice(0, MAX_MEMBERS),
              membersTruncated: Math.max(0, allMembers.length - MAX_MEMBERS),
            }
          : {}),
        unattributed: funnel.campaignMembership.unattributed,
      },
    },
    lps: lpResult.rows,
    ads: adResult?.ads ?? [],
    coverage: {
      window: {
        start,
        end,
        campaign: slug,
        campaignName: def?.name ?? 'Master (all umbrellas)',
        channel,
      },
      ads: adsCoverage(adResult?.coverage ?? null, channel, end),
      adQlJoin: adQlCoverage(adResult?.coverage ?? null, dropTurkey),
      lps: {
        sessionsAvailable: lpResult.sessionsAvailable,
        note: lpResult.sessionsAvailable
          ? null
          : 'The GA4 landing-page feed could not be read for this window, so session counts and page conversion rates are unavailable on every landing page row. Lead, quality-lead and booking figures are unaffected.',
        bookingAttribution: lpResult.bookingCoverage,
        lpBookingCoverage: lpBookingCoverageNote(lpResult.bookingCoverage),
      },
      unattributedLeadsShare: nOrNull(funnel.attribution?.unattributedShare),
    },
  }
}

/** Platform campaign sub-rows, minus Turkey when Turkey is being kept out of the facts. */
function subRows(rows: CampaignSubRow[] | undefined, dropTurkey: boolean): CampaignSubRow[] {
  const list = rows || []
  return dropTurkey ? list.filter((c) => !isTurkeyText(c.name)) : list
}

// ─── Coverage ───────────────────────────────────────────────────────────────

/** Last day of the range the ad dumps actually reach (their `until`, clipped to the range). */
function lastCoveredDateOf(monthsUsed: string[], end: string): string | null {
  let best: string | null = null
  for (const m of monthsUsed) {
    const until = getMonthEntry(m)?.window.until
    if (!until) continue
    const clipped = until < end ? until : end
    if (!best || clipped > best) best = clipped
  }
  return best
}

function adsCoverage(cov: AdTableQlCoverage | null, channel: Channel, end: string): AdsCoverage {
  if (!cov) {
    return {
      granularity: 'month',
      monthsUsed: [],
      partialMonths: [],
      incompleteMonths: [],
      missingMonths: [],
      uncoveredDays: 0,
      lastCoveredDate: null,
      note:
        channel === 'all' || channel === 'meta'
          ? 'The ad table could not be loaded for this request.'
          : `Ad rows are Meta only, and this is a ${channel} view, so there are none.`,
    }
  }

  const parts: string[] = [
    'Ad metrics are MONTH-granular: Meta reports each ad per month, never per day, so a range that starts or ends mid-month is answered with the WHOLE of that month. Rankings hold, absolute ad numbers are the month total, not the range total.',
  ]
  if (cov.monthsUsed.length) parts.push(`Months used: ${cov.monthsUsed.join(', ')}.`)
  if (cov.partialMonths.length) {
    parts.push(
      `Clipped by the range and therefore OVERSTATED against it: ${cov.partialMonths.join(', ')}.`
    )
  }
  if (cov.incompleteMonths.length) {
    parts.push(
      `The dump itself does not cover the whole calendar month, so these UNDERSTATE it: ${cov.incompleteMonths.join(', ')}.`
    )
  }
  if (cov.missingMonths.length) {
    parts.push(
      `No ad-level data at all for ${cov.missingMonths.join(', ')} — that spend and those leads are absent from the ad table entirely.`
    )
  }
  const lastCovered = lastCoveredDateOf(cov.monthsUsed, end)
  if (cov.uncoveredDays > 0) {
    // 1-3 trailing days is the normal MTD lag: the dump is rebuilt overnight, so "this month"
    // always runs a day or two ahead of it. That is a footnote, not a reason to refuse a
    // ranking — only a real hole (a missing month, or a longer gap) is.
    if (cov.uncoveredDays <= TRAILING_LAG_DAYS && !cov.missingMonths.length) {
      parts.push(
        `Ad metrics run through ${lastCovered ?? 'the last dumped day'}; the last ${cov.uncoveredDays} day(s) of the range are not in the dump yet. This is the normal daily lag, not a gap in the data.`
      )
    } else {
      parts.push(`${cov.uncoveredDays} day(s) of the range are covered by no ad dump.`)
    }
  }
  const gaps: string[] = []
  if (cov.metricGaps.linkClicks.length) gaps.push(`link clicks (${cov.metricGaps.linkClicks.join(', ')})`)
  if (cov.metricGaps.lpViews.length) gaps.push(`LP views (${cov.metricGaps.lpViews.join(', ')})`)
  if (gaps.length) parts.push(`Metrics a contributing month cannot supply: ${gaps.join('; ')}.`)
  parts.push(`Ad data available for ${AD_MONTHS.join(', ')}; built ${ADS_BUILT_AT}.`)

  return {
    granularity: 'month',
    monthsUsed: cov.monthsUsed,
    partialMonths: cov.partialMonths,
    incompleteMonths: cov.incompleteMonths,
    missingMonths: cov.missingMonths,
    uncoveredDays: cov.uncoveredDays,
    lastCoveredDate: lastCovered,
    note: parts.join(' '),
  }
}

function adQlCoverage(cov: AdTableQlCoverage | null, dropTurkey: boolean): AdQlJoinCoverage {
  if (!cov) {
    return {
      status: 'unavailable',
      matchedShare: null,
      matchedLeads: null,
      fbLeadsInWindow: null,
      unmatchedBySource: [],
    }
  }
  return {
    status: 'partial',
    matchedShare: nOrNull(cov.matchedShare),
    matchedLeads: nOrNull(cov.matchedLeads),
    fbLeadsInWindow: nOrNull(cov.fbLeadsInWindow),
    // The worklist is placement STRINGS, and Turkey's placements say so in plain text
    // (tosca_…, belgin-sultan_…) — filtering the ad rows but not this list still leaks it.
    unmatchedBySource: cov.unmatchedBySource
      .filter((u) => !dropTurkey || !isTurkeyText(u.source))
      .slice(0, 10),
  }
}

// ─── LP table ───────────────────────────────────────────────────────────────
// Same pipeline as GET /api/lp-funnel, then narrowed to the umbrella's landing paths
// (CampaignDef.lp) and cut to the top 20 by leads. Master keeps every attributable path.

async function loadLpFacts(
  start: string,
  end: string,
  lpRegex: RegExp | null,
  keepTurkey: boolean
): Promise<{ rows: LpFact[]; sessionsAvailable: boolean; bookingCoverage: LpBookingCoverage | null }> {
  const fromISO = new Date(`${start}T00:00:00.000Z`).toISOString()
  const toISO = new Date(`${end}T23:59:59.999Z`).toISOString()

  const [hsContacts, streakLeads, ga4Rows, bookings] = await Promise.all([
    fetchHubspotContacts(fetchSheetShared),
    fetchStreakSync(fetchSheetShared),
    fetchGA4LandingPages(fetchSheetShared),
    fetchBookings(fetchSheetShared),
  ])

  const joined = joinHubspotStreak(hsContacts, streakLeads)
  const attributable = filterByDateRange(joined, fromISO, toISO).filter((l) =>
    isAttributableLP(l.first_url_path)
  )

  const ga4Map = aggregateGA4ByLP(ga4Rows, fromISO, toISO)
  const emailToLp = buildEmailToLpMap(joined)
  const bookingsByLp = aggregateBookingsByLp(
    filterBookingsByBookingMonth(bookings, fromISO, toISO),
    emailToLp
  )
  const aggregates = aggregateByLP(attributable, ga4Map, bookingsByLp)
  const bookingCoverage = computeBookingCoverage(bookingsByLp, keepTurkey)

  // ga4_landing_pages is the slowest tab in the set (~24 s) and fetchTab answers a failure with
  // an empty sheet rather than an error. Empty map + rows that have leads = the GA4 read failed,
  // and every sessions/cvr below is a null caused by that, not by the pages having no traffic.
  // Saying so once beats twenty rows of unexplained "n/a".
  const sessionsAvailable = ga4Map.size > 0
  if (!sessionsAvailable) {
    console.warn(
      '[funnel-facts] ga4_landing_pages returned no rows for %s..%s — sessions/cvr unavailable',
      start,
      end
    )
  }

  const rows = aggregates
    .filter((a) => (lpRegex ? lpRegex.test(a.path) : true))
    .filter((a) => keepTurkey || !isTurkeyText(a.path))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, MAX_LPS)
    .map((a) => ({
      path: a.path,
      leads: a.leads,
      matchedInStreak: a.matched_in_streak,
      // QL / AI score only mean something over the Streak-matched subset.
      ql: a.matched_in_streak > 0 ? numOr(a.ql, null) : null,
      qlRate: a.matched_in_streak > 0 ? numOr(a.ql_rate, null) : null,
      avgAiScore: a.matched_in_streak > 0 ? numOr(a.avg_ai_score, null) : null,
      sessions: numOr(a.sessions, null),
      cvr: numOr(a.cvr, null),
      bookings: numOr(a.bookings, null),
      revenue: numOr(a.revenue, null),
      topChannel: strOrNull(a.top_channel),
      topForm: strOrNull(a.top_form),
    }))

  return { rows, sessionsAvailable, bookingCoverage }
}

/**
 * Window-wide booking → LP coverage. Attributed = every booking credited to a real LP path;
 * unattributed = the UNATTRIBUTED_LP bucket. Turkey-credited bookings leave both sides when
 * Turkey is filtered out, like every other Turkey row.
 */
function computeBookingCoverage(
  bookingsByLp: Map<string, LpBookingBucket>,
  keepTurkey: boolean
): LpBookingCoverage {
  let bookings = 0
  let revenue = 0
  let attributedBookings = 0
  let attributedRevenue = 0
  let viaLandingBookings = 0
  let viaLandingRevenue = 0
  let viaEmailBookings = 0
  let viaEmailRevenue = 0
  for (const [path, v] of bookingsByLp) {
    if (!keepTurkey && isTurkeyText(path)) continue
    bookings += v.count
    revenue += v.revenue
    if (path !== UNATTRIBUTED_LP) {
      attributedBookings += v.count
      attributedRevenue += v.revenue
    }
    viaLandingBookings += v.viaLanding
    viaLandingRevenue += v.viaLandingRevenue
    viaEmailBookings += v.viaEmail
    viaEmailRevenue += v.viaEmailRevenue
  }
  return {
    viaLandingBookings,
    viaLandingRevenue: Math.round(viaLandingRevenue),
    viaEmailBookings,
    viaEmailRevenue: Math.round(viaEmailRevenue),
    bookings,
    revenue: Math.round(revenue),
    attributedBookings,
    attributedRevenue: Math.round(attributedRevenue),
    unattributedBookings: bookings - attributedBookings,
    unattributedRevenue: Math.round(revenue - attributedRevenue),
    revenueShare: revenue > 0 ? Math.round((attributedRevenue / revenue) * 1000) / 1000 : null,
  }
}

function eurK(n: number): string {
  return n >= 1000 ? `€${Math.round(n / 1000)}k` : `€${Math.round(n)}`
}

function lpBookingCoverageNote(c: LpBookingCoverage | null): string | null {
  if (!c || c.bookings === 0) return null
  const pct = c.revenueShare === null ? 'n/a' : `${Math.round(c.revenueShare * 100)}%`
  return (
    `Landing page booking attribution covers ${c.attributedBookings} of ${c.bookings} bookings ` +
    `(${pct} of revenue, ${eurK(c.attributedRevenue)} of ${eurK(c.revenue)}): ` +
    `${c.viaLandingBookings} credited from the landing page recorded in the booking sheet (${eurK(c.viaLandingRevenue)}), ` +
    `${c.viaEmailBookings} by matching the booker's email to their first HubSpot landing page (${eurK(c.viaEmailRevenue)}). ` +
    `Landing pages on other domains appear as "domain/path" rows (e.g. croatialuxurygulet.com/…) and have no lead data. ` +
    `The other ${c.unattributedBookings} bookings (${eurK(c.unattributedRevenue)}) could not be matched to any landing page. ` +
    `A landing page showing 0 bookings is NOT a page with zero bookings; say "no bookings matched to this page", never "no revenue booked".`
  )
}

// ─── Ads table ──────────────────────────────────────────────────────────────

async function loadAdFacts(
  start: string,
  end: string,
  slug: string,
  keepTurkey: boolean
): Promise<{ ads: AdFact[]; coverage: AdTableQlCoverage }> {
  // streak_full ∪ streak_sync, through the shared tab cache — streak_sync is already in it
  // from the LP step, so this costs one extra Apps Script call (streak_full), not two.
  const streakRows: StreakLeadRow[] = await fetchStreakLeadsUnion(fetchSheetShared)

  // The join always sees every campaign (see fb-ads-monthly.ts); the filter narrows the OUTPUT.
  // adSlug() is the same resolver the funnel uses, so an ad lands in the umbrella its spend does.
  const { ads, coverage } = getAdTableWithQl({
    start,
    end,
    streakRows,
    ...(slug === 'master'
      ? {}
      : { matchCampaign: (name: string) => (adSlug('meta', name) === slug ? slug : null) }),
  })

  // Filter BEFORE the top-25 cut, so removing Turkey frees the slots for rows the answer can
  // actually use instead of silently shrinking the table.
  const visible = keepTurkey
    ? ads
    : ads.filter(
        (a) => adSlug('meta', a.campaign) !== TURKEY_SLUG && !isTurkeyText(a.campaign, a.adName, a.adset)
      )

  return { ads: selectAds(visible).map(toAdFact), coverage }
}

/**
 * Top 25 by spend, PLUS every ad carrying at least MIN_QL_FOR_CPQL quality leads that the spend
 * cut would have dropped. A cheap creative that quietly produces the best quality leads is
 * exactly the row Dejan is looking for, and a spend-only cut is how it stays invisible.
 */
function selectAds(ads: AdWithQl[]): AdWithQl[] {
  const bySpend = [...ads].sort((a, b) => b.spend - a.spend)
  const top = bySpend.slice(0, MAX_ADS)
  const chosen = new Set(top.map((a) => a.adId))
  const extra = bySpend.slice(MAX_ADS).filter((a) => a.ql >= MIN_QL_FOR_CPQL && !chosen.has(a.adId))
  return top.concat(extra)
}

function toAdFact(a: AdWithQl): AdFact {
  return {
    adId: a.adId,
    adName: a.adName,
    adsetName: strOrNull(a.adsetName),
    campaignName: strOrNull(a.campaignName),
    umbrella: adSlug('meta', a.campaign),
    status: strOrNull(a.status),
    months: a.months,
    spend: a.spend,
    impressions: a.impressions,
    ctr: nOrNull(a.ctr),
    landingLeads: nOrNull(a.landingLeads),
    cpl: nOrNull(a.cpl),
    hookRate: nOrNull(a.hookRate),
    holdRate: nOrNull(a.holdRate),
    leadsStreak: a.leadsStreak,
    ql: a.ql,
    cpql: nOrNull(a.cpql),
    qualityRate: nOrNull(a.qualityRate),
  }
}
