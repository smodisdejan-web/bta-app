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
// APPS SCRIPT LOAD. Every tab this file needs goes through ONE module-level tab cache with a
// 10-minute TTL and in-flight de-duplication, so the LP pipeline and the ad step share the
// single streak_sync read instead of racing each other for an Apps Script slot. On top of that
// the whole assembled result is cached per (start, end, campaign, channel), which is what makes
// a second question about the same scope cost zero sheet fetches.

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
  fetchTab,
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
} from '@/lib/lp-attribution'
import { fetchStreakLeadsUnion } from '@/lib/streak-leads'
import {
  getAdTableWithQl,
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

export interface FunnelFactsInput {
  start: string
  end: string
  campaign?: string
  channel?: Channel
}

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

export interface AdsCoverage {
  granularity: 'month'
  monthsUsed: string[]
  partialMonths: string[]
  incompleteMonths: string[]
  missingMonths: string[]
  uncoveredDays: number
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

function makeCache<T>() {
  const memo = new Map<string, { at: number; data: T }>()
  const inflight = new Map<string, Promise<T>>()
  return (key: string, fn: () => Promise<T>): Promise<T> => {
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
}

const cachedTab = makeCache<any[][]>()
const cachedFacts = makeCache<FunnelFacts>()

/**
 * The ONE sheet reader everything below shares. The LP pipeline and fetchStreakLeadsUnion both
 * ask for streak_sync; with this in between, the Apps Script sees a single request for it.
 */
const fetchSheetShared = (args: { sheetUrl: string; tab: string }): Promise<any[][]> =>
  cachedTab(`tab:${args.tab}`, async () => {
    const res = await fetchTab(args.tab, args.sheetUrl)
    return [res.headers, ...res.rows]
  })

export async function buildFunnelFacts(input: FunnelFactsInput): Promise<FunnelFacts> {
  const start = input.start
  const end = input.end
  const slug = input.campaign && input.campaign !== 'master' ? input.campaign : 'master'
  const channel: Channel = input.channel || 'all'
  if (slug !== 'master' && !CAMPAIGNS.some((c) => c.slug === slug)) {
    throw new Error(`Unknown campaign "${slug}"`)
  }
  return cachedFacts(`${start}|${end}|${slug}|${channel}`, () =>
    assembleFunnelFacts(start, end, slug, channel)
  )
}

async function assembleFunnelFacts(
  start: string,
  end: string,
  slug: string,
  channel: Channel
): Promise<FunnelFacts> {
  const def = slug === 'master' ? null : CAMPAIGNS.find((c) => c.slug === slug) || null

  // Ads are Meta-only: a Google / Bing / ChatGPT view has no ad rows at all, and an empty
  // array says that honestly rather than showing Meta ads under a Google heading.
  const wantAds = channel === 'all' || channel === 'meta'

  const [funnel, lps, adResult] = await Promise.all([
    loadBusinessFunnel({ start, end, campaign: slug, channel }),
    loadLpFacts(start, end, def?.lp ?? null).catch((err) => {
      console.warn('[funnel-facts] LP table unavailable:', err)
      return [] as LpFact[]
    }),
    wantAds
      ? loadAdFacts(start, end, slug).catch((err) => {
          console.warn('[funnel-facts] ad table unavailable:', err)
          return null
        })
      : Promise.resolve(null),
  ])

  const fullSummary = funnel.campaignSummary || null
  const campaignSummary = fullSummary
    ? fullSummary.slice(0, MAX_UMBRELLAS).map((u) => ({
        slug: u.slug,
        name: u.name,
        spend: u.spend,
        leads: u.leads,
        ql: u.ql,
        bookings: u.bookings,
        revenue: u.revenue,
        campaigns: (u.campaigns || []).slice(0, MAX_SUBROWS),
        campaignsTruncated: Math.max(0, (u.campaigns || []).length - MAX_SUBROWS),
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
  const allMembers = selectedUmbrella?.members ?? []

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
    lps,
    ads: adResult?.ads ?? [],
    coverage: {
      window: {
        start,
        end,
        campaign: slug,
        campaignName: def?.name ?? 'Master (all umbrellas)',
        channel,
      },
      ads: adsCoverage(adResult?.coverage ?? null, channel),
      adQlJoin: adQlCoverage(adResult?.coverage ?? null),
      unattributedLeadsShare: nOrNull(funnel.attribution?.unattributedShare),
    },
  }
}

// ─── Coverage ───────────────────────────────────────────────────────────────

function adsCoverage(cov: AdTableQlCoverage | null, channel: Channel): AdsCoverage {
  if (!cov) {
    return {
      granularity: 'month',
      monthsUsed: [],
      partialMonths: [],
      incompleteMonths: [],
      missingMonths: [],
      uncoveredDays: 0,
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
  if (cov.uncoveredDays > 0) {
    parts.push(`${cov.uncoveredDays} day(s) of the range are covered by no ad dump.`)
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
    note: parts.join(' '),
  }
}

function adQlCoverage(cov: AdTableQlCoverage | null): AdQlJoinCoverage {
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
    unmatchedBySource: cov.unmatchedBySource.slice(0, 10),
  }
}

// ─── LP table ───────────────────────────────────────────────────────────────
// Same pipeline as GET /api/lp-funnel, then narrowed to the umbrella's landing paths
// (CampaignDef.lp) and cut to the top 20 by leads. Master keeps every attributable path.

async function loadLpFacts(start: string, end: string, lpRegex: RegExp | null): Promise<LpFact[]> {
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

  return aggregates
    .filter((a) => (lpRegex ? lpRegex.test(a.path) : true))
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
}

// ─── Ads table ──────────────────────────────────────────────────────────────

async function loadAdFacts(
  start: string,
  end: string,
  slug: string
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

  return { ads: selectAds(ads).map(toAdFact), coverage }
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
