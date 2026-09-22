// src/lib/fb-ads-monthly.ts
//
// MONTH-GRANULAR Meta ad table — the replacement for the `fb_ads_level` sheet tab.
//
// WHY
// `fb_ads_level` is a frozen June–July CSV snapshot (262 rows). Every range the user picks was
// answered with July's ads, and the per-ad QL join could only place ~43 % of September's Streak
// leads because September's ads are not in it. This module reads
// src/data/fb-ads-monthly.json (built by code/goolets/build-fb-ads-monthly.js from the Meta MCP
// dumps) and serves the ad rows of the months a range actually touches.
//
// THE GRANULARITY RULE, STATED ONCE
// The MCP dumps are ad × WINDOW aggregates, never ad × day. An ad's spend cannot be split inside
// its month. So a range of 2026-09-05 → 2026-09-12 returns the WHOLE of September's ad rows and
// marks September `partial`: the RANKING is usable, the absolute numbers are the month's, not the
// range's. Callers must surface `partialMonths`; nothing here pretends otherwise.
//
// Three different kinds of "not exact", kept apart on purpose:
//   partialMonths     the range clips the month → the month's numbers OVERSTATE the range.
//   incompleteMonths  the month's own dump does not cover the whole calendar month (July's
//                     100-ad cap, August stopping 08-30, September being month-to-date) →
//                     UNDERSTATES the calendar month.
//   missingMonths     a calendar month inside the range with no dump at all (2026-06) → its
//                     spend and its leads are simply absent, and coverage says so.

import { joinAdQl, type AdQlAd, type AdQlUnmatchedSource } from './ad-ql-join'
import { leadChannelOf, isQualityLead, streakLeadDay } from './streak-leads'
import type { StreakLeadRow } from './sheetsData'
import fbAdsMonthly from '../data/fb-ads-monthly.json'

/** One ad inside ONE month, exactly as the builder wrote it. */
export interface MonthlyAdRow {
  adId: string
  adName: string
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  creativeId: string | null
  status: string | null
  spend: number
  impressions: number
  reach: number | null
  frequency: number | null
  clicks: number | null
  /** null (not 0) when the dump predates the field — July's does for both of these. */
  linkClicks: number | null
  lpViews: number | null
  /** percent number as Meta reports it: 6.51 = 6.51 %, over ALL clicks. */
  ctr: number | null
  cpm: number | null
  /** pixel Landing Lead (goolets.net or CLG) — null when the ad optimised for something else. */
  landingLeads: number | null
  leadIndicator: string | null
  cpl: number | null
  videoPlays: number | null
  thruplays: number | null
  videoP100: number | null
  hookRate: number | null
  holdRate: number | null
  p100Rate: number | null
  isVideo: boolean
}

export interface MonthEntry {
  window: { since: string; until: string }
  source: string
  complete: boolean
  note: string | null
  adCount: number
  spend: number
  campaignSpend: number
  ads: MonthlyAdRow[]
}

export interface FbAdsMonthlyFile {
  builtAt: string
  months: Record<string, MonthEntry>
}

const FILE = fbAdsMonthly as unknown as FbAdsMonthlyFile

export const BUILT_AT: string = FILE.builtAt
/** Month keys present in the file, oldest first. */
export const AVAILABLE_MONTHS: string[] = Object.keys(FILE.months).sort()

export const getMonthEntry = (month: string): MonthEntry | null => FILE.months[month] || null

/** An aggregate of one ad over every month the range touched. */
export interface AggregatedAd extends AdQlAd {
  adId: string
  adName: string
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  creativeId: string | null
  status: string | null
  /** whatever `matchCampaign` returned, else campaignName — the grouping label for the UI. */
  campaignGroup: string
  /** AdQlAd compatibility: names as plain strings, never null. */
  adset: string
  campaign: string
  spend: number
  impressions: number
  /** single-month ranges only — reach across months cannot be de-duplicated, so it is null. */
  reach: number | null
  frequency: number | null
  clicks: number
  linkClicks: number | null
  lpViews: number | null
  ctr: number | null
  cpm: number | null
  landingLeads: number | null
  leadIndicator: string | null
  cpl: number | null
  videoPlays: number | null
  thruplays: number | null
  videoP100: number | null
  hookRate: number | null
  holdRate: number | null
  p100Rate: number | null
  isVideo: boolean
  /** the months that contributed to this row, oldest first. */
  months: string[]
}

export interface AdTableScope {
  monthsUsed: string[]
  partialMonths: string[]
  incompleteMonths: string[]
  missingMonths: string[]
  /**
   * Days of the requested range that NO month window covers — a missing month (2026-06), or the
   * tail of the current month the MTD dump has not reached yet (ask for 09-01..09-30 on the
   * 09-21 dump and this is 9). Spend and leads for those days are simply not in the table.
   */
  uncoveredDays: number
  /** metrics a contributing month could not supply at all (July has neither of these). */
  metricGaps: { linkClicks: string[]; lpViews: string[] }
}

export interface AdTableResult extends AdTableScope {
  ads: AggregatedAd[]
}

export interface AdTableArgs {
  /** YYYY-MM-DD, inclusive */
  start: string
  /** YYYY-MM-DD, inclusive */
  end: string
  /** keep only ads whose campaign slugifies to this (see campaignSlugOf). */
  campaignSlug?: string
  /**
   * keep only ads whose campaign this returns a label for; the label becomes `campaignGroup`,
   * which is how several campaign names fold into one line (e.g. every "Tosca …" → "Turkey").
   */
  matchCampaign?: (campaignName: string) => string | null
}

export const campaignSlugOf = (name: string | null | undefined): string =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const monthKeyOf = (iso: string): string => iso.slice(0, 7)

/** inclusive day count between two YYYY-MM-DD, 0 when the range is inverted */
function dayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0
  return Math.round((b - a) / 86400000) + 1
}

/** every calendar month key touched by [start, end], oldest first */
function monthKeysBetween(start: string, end: string): string[] {
  const out: string[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const endKey = monthKeyOf(end)
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key >= endKey) break
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/** Sum that stays null only when NOTHING could supply the metric. */
function addNullable(acc: number | null, v: number | null | undefined): number | null {
  if (v == null) return acc
  return (acc == null ? 0 : acc) + v
}

interface ScopedMonth {
  key: string
  entry: MonthEntry
  /** the part of the month's window that is inside the requested range */
  clip: { start: string; end: string }
  partial: boolean
}

/** Which months of the file a range touches, and how cleanly. */
export function scopeMonths(start: string, end: string): { months: ScopedMonth[] } & AdTableScope {
  const months: ScopedMonth[] = []
  const partialMonths: string[] = []
  const incompleteMonths: string[] = []
  const metricGaps: AdTableScope['metricGaps'] = { linkClicks: [], lpViews: [] }

  for (const key of AVAILABLE_MONTHS) {
    const entry = FILE.months[key]
    const { since, until } = entry.window
    if (until < start || since > end) continue // no overlap
    const clip = { start: since > start ? since : start, end: until < end ? until : end }
    // the range clips the month -> the month's aggregates overstate what the user asked for
    const partial = clip.start !== since || clip.end !== until
    if (partial) partialMonths.push(key)
    if (!entry.complete) incompleteMonths.push(key)
    if (entry.ads.every((a) => a.linkClicks == null)) metricGaps.linkClicks.push(key)
    if (entry.ads.every((a) => a.lpViews == null)) metricGaps.lpViews.push(key)
    months.push({ key, entry, clip, partial })
  }

  const have = new Set(months.map((m) => m.key))
  const missingMonths = monthKeysBetween(start, end).filter((k) => !have.has(k))
  // clips are disjoint (each lives inside its own month), so their days simply add up
  const coveredDays = months.reduce((s, m) => s + dayCount(m.clip.start, m.clip.end), 0)

  return {
    months,
    monthsUsed: months.map((m) => m.key),
    partialMonths,
    incompleteMonths,
    missingMonths,
    uncoveredDays: Math.max(0, dayCount(start, end) - coveredDays),
    metricGaps,
  }
}

function passesFilter(
  campaignName: string | null,
  campaignSlug?: string,
  matchCampaign?: (c: string) => string | null
): { keep: boolean; group: string } {
  const name = campaignName || ''
  if (matchCampaign) {
    const label = matchCampaign(name)
    return { keep: label != null, group: label ?? name }
  }
  if (campaignSlug) return { keep: campaignSlugOf(name) === campaignSlug, group: name }
  return { keep: true, group: name }
}

/** Fold one month's row into the running aggregate. Rates are RECOMPUTED, never averaged. */
function foldAd(acc: AggregatedAd | undefined, row: MonthlyAdRow, month: string, group: string): AggregatedAd {
  if (!acc) {
    return {
      adId: row.adId,
      adName: row.adName,
      adsetId: row.adsetId,
      adsetName: row.adsetName,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      creativeId: row.creativeId,
      status: row.status,
      campaignGroup: group,
      adset: row.adsetName || '',
      campaign: row.campaignName || '',
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      frequency: row.frequency,
      clicks: row.clicks || 0,
      linkClicks: row.linkClicks,
      lpViews: row.lpViews,
      ctr: row.ctr,
      cpm: row.cpm,
      landingLeads: row.landingLeads,
      leadIndicator: row.leadIndicator,
      cpl: row.cpl,
      videoPlays: row.videoPlays,
      thruplays: row.thruplays,
      videoP100: row.videoP100,
      hookRate: row.hookRate,
      holdRate: row.holdRate,
      p100Rate: row.p100Rate,
      isVideo: row.isVideo,
      months: [month],
    }
  }
  // Months arrive oldest-first, so the LAST one wins on the descriptive fields: an ad renamed or
  // moved between ad sets should read as what it is now.
  acc.adName = row.adName || acc.adName
  acc.adsetId = row.adsetId ?? acc.adsetId
  acc.adsetName = row.adsetName ?? acc.adsetName
  acc.campaignId = row.campaignId ?? acc.campaignId
  acc.campaignName = row.campaignName ?? acc.campaignName
  acc.creativeId = row.creativeId ?? acc.creativeId
  acc.status = row.status ?? acc.status
  acc.campaignGroup = group
  acc.adset = row.adsetName || acc.adset
  acc.campaign = row.campaignName || acc.campaign
  acc.spend = Math.round((acc.spend + row.spend) * 100) / 100
  acc.impressions += row.impressions
  acc.clicks += row.clicks || 0
  acc.linkClicks = addNullable(acc.linkClicks, row.linkClicks)
  acc.lpViews = addNullable(acc.lpViews, row.lpViews)
  acc.landingLeads = addNullable(acc.landingLeads, row.landingLeads)
  acc.videoPlays = addNullable(acc.videoPlays, row.videoPlays)
  acc.thruplays = addNullable(acc.thruplays, row.thruplays)
  acc.videoP100 = addNullable(acc.videoP100, row.videoP100)
  acc.leadIndicator = acc.leadIndicator || row.leadIndicator
  acc.isVideo = acc.isVideo || row.isVideo
  // Reach is de-duplicated people, so two months of it cannot be added. Frequency depends on it.
  acc.reach = null
  acc.frequency = null
  acc.months.push(month)
  return acc
}

/** Rates that only make sense once every month has been folded in. */
function finalizeAd(a: AggregatedAd): AggregatedAd {
  const r = (v: number | null, d: number) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d)
  if (a.months.length > 1) {
    a.ctr = a.impressions > 0 ? r((a.clicks / a.impressions) * 100, 4) : null
    a.cpm = a.impressions > 0 ? r((a.spend / a.impressions) * 1000, 2) : null
    a.hookRate = a.videoPlays && a.impressions ? r(a.videoPlays / a.impressions, 4) : null
    a.holdRate = a.thruplays && a.videoPlays ? r(a.thruplays / a.videoPlays, 4) : null
    a.p100Rate = a.videoP100 && a.videoPlays ? r(a.videoP100 / a.videoPlays, 4) : null
  }
  a.cpl = a.landingLeads && a.landingLeads > 0 ? r(a.spend / a.landingLeads, 2) : null
  return a
}

/**
 * The ad table for a range, at month granularity. Ads are aggregated across every month the
 * range touches; `partialMonths` / `missingMonths` say how far the answer is from the literal
 * range. Sorted by spend, highest first.
 */
export function getAdTable(args: AdTableArgs): AdTableResult {
  const { start, end, campaignSlug, matchCampaign } = args
  const scope = scopeMonths(start, end)

  const byAd = new Map<string, AggregatedAd>()
  for (const m of scope.months) {
    for (const row of m.entry.ads) {
      const { keep, group } = passesFilter(row.campaignName, campaignSlug, matchCampaign)
      if (!keep) continue
      byAd.set(row.adId, foldAd(byAd.get(row.adId), row, m.key, group))
    }
  }

  const ads = Array.from(byAd.values()).map(finalizeAd).sort((a, b) => b.spend - a.spend)

  return {
    ads,
    monthsUsed: scope.monthsUsed,
    partialMonths: scope.partialMonths,
    incompleteMonths: scope.incompleteMonths,
    missingMonths: scope.missingMonths,
    uncoveredDays: scope.uncoveredDays,
    metricGaps: scope.metricGaps,
  }
}

export interface AdWithQl extends AggregatedAd {
  /** Streak Meta leads (inside the clipped months) that resolved to THIS ad. */
  leadsStreak: number
  ql: number
  /** spend / ql — null when ql is 0. */
  cpql: number | null
  qualityRate: number | null
}

export interface AdTableQlCoverage extends AdTableScope {
  fbLeadsInWindow: number
  matchedLeads: number
  matchedShare: number
  unmatchedBySource: AdQlUnmatchedSource[]
}

export interface AdTableQlResult {
  ads: AdWithQl[]
  coverage: AdTableQlCoverage
}

export interface AdTableQlArgs extends AdTableArgs {
  streakRows: StreakLeadRow[]
}

/**
 * getAdTable + the per-ad Quality Lead join, run ONE MONTH AT A TIME.
 *
 * Per month the Streak window is clipped to month ∩ range, so a lead is only ever offered to the
 * ads that were live when it came in — which is the entire reason this file exists: a September
 * lead matched against July's ad names is how the old table lost more than half its leads.
 *
 * The join always sees the month's FULL ad list, even when `campaignSlug` / `matchCampaign`
 * narrows the output. Stage 1 of ad-ql-join picks a campaign out of the campaign universe it is
 * handed; hiding campaigns from it would push their leads onto whatever survived the filter.
 * Filtering happens after the join, and `coverage` is always the unfiltered truth.
 */
export function getAdTableWithQl(args: AdTableQlArgs): AdTableQlResult {
  const { start, end, streakRows, campaignSlug, matchCampaign } = args
  const scope = scopeMonths(start, end)

  const perAd = new Map<string, { leads: number; ql: number }>()
  const unmatched = new Map<string, { leads: number; ql: number }>()
  const addUnmatched = (source: string, leads: number, ql: number) => {
    const u = unmatched.get(source) || { leads: 0, ql: 0 }
    u.leads += leads
    u.ql += ql
    unmatched.set(source, u)
  }

  let matchedLeads = 0
  for (const m of scope.months) {
    const ads: AdQlAd[] = m.entry.ads.map((a) => ({
      adId: a.adId,
      adName: a.adName,
      adset: a.adsetName || '',
      campaign: a.campaignName || '',
      spend: a.spend,
    }))
    const { ads: joined, coverage } = joinAdQl({ ads, streakRows, start: m.clip.start, end: m.clip.end })
    for (const a of joined) {
      if (!a.leadsStreak && !a.ql) continue
      const acc = perAd.get(a.adId) || { leads: 0, ql: 0 }
      acc.leads += a.leadsStreak
      acc.ql += a.ql
      perAd.set(a.adId, acc)
    }
    matchedLeads += coverage.matchedLeads
    // joinAdQl caps its own unmatched list at the worst 20 placements per month, so a long
    // range's list is a worklist, not a census — matchedLeads / matchedShare are unaffected.
    for (const u of coverage.unmatchedBySource) addUnmatched(u.source, u.leads, u.ql)
  }

  // Leads inside the requested range that fell OUTSIDE every clipped month (a missing month such
  // as 2026-06, or the days of a month the dump's window never reached) are unmatched too —
  // counting them keeps matched + unmatched == the range's real FB lead total instead of quietly
  // shrinking the denominator until the coverage number looks good.
  const covered = scope.months.map((m) => m.clip)
  let fbLeadsInWindow = 0
  for (const r of streakRows) {
    if (leadChannelOf(r) !== 'meta') continue
    const d = streakLeadDay(r)
    if (!d || d < start || d > end) continue
    fbLeadsInWindow++
    if (covered.some((c) => d >= c.start && d <= c.end)) continue
    addUnmatched(String(r.source_placement || ''), 1, isQualityLead(r) ? 1 : 0)
  }

  const table = getAdTable({ start, end, campaignSlug, matchCampaign })
  const ads: AdWithQl[] = table.ads.map((a) => {
    const acc = perAd.get(a.adId) || { leads: 0, ql: 0 }
    return {
      ...a,
      leadsStreak: acc.leads,
      ql: acc.ql,
      cpql: acc.ql > 0 ? Math.round((a.spend / acc.ql) * 100) / 100 : null,
      qualityRate: acc.leads > 0 ? acc.ql / acc.leads : null,
    }
  })

  const unmatchedBySource: AdQlUnmatchedSource[] = Array.from(unmatched.entries())
    .map(([source, v]) => ({ source, leads: v.leads, ql: v.ql }))
    .sort((a, b) => b.leads - a.leads || b.ql - a.ql)
    .slice(0, 10)

  return {
    ads,
    coverage: {
      fbLeadsInWindow,
      matchedLeads,
      matchedShare: fbLeadsInWindow ? matchedLeads / fbLeadsInWindow : 0,
      unmatchedBySource,
      monthsUsed: scope.monthsUsed,
      partialMonths: scope.partialMonths,
      incompleteMonths: scope.incompleteMonths,
      missingMonths: scope.missingMonths,
      uncoveredDays: scope.uncoveredDays,
      metricGaps: scope.metricGaps,
    },
  }
}
