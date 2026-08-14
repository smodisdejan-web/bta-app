/**
 * What each landing page is FOR, and what "working" means for it.
 *
 * WHY THIS FILE IS HAND-WRITTEN
 * -----------------------------
 * Tadej's spec for the per-landing report opens with "namen landinga in cilj
 * (cilj naj bo merljiv - tukaj naj bo data)". The dashboard can compute the data
 * on its own, but it cannot know what a page was BUILT to do, nor what number
 * counts as success. Left to guess, the model produces filler ("goal: increase
 * conversions") — so intent is declared here by a human and the model is told to
 * say "purpose not defined" for anything missing rather than invent one.
 *
 * Targets must be grounded in something real — a sibling page's measured rate,
 * an agreed 2026 target — and the reasoning goes in `targetBasis` so a client-
 * facing report can defend the number.
 *
 * TO ADD A PAGE: one entry, keyed by GA4 path (no trailing slash, no domain).
 */

export interface LpPurpose {
  /** GA4 landing path, e.g. "/luxury-yacht-charters-at-unmatched-value". */
  path: string
  /** What the page exists to do, in one sentence. */
  purpose: string
  /** Primary measurable goal. */
  goal: {
    metric: 'cvr' | 'ql_rate' | 'bookings' | 'revenue'
    /** Target value: percent for cvr/ql_rate, absolute for bookings/revenue. */
    target: number
    /** Why this number is the target — quoted in the report, so no bare guesses. */
    basis: string
  }
  /** Secondary goals worth holding steady while chasing the primary one. */
  guardrails?: Array<{ metric: 'cvr' | 'ql_rate'; min: number; note?: string }>
  /** Expected traffic mix, so the report can flag when reality drifts from intent. */
  intendedTraffic?: string
  /** Anything a report writer would otherwise get wrong. */
  notes?: string
}

const PURPOSES: LpPurpose[] = [
  {
    path: '/luxury-yacht-charters-at-unmatched-value',
    purpose:
      'Lead generation for cold paid traffic (Google Search + Meta) on Croatia inventory, capturing enquiries through the MULTISTEP form.',
    goal: {
      metric: 'cvr',
      target: 3.0,
      basis:
        'Sibling page /yacht-charters-at-unmatched-value runs the same offer at 2.95% CVR over 90 days, so 3.0% is demonstrated as achievable rather than aspirational.',
    },
    guardrails: [
      {
        metric: 'ql_rate',
        min: 54,
        note: 'Current QL rate is 54.4% against a 49.3% site average — extra volume must not dilute lead quality.',
      },
    ],
    intendedTraffic:
      'Roughly 73% Google Paid Search (Search - Croatia - EN) and 22% Meta paid social; the rest direct.',
    notes:
      'Highest-converting lead gen page in the account (2.64% CVR vs 1.60% site average over 90 days). Two near-duplicate URLs exist for the same offer — /yacht-charters-at-unmatched-value and /luxury-yacht-charters-unmatched-value — and it is not yet confirmed whether these are A/B variants or leftovers.',
  },
]

const BY_PATH = new Map(PURPOSES.map((p) => [normalize(p.path), p]))

function normalize(p: string): string {
  if (!p) return '/'
  let out = p.split('?')[0].split('#')[0]
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out.startsWith('/') ? out : `/${out}`
}

export function getLpPurpose(path: string): LpPurpose | null {
  return BY_PATH.get(normalize(path)) ?? null
}

export function hasLpPurpose(path: string): boolean {
  return BY_PATH.has(normalize(path))
}

/** Paths with a declared purpose — used to show coverage of the registry. */
export function definedPurposePaths(): string[] {
  return Array.from(BY_PATH.keys()).sort()
}
