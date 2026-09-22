// src/lib/ad-ql-join.ts
//
// PER-AD Quality Lead join: Streak leads → a single row of `fb_ads_level`.
//
// WHY THIS EXISTS
// `fb_ads_level` carries EXACT per-ad Meta metrics (spend, Landing Lead, CPL, Hook/Hold) but
// its ql / cpql / zone columns are written empty on purpose — Meta refuses to export url_tags,
// so nothing in the CSV bridges an ad to a Streak SOURCE PLACEMENT (see
// code/facebook/sync-goolets-fb-ads.js). This module builds that bridge from the OTHER side:
// the SOURCE PLACEMENT string the ad itself stamped on the click.
//
// TWO STAGES, and the first one is never re-litigated here:
//   Stage 1  SOURCE PLACEMENT → CAMPAIGN, using fuzzy-match.ts verbatim. That rulebook is the
//            audited source of truth (99.6 % of July's FB leads) and is KEPT IN SYNC with
//            code/goolets/mtd-fuzzy-match.js. This file imports it and changes nothing in it.
//   Stage 2  CAMPAIGN → ONE AD, searching ONLY the ads of the campaign stage 1 returned.
//
// STAGE 2 IS DELIBERATELY CONSERVATIVE. A lead lands on an ad or it lands in `unmatched` —
// it is NEVER spread across several ads, and an unmatched lead is never quietly folded into
// the campaign's biggest spender. The whole point of the number is to tell Dejan which
// CREATIVE buys quality, so a guessed row is worse than an honest gap; `coverage` reports
// exactly how much of the window the join could and could not place.
//
// The four tiers stage 2 tries, best first (first tier that produces any candidate wins):
//   1. EXACT      normalised ad name === normalised SOURCE PLACEMENT.
//   2. CONTAINED  the ad's token run appears contiguously inside the SP's tokens (or the SP's
//                 inside the ad's). The run must carry at least one token with non-zero IDF,
//                 which is what keeps a one-word ad name honest: "Dalmatino" may claim
//                 `…_tier1-dalmatino` (nothing longer contains it) but can never outrank the
//                 longer run a fuller ad name provides, and a run made only of campaign words
//                 is not a run at all.
//   3. PREFIX     longest common token prefix, ≥ 2 tokens.
//   4. OVERLAP    IDF-weighted shared tokens. Needed because some ad names are written
//                 BACKWARDS relative to the utm (`tosca_interesi_tosca_short1_mitja` vs
//                 "VIDEO: Tosca-Short1-Tosca-is-launching (Mitja)") — nothing positional
//                 reaches those. IDF is computed over the campaign's own ad names and tokens
//                 that also occur in the CAMPAIGN name are weighted 0, which is what stops
//                 generic words from deciding the match: inside
//                 "Test - Dalmatinčki - Sail Smarter - CRO-001 Test", "last" and "minute"
//                 sit in 6 of 20 ad names, so `…_last-minute-sever` scores below threshold and
//                 is reported unmatched instead of being handed to the NOCTURNO ad it shares
//                 those two words with.
//
// Ties: same score → fewer surplus ad-name tokens wins (a precision preference); still tied →
// the AD SET name breaks it (`interesi_bella_bf_vertical` → "Interesi - Bella", not
// "Warm - Bella - 2", since "BELLA BF VERTICAL" runs in both); still tied → unmatched.
// The ad-set tiebreak is also what separates the SAME creative running in several ad sets,
// which is the normal case in this account: ad NAME is not unique inside a campaign, only
// (campaign, ad name, ad set) is.

import { flatten, matchSourceToCampaign } from './fuzzy-match'
import { leadChannelOf, isQualityLead, streakLeadDay } from './streak-leads'
import type { StreakLeadRow } from './sheetsData'

/** Minimum shape joinAdQl needs from a `fb_ads_level` row. FbAdLevel satisfies it. */
export interface AdQlAd {
  adId: string
  adName: string
  adset: string
  campaign: string
  spend: number
}

export interface AdQlMetrics {
  /** Streak leads (Meta channel) inside the window that resolved to THIS ad row. */
  leadsStreak: number
  /** Of those, the ones with Streak AI ≥ 50. */
  ql: number
  /** spend / ql — null when ql is 0 (a CPQL of Infinity is not a number Dejan can act on). */
  cpql: number | null
  /** ql / leadsStreak — null when the ad has no attributed leads at all. */
  qualityRate: number | null
}

export type AdRowWithQl<T extends AdQlAd = AdQlAd> = T & AdQlMetrics

export interface AdQlUnmatchedSource {
  source: string
  leads: number
  ql: number
}

export interface AdQlCoverage {
  /** Meta (Facebook/Instagram) Streak leads whose Ljubljana day falls inside the window. */
  fbLeadsInWindow: number
  /** How many of those were placed on exactly one ad row. */
  matchedLeads: number
  /** matchedLeads / fbLeadsInWindow, 0 when the window holds no FB leads. */
  matchedShare: number
  /** The worst offenders first, capped at 20 — the fix-your-ad-naming worklist. */
  unmatchedBySource: AdQlUnmatchedSource[]
}

export interface AdQlResult<T extends AdQlAd = AdQlAd> {
  ads: AdRowWithQl<T>[]
  coverage: AdQlCoverage
}

/** Below this IDF sum the OVERLAP tier's evidence is not specific enough to name an ad. */
const MIN_OVERLAP_SCORE = 1.0
/** OVERLAP also needs this many distinct shared tokens, however heavy they are. */
const MIN_OVERLAP_TOKENS = 2
/**
 * …and the shared tokens must account for at least half of what the PLACEMENT actually says
 * (campaign words excluded). Without this rail, `dalmatincki_smart-luxury-sailing_last-minute-sever`
 * scores 2 heavy-ish tokens ("last", "minute") against the NOCTURNO creative and is handed to it,
 * 12 leads and all — when the ad it really names ("…LastMinuteSSY_MihaSever…") shares no token
 * with it at all. Two words out of six is not identification.
 */
const MIN_OVERLAP_SP_COVERAGE = 0.5
/** PREFIX needs this many tokens to be evidence of anything. */
const MIN_PREFIX_TOKENS = 2

// flatten() unifies space/underscore/slash/hyphen but leaves brackets, colons and dots in
// place, which is enough to hide a real match: "VIDEO: Tosca-Short1-Tosca-is-launching (Mitja)"
// flattens with the token `(mitja)`, so the utm's `mitja` never lines up with it. Stage 2
// therefore tokenises one step further — flatten(), then drop everything that is not a letter
// or a digit. fuzzy-match.ts itself is untouched; this is a stage-2-only refinement.
const tokensOf = (s: unknown): string[] =>
  flatten(s)
    .split('_')
    .map((t) => t.replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean)

/** The stage-2 comparison key: tokensOf() re-joined. Used for the EXACT tier. */
const flatKey = (s: unknown): string => tokensOf(s).join('_')

/** Campaign names in fb_ads_level are not unique keys for ads — this is. */
const adKey = (a: AdQlAd) => `${a.adId}`

interface AdIndexEntry {
  ad: AdQlAd
  flat: string
  tokens: string[]
  tokenSet: Set<string>
  adsetTokens: Set<string>
}

interface CampaignIndex {
  entries: AdIndexEntry[]
  /** token → number of DISTINCT ad names in the campaign carrying it */
  df: Map<string, number>
  /** distinct ad names in the campaign */
  nameCount: number
  /** tokens of the campaign name itself — zero discriminating power inside the campaign */
  campaignTokens: Set<string>
}

function buildCampaignIndex(campaign: string, ads: AdQlAd[]): CampaignIndex {
  const entries: AdIndexEntry[] = ads.map((ad) => {
    const tokens = tokensOf(ad.adName)
    return {
      ad,
      flat: flatKey(ad.adName),
      tokens,
      tokenSet: new Set(tokens),
      adsetTokens: new Set(tokensOf(ad.adset)),
    }
  })

  const byName = new Map<string, Set<string>>()
  for (const e of entries) {
    if (!byName.has(e.flat)) byName.set(e.flat, e.tokenSet)
  }
  const df = new Map<string, number>()
  for (const set of byName.values()) {
    for (const t of set) df.set(t, (df.get(t) || 0) + 1)
  }

  return {
    entries,
    df,
    nameCount: byName.size,
    campaignTokens: new Set(tokensOf(campaign)),
  }
}

function idf(index: CampaignIndex, token: string): number {
  if (index.campaignTokens.has(token)) return 0
  const d = index.df.get(token) || 0
  return Math.log((index.nameCount + 1) / (d + 1))
}

/** Is `needle` a contiguous run inside `hay`? */
function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

function commonPrefixLength(a: string[], b: string[]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Evidence tier, 1 = strongest. A lower tier always beats a higher one, whatever it scores. */
type Tier = 1 | 2 | 3 | 4

interface Scored {
  entry: AdIndexEntry
  tier: Tier
  score: number
  /** ad-name tokens that did NOT participate — fewer is more precise */
  surplus: number
}

/**
 * The ad row a SOURCE PLACEMENT belongs to inside ONE campaign, or null when the evidence
 * does not single one out. Exported for the verification script / future audit tooling.
 */
export function resolveAdForSource(
  sourcePlacement: string,
  index: CampaignIndex
): AdQlAd | null {
  const spTokens = tokensOf(sourcePlacement)
  if (!spTokens.length) return null
  const spFlat = spTokens.join('_')
  const spSet = new Set(spTokens)

  // How many of the placement's own words could possibly identify an ad: campaign words
  // (which every ad in the campaign shares) carry no signal and are not counted.
  const spSignal = new Set(spTokens.filter((t) => !index.campaignTokens.has(t))).size || spTokens.length

  const scored: Scored[] = []
  for (const entry of index.entries) {
    if (!entry.flat) continue

    if (entry.flat === spFlat) {
      scored.push({ entry, tier: 1, score: entry.tokens.length, surplus: 0 })
      continue
    }

    const shared = entry.tokens.filter((t) => spSet.has(t))
    const sharedDistinct = new Set(shared)
    const surplus = entry.tokenSet.size - sharedDistinct.size

    if (containsRun(spTokens, entry.tokens) || containsRun(entry.tokens, spTokens)) {
      let runWeight = 0
      for (const t of entry.tokenSet) runWeight += idf(index, t)
      if (runWeight > 0) {
        scored.push({ entry, tier: 2, score: Math.min(entry.tokens.length, spTokens.length), surplus })
        continue
      }
    }

    const prefix = commonPrefixLength(spTokens, entry.tokens)
    if (prefix >= MIN_PREFIX_TOKENS) {
      scored.push({ entry, tier: 3, score: prefix, surplus })
      continue
    }

    // Only tokens with signal count: a shared word that is also in the campaign name is shared
    // with every other ad in the campaign too, so it identifies nothing.
    let w = 0
    let sharedSignal = 0
    for (const t of sharedDistinct) {
      const weight = idf(index, t)
      if (weight > 0) {
        w += weight
        sharedSignal++
      }
    }
    if (
      sharedSignal >= MIN_OVERLAP_TOKENS &&
      sharedSignal >= spSignal * MIN_OVERLAP_SP_COVERAGE &&
      w >= MIN_OVERLAP_SCORE
    ) {
      scored.push({ entry, tier: 4, score: w, surplus })
    }
  }

  if (!scored.length) return null

  const bestTier = Math.min(...scored.map((s) => s.tier)) as Tier
  let pool = scored.filter((s) => s.tier === bestTier)

  const bestScore = Math.max(...pool.map((s) => s.score))
  pool = pool.filter((s) => s.score >= bestScore - 1e-9)

  const leastSurplus = Math.min(...pool.map((s) => s.surplus))
  pool = pool.filter((s) => s.surplus === leastSurplus)

  if (pool.length === 1) return pool[0].entry.ad

  // An ad that never spent cannot have produced a lead — drop the dead twins first. This is
  // what separates "Dalmatino [Tier 1 - Interests] €1.145" from its €0 LATAM clone.
  const spending = pool.filter((s) => s.entry.ad.spend > 0)
  if (spending.length === 1) return spending[0].entry.ad
  if (spending.length) pool = spending

  // Same creative in several LIVE ad sets (the normal case): the SP's audience token decides.
  const adsetScores = pool.map((s) => {
    let hit = 0
    for (const t of s.entry.adsetTokens) if (spSet.has(t)) hit++
    return { s, hit }
  })
  const bestHit = Math.max(...adsetScores.map((a) => a.hit))
  if (bestHit === 0) return null
  const winners = adsetScores.filter((a) => a.hit === bestHit)
  return winners.length === 1 ? winners[0].s.entry.ad : null
}

export function joinAdQl<T extends AdQlAd>(args: {
  ads: T[]
  streakRows: StreakLeadRow[]
  /** YYYY-MM-DD, inclusive */
  start: string
  /** YYYY-MM-DD, inclusive */
  end: string
}): AdQlResult<T> {
  const { ads, streakRows, start, end } = args

  // ── window + channel. Same day rule (lib/day.ts) and same channel rule the funnel uses.
  const fbLeads = streakRows.filter((r) => {
    if (leadChannelOf(r) !== 'meta') return false
    const d = streakLeadDay(r)
    return !!d && d >= start && d <= end
  })

  // ── one bucket per distinct SOURCE PLACEMENT: the join key is the string, not the lead.
  const bySource = new Map<string, { leads: number; ql: number }>()
  for (const r of fbLeads) {
    const src = String(r.source_placement || '')
    const b = bySource.get(src) || { leads: 0, ql: 0 }
    b.leads++
    if (isQualityLead(r)) b.ql++
    bySource.set(src, b)
  }

  // ── stage 1 needs the campaign universe the ADS know about, not the account's.
  const adsByCampaign = new Map<string, T[]>()
  for (const a of ads) {
    const list = adsByCampaign.get(a.campaign)
    if (list) list.push(a)
    else adsByCampaign.set(a.campaign, [a])
  }
  const campaigns = Array.from(adsByCampaign.keys())
  const indexCache = new Map<string, CampaignIndex>()
  const indexFor = (campaign: string): CampaignIndex => {
    let ix = indexCache.get(campaign)
    if (!ix) {
      ix = buildCampaignIndex(campaign, adsByCampaign.get(campaign) || [])
      indexCache.set(campaign, ix)
    }
    return ix
  }

  const perAd = new Map<string, { leads: number; ql: number }>()
  const unmatched: AdQlUnmatchedSource[] = []
  let matchedLeads = 0

  for (const [source, bucket] of bySource) {
    const campaign = matchSourceToCampaign(source, campaigns)
    // matchSourceToCampaign() answers 'Unknown Facebook' when no rule and no campaign fits —
    // that is a miss, not a campaign, and `null` means "not Facebook at all".
    const hasCampaign = !!campaign && adsByCampaign.has(campaign)
    const ad = hasCampaign ? resolveAdForSource(source, indexFor(campaign as string)) : null

    if (!ad) {
      unmatched.push({ source, leads: bucket.leads, ql: bucket.ql })
      continue
    }
    const key = adKey(ad)
    const acc = perAd.get(key) || { leads: 0, ql: 0 }
    acc.leads += bucket.leads
    acc.ql += bucket.ql
    perAd.set(key, acc)
    matchedLeads += bucket.leads
  }

  const out: AdRowWithQl<T>[] = ads.map((a) => {
    const acc = perAd.get(adKey(a)) || { leads: 0, ql: 0 }
    return {
      ...a,
      leadsStreak: acc.leads,
      ql: acc.ql,
      cpql: acc.ql > 0 ? a.spend / acc.ql : null,
      qualityRate: acc.leads > 0 ? acc.ql / acc.leads : null,
    }
  })

  unmatched.sort((a, b) => b.leads - a.leads || b.ql - a.ql)

  return {
    ads: out,
    coverage: {
      fbLeadsInWindow: fbLeads.length,
      matchedLeads,
      matchedShare: fbLeads.length ? matchedLeads / fbLeads.length : 0,
      unmatchedBySource: unmatched.slice(0, 20),
    },
  }
}
