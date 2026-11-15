/**
 * Streak stage aliases → one canonical key (2026-11-15).
 *
 * On Fri 13.11.2026 Goolets sales (Simon Finc, "[GOOLETS]STREAK STAGES") renamed stages and added
 * emoji suffixes; the Streak stage KEYS did not change:
 *   5002 FIRST REPLY → OFFER SENT        5027 STANDARD → ENGAGED       5028 VIP → SHORTLIST
 *   5029 ULTRA VIP   → ONE YACHT         5012 MQL      → UNQUALIFIED   5058 RECEIVED ONLY (new)
 * streak_sync now carries the new names ("OFFER SENT👤", "SQL🤝", "💎SQL PRIME 👤"), streak_full
 * still old ones until its next rebuild — both must read the same. Every stage-name comparison in
 * this app goes through stageKeyOf(); an unknown name returns 'unknown' and
 * scripts/check-streak-stages.ts fails loudly on it (more renames are announced).
 */

export type StageKey =
  | 'ai_robot' | 'unassigned' | 'offer_sent' | 'received_only' | 'engaged' | 'shortlist' | 'one_yacht'
  | 'paper_work' | 'won' | 'start_finalisation' | 'finalisation' | 'finalised' | 'cruise'
  | 'after_cruise_direct' | 'after_cruise_agency' | 'old_customers' | 'old_agency' | 'sql' | 'sql_prime'
  | 'cql' | 'unqualified' | 'agency_archive' | 'legal' | 'black_listed' | 'no_longer_travelling' | 'unknown'

/** lower case, emoji / punctuation → space, collapsed */
export const normStage = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const BY_NAME: Record<string, StageKey> = {
  'ai robot handled': 'ai_robot', 'ai robot': 'ai_robot',
  'unassigned': 'unassigned',
  'first reply': 'offer_sent', 'offer sent': 'offer_sent',
  'received only': 'received_only',
  'standard': 'engaged', 'engaged': 'engaged',
  'vip': 'shortlist', 'shortlist': 'shortlist',
  'ultra vip': 'one_yacht', 'one yacht': 'one_yacht',
  'paper work': 'paper_work', 'paperwork': 'paper_work',
  'start finalisation': 'start_finalisation', 'start finalization': 'start_finalisation',
  'finalisation': 'finalisation', 'finalization': 'finalisation',
  'finalised': 'finalised', 'finalized': 'finalised',
  'cruise': 'cruise',
  'after the cruise direct': 'after_cruise_direct', 'after the cruise agency': 'after_cruise_agency',
  'old customers': 'old_customers', 'old agency': 'old_agency',
  'sql': 'sql', 'sql prime': 'sql_prime',
  'cql': 'cql',
  'mql': 'unqualified', 'unqualified': 'unqualified',
  'agency archive': 'agency_archive',
  'black listed': 'black_listed', 'blacklisted': 'black_listed',
  'no longer travelling': 'no_longer_travelling', 'no longer traveling': 'no_longer_travelling',
}
/** Streak stage keys (pipeline SALES/CRM) — stable across renames */
const BY_KEY: Record<string, StageKey> = {
  '5053': 'ai_robot', '5050': 'unassigned', '5002': 'offer_sent', '5058': 'received_only', '5027': 'engaged',
  '5028': 'shortlist', '5029': 'one_yacht', '5014': 'paper_work', '5042': 'won', '5044': 'won', '5051': 'won',
  '5055': 'won', '5015': 'start_finalisation', '5034': 'finalisation', '5036': 'finalised', '5016': 'cruise',
  '5035': 'after_cruise_direct', '5045': 'after_cruise_agency', '5022': 'old_customers', '5046': 'old_agency',
  '5043': 'sql', '5054': 'sql_prime', '5047': 'cql', '5012': 'unqualified', '5019': 'agency_archive',
  '5031': 'legal', '5039': 'black_listed', '5056': 'no_longer_travelling',
}

/** Canonical key of a Streak stage name or key; '' → 'unknown'. */
export function stageKeyOf(stage: unknown): StageKey {
  const raw = String(stage ?? '').trim()
  if (BY_KEY[raw]) return BY_KEY[raw]
  const n = normStage(raw)
  if (!n) return 'unknown'
  if (BY_NAME[n]) return BY_NAME[n]
  if (/^won( \d{4})?$/.test(n)) return 'won'
  if (/^legal\b/.test(n)) return 'legal'
  return 'unknown'
}

/** "Sales is working it" (old Qualified set, handoff.md §3.2): STANDARD/VIP/ULTRA VIP → ENGAGED/SHORTLIST/ONE YACHT. */
export const SAL_KEYS = new Set<StageKey>(['engaged', 'sql', 'sql_prime', 'shortlist', 'one_yacht', 'paper_work', 'start_finalisation', 'won'])
/** Booked / closing */
export const CLOSING_KEYS = new Set<StageKey>(['paper_work', 'start_finalisation', 'finalisation', 'finalised', 'cruise', 'won', 'after_cruise_direct', 'after_cruise_agency'])
/** Old "Engaged" = SAL + FIRST REPLY (now OFFER SENT). RECEIVED ONLY is NOT engaged and NOT an active
 *  opportunity (Dejan 2026-11-15, to confirm with Simon / Aymen): its own step between OFFER SENT and ENGAGED. */
export const ENGAGED_KEYS = new Set<StageKey>([...SAL_KEYS, 'offer_sent'])
export const UNQUALIFIED_KEYS = new Set<StageKey>(['unqualified', 'cql', 'ai_robot', 'black_listed', 'agency_archive', 'old_agency', 'no_longer_travelling'])

/**
 * Active sales opportunities (Aymen) — PROVISIONAL until Dejan / Simon confirm (no "active buyer"
 * stage yet). Candidates, see ACTIVE_OPPS_DEFS; the node API uses ACTIVE_OPPS_DEFAULT.
 */
export const ACTIVE_OPPS_DEFS = {
  A: { keys: new Set<StageKey>(['engaged', 'shortlist', 'one_yacht']), text: 'Open boxes in ENGAGED, SHORTLIST or ONE YACHT (client engaged with a real inquiry; excludes RECEIVED ONLY, OFFER SENT, SQL/SQL PRIME, closing, won, unqualified).' },
  B: { keys: new Set<StageKey>(['engaged', 'shortlist', 'one_yacht', 'sql', 'sql_prime']), text: 'A + SQL / SQL PRIME (sales-qualified boxes still open).' },
  C: { keys: new Set<StageKey>(['engaged', 'shortlist', 'one_yacht', 'sql', 'sql_prime', 'paper_work', 'start_finalisation']), text: 'B + PAPER WORK / START FINALISATION (everything open from engaged until won).' },
} as const
export const ACTIVE_OPPS_DEFAULT: keyof typeof ACTIVE_OPPS_DEFS = 'A'

/** Sales sub-funnel buckets (node API salesStages, 2026-11-15): funnel order, then terminal buckets. */
export const SALES_FUNNEL_ORDER = ['offer_sent', 'received_only', 'engaged', 'shortlist', 'one_yacht', 'sql', 'closing', 'won'] as const
export const SALES_TERMINAL = ['unqualified', 'cql', 'black_listed', 'ai_robot', 'unassigned', 'archive', 'unknown'] as const
export type SalesBucket = typeof SALES_FUNNEL_ORDER[number] | typeof SALES_TERMINAL[number]
export function salesBucketOf(k: StageKey): SalesBucket {
  switch (k) {
    case 'sql': case 'sql_prime': return 'sql'
    case 'paper_work': case 'start_finalisation': case 'finalisation': case 'finalised': case 'cruise': return 'closing'
    case 'won': case 'after_cruise_direct': case 'after_cruise_agency': return 'won'
    case 'agency_archive': case 'old_agency': case 'old_customers': case 'legal': case 'no_longer_travelling': return 'archive'
    case 'offer_sent': case 'received_only': case 'engaged': case 'shortlist': case 'one_yacht': case 'unqualified': case 'cql': case 'black_listed': case 'ai_robot': case 'unassigned': return k
    default: return 'unknown'
  }
}
/** unqualifiedShare denominator excludes boxes no human has judged yet */
export const NOT_HUMAN_STAGED = new Set<SalesBucket>(['ai_robot', 'unassigned', 'unknown'])
