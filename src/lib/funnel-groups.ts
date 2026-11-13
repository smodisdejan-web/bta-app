// src/lib/funnel-groups.ts
//
// The 5 business funnels + "Outside funnels", one level ABOVE the 16 umbrellas of
// lib/business-funnel.ts (confirmed by Dejan 2026-11-13). Data only — the resolver that applies
// it row by row lives in lib/funnel-nodes.ts.
//
// Precedence for every row (spend row, lead, booking, GA4 path):
//   1. CAMPAIGN_FUNNEL   exact platform campaign name (single-yacht campaigns → Asset marketing)
//   2. BOFU ad set rule  the BOFU campaign is split by ad set: single-yacht ad sets → Asset,
//                        the generic "Warm - Angle …" ad sets → EB Croatia
//   3. UMBRELLA_FUNNEL   the row's umbrella
// Anything that resolves to no umbrella stays in the unattributed remainder (incl. Bing/ChatGPT).
//
// DEFAULTS STILL TO BE CONFIRMED BY DEJAN (applied per his stated rule, 2026-11-13):
//   - historical single-yacht campaigns → Asset: Tosca/Belgin Sultan Turkey Cold (+ LF),
//     "YOLO - August 2026", and the old BOFU Warm/Interesi Bella, Riva, Ohana ad sets
//   - Dalmatino / Nocturno / Dalmatinčki group campaigns → EB Croatia (dalmatincki umbrella)
//   - Google "Posamezne ladje - Leads" (several yachts) → EB Croatia
//   - BROKER partnership → Outside (boost umbrella)
//   - Lead magnet: leads are n/a — the quiz registrations land in HubSpot, not Streak

import { nk } from './business-funnel'

export type FunnelKey = 'eb_croatia' | 'oguz_khan_winter' | 'turkey' | 'asset' | 'lead_magnet' | 'outside'

export interface FunnelDef {
  key: FunnelKey
  label: string
  /** Umbrellas whose rows belong here unless a campaign / ad set rule moves them. */
  umbrellas: string[]
  /** "Outside funnels": shown, but not a business funnel (no LP, brand / PMax / video / boost). */
  nonFunnel?: boolean
  /** Leads/QL are not measured in Streak for this funnel → shown as n/a with this note. */
  leadsNa?: string
}

export const FUNNELS: FunnelDef[] = [
  {
    key: 'eb_croatia',
    label: 'EB Croatia',
    umbrellas: ['earlybook', 'dalmatincki', 'clg', 'croatia', 'organic', 'bofu'],
  },
  { key: 'oguz_khan_winter', label: 'Oguz Khan Winter', umbrellas: ['caribbean'] },
  { key: 'turkey', label: 'Turkey', umbrellas: ['turkey'] },
  { key: 'asset', label: 'Asset marketing', umbrellas: ['asset', 'smarter'] },
  {
    key: 'lead_magnet',
    label: 'Lead magnet',
    umbrellas: ['matchmaker'],
    leadsNa: 'Lead magnet registrations (Yacht Matchmaker, CSY quiz) are in HubSpot, not in Streak — leads and QL are n/a here, not 0.',
  },
  {
    key: 'outside',
    label: 'Outside funnels',
    umbrellas: ['pmax', 'brand', 'youtube', 'dobrik', 'boost'],
    nonFunnel: true,
  },
]

export const FUNNEL_BY_KEY = new Map(FUNNELS.map((f) => [f.key, f]))

/** umbrella slug → funnel */
export const UMBRELLA_FUNNEL: Record<string, FunnelKey> = Object.fromEntries(
  FUNNELS.flatMap((f) => f.umbrellas.map((u) => [u, f.key]))
)

/** Exact Meta campaign names that leave their umbrella's funnel (single yacht → Asset). */
const CAMPAIGN_FUNNEL_NAMES: [string, FunnelKey][] = [
  // live 2026-11
  ['FB - Test - Prospecting - Tosca 2027 - ABO', 'asset'],
  ['FB - Test - Prospecting - YOLO EB 2027 - ABO', 'asset'],
  ['BOFU - AI50 test - Interesi Bella - 2026-11-04', 'asset'],
  // historical single-yacht campaigns (default, to be confirmed)
  ['Belgin Sultan - Turkey - Cold - ABO', 'asset'],
  ['Belgin Sultan - Turkey - Cold - ABO - LF', 'asset'],
  ['Tosca - Turkey - Cold - ABO', 'asset'],
  ['Tosca - Turkey - Cold - ABO - LF', 'asset'],
  ['YOLO - August 2026', 'asset'],
]
export const CAMPAIGN_FUNNEL = new Map<string, FunnelKey>(CAMPAIGN_FUNNEL_NAMES.map(([n, f]) => [nk(n), f]))

/** The one campaign that is split by ad set in part 1. */
export const BOFU_CAMPAIGN = 'BOFU - Landing Attainable Luxury - Objections crusher'
export const BOFU_CAMPAIGN_ID = '120230443711160087'
/** Single-yacht BOFU ad sets (Interesi/Warm Bella, Riva, Ohana incl. "- 2", "- Copy", "- AI50"). */
export const BOFU_YACHT_ADSET = /^(interesi|warm)\s*-\s*(bella|riva|ohana)\b/i
/** Streak SOURCE PLACEMENT tokens of the single-yacht BOFU ad sets (fallback when utm_mapping is silent). */
export const BOFU_YACHT_SP = /^(interesi|warm)_(bella|riva|ohana)|^(bella|riva|ohana)_/i
/** BOFU bookings on a single-yacht landing page → Asset. */
export const BOFU_YACHT_LANDING = /^\/?(bella-|riva-|ohana-|freedom-)/i
export const BOFU_FUNNEL_YACHT: FunnelKey = 'asset'
export const BOFU_FUNNEL_GENERIC: FunnelKey = 'eb_croatia'

/**
 * GA4 landing paths that belong to Asset marketing whatever umbrella regex also matches them
 * (vessel pages, YOLO, Tosca/Belgin). Checked BEFORE the umbrella lp regexes so every path lands
 * in exactly one funnel and funnels + remainder = master for LP views too.
 */
export const LP_FUNNEL_OVERRIDES: [RegExp, FunnelKey][] = [
  [/^\/(bella-|riva-|ohana-|freedom-)/i, 'asset'],
  [/^\/charter-yolo/i, 'asset'],
  [/^\/best-superyacht-deal-of-summer-2027-turkey/i, 'asset'],
  [/tosca|belgin/i, 'asset'],
]
