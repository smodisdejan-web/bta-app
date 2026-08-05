import { NextResponse } from 'next/server'

import {
  fetchFbEnriched,
  fetchSheet,
  fetchStreakSync,
  fetchTestTracker,
  fetchTestVariants,
  type FbEnrichedRow,
  type StreakLeadRow,
  type TestTrackerRow,
  type TestVariantRow,
} from '@/lib/sheetsData'

export const dynamic = 'force-dynamic'

// Manual mapping: campaign name → streak_sync SOURCE PLACEMENT prefix
// Used when sourceMatchesCampaign() fuzzy matching is too broad (e.g., CRO-001)
// Value is either a plain string prefix, or { prefix, exclude } when a control
// shares its base prefix with the test variant (e.g. landing_gulet_ vs landing_gulet_v2_).
type StreakPrefixRule = string | { prefix: string; exclude?: string[] }

const STREAK_PREFIX_MAP: Record<string, StreakPrefixRule> = {
  'Dalmatinčki - Sail Smarter - CRO-001 Control': 'dalmatincki_sail-smarter_',
  'Test - Dalmatinčki - Sail Smarter - CRO-001 Test': 'dalmatincki_smart-luxury-sailing_',
  'Smart Spirit - 25 Off - CBO': '25off',
  'Test - Smart Spirit - Family - CBO': 'family',
  'Smart Spirit - 25 Off - CBO - LF': 'smart spirit - 25 off - cbo - lf',
  'Test - Smart Spirit - Family - CBO - LF': 'test - smart spirit - family - cbo - lf',
  'Landing Unmatched Value - Objections crusher ads': 'landing_unmatched_value_1_',
  'Test - Landing Unmatched Value Forma 2 - Objections crusher ads': 'landing_unmatched_value_2_',
  'Alessandro I - The Smarter Way - CBO - New': 'alessandro_smarter_',
  'Alessandro I Discount - CBO - New': 'alessandro_tier',
  // CRO-003: Landing Gulets multistep vs standard form
  'Landing Gulets  - Scaling - CBO 150': { prefix: 'landing_gulet_', exclude: ['landing_gulet_v2_'] },
  'Test - Landing Gulets  - Scaling - CBO 150': 'landing_gulet_v2_',
  // CRO-004: RareOps — long (3-step) form vs short form. Control and test share the
  // same utm_content base; the test variant only adds a '-form1' suffix, so the control
  // MUST exclude it or it would swallow the test leads.
  // NB: source_placement is lowercased before matching → keys here must be lowercase.
  'ASSET – TOSCA – RareOps – ABO': {
    prefix: 'rare-ops_tosca-hottest-value-superyacht',
    exclude: ['rare-ops_tosca-hottest-value-superyacht-form1'],
  },
  'Prava forma - ASSET – TOSCA – RareOps – ABO': 'rare-ops_tosca-hottest-value-superyacht-form1',
  'ASSET – Dalmatino – RareOps – ABO': {
    prefix: 'rare-ops_diving_expedition_dalmatino_5-action_last-minute-dalmatincki',
    exclude: ['rare-ops_diving_expedition_dalmatino_5-action_last-minute-dalmatincki-form1'],
  },
  'Prava forma - ASSET – Dalmatino – RareOps – ABO':
    'rare-ops_diving_expedition_dalmatino_5-action_last-minute-dalmatincki-form1',
  'ASSET – Anima Maris – RareOps – ABO': {
    prefix: 'rare-ops_anima-maris-the-experience',
    exclude: ['rare-ops_anima-maris-the-experience-form1'],
  },
  'Prava forma - ASSET – Anima Maris – RareOps – ABO': 'rare-ops_anima-maris-the-experience-form1',
}

const SPEND_ANOMALY_THRESHOLD = 1000

// SAL = Sales-Accepted Lead. Streak Stage values that mean "sales is actually working
// this lead", per handoff.md §3.2 (the Qualified set). Deliberately NOT derived from
// AI score: for ASSET/RareOps campaigns the Streak scoring was tuned separately, so
// QL (AI ≥ 50) is not comparable across campaign types. Also deliberately NOT derived
// from form field content (group size, budget range) — a short form collects fewer
// fields and would be penalised for that alone, which is exactly the bias we're testing.
const SAL_STAGES = new Set([
  'standard',
  'sql',
  'sql prime',
  'vip',
  'ultra vip',
  'paper work',
  'start finalisation',
  'start finalization',
  'won',
])

// ENGAGED = the lead answered at least once ('First Reply') or went further.
// SAL is the metric we care about, but on RareOps only ~13% of leads ever reach it,
// so over a two-week window SAL is too rare to separate two variants. Engaged sits at
// ~56% on the same traffic, moves with the same underlying quality, and is still
// form-agnostic — so it is the signal that is actually readable inside a test window.
const ENGAGED_STAGES = new Set([...SAL_STAGES, 'first reply'])

function normaliseStage(stage: unknown): string {
  return String(stage ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isSalStage(stage: unknown): boolean {
  return SAL_STAGES.has(normaliseStage(stage))
}

function isEngagedStage(stage: unknown): boolean {
  return ENGAGED_STAGES.has(normaliseStage(stage))
}

type VariantDebug = {
  fbMatched: number
  streakMatched: number
  stagesSeen?: Record<string, number>
}

type VariantMetrics = {
  spend: number
  clicks: number
  lpViews: number
  leads: number
  ql: number
  qualityRate: number
  cpl: number | null
  cpql: number | null
  sal: number
  salRate: number
  cpsal: number | null
  engaged: number
  engagedRate: number
  cpEngaged: number | null
  bookings: number
  rvc: number
  // 'hubspot' = leads counted from hubspot_contacts by form name. Such a test also carries
  // a Meta block (ad-set spend + Streak-UTM leads) in the meta* fields below; the two are
  // reported side by side, never mixed into one CPL.
  source?: 'fb-streak' | 'hubspot'
  metaLeads?: number
  metaCpl?: number | null
  metaLpvToLead?: number
  metaAsOf?: string
}

// Variants for tests split by HubSpot FORM rather than by campaign (both LP variants run
// in the same campaigns with the same UTMs, so the form is the only discriminator) are
// pre-aggregated into the `test_variants` tab by code/hubspot/build-test-variants.js.
// Counting them here would mean pulling all 11.7 MB of hubspot_contacts per request.
function hubspotVariantFrom(row: TestVariantRow | undefined): VariantMetrics | null {
  if (!row) return null
  return {
    // Meta delivery. Deliberately kept separate from `leads` below: these two blocks
    // count different populations (Meta ad sets vs every source that reached the form),
    // so the card labels them and never divides one by the other.
    spend: row.meta_spend,
    clicks: row.meta_clicks,
    lpViews: row.meta_lp_views,
    metaLeads: row.meta_leads,
    metaCpl: row.meta_cpl || null,
    metaLpvToLead: row.meta_lpv_to_lead,
    metaAsOf: row.meta_as_of,
    leads: row.leads,
    ql: row.ql,
    qualityRate: row.ql_rate,
    cpl: null,
    cpql: null,
    sal: row.sal,
    salRate: row.sal_rate,
    cpsal: null,
    engaged: 0,
    engagedRate: 0,
    cpEngaged: null,
    bookings: row.bookings,
    rvc: 0,
    source: 'hubspot',
  }
}

type TestWithVariants = TestTrackerRow & {
  variants: {
    A: VariantMetrics
    B: VariantMetrics
  }
}

function parseDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(+d) ? null : d
}

function toDateFromCell(val: unknown): Date | null {
  if (val instanceof Date) return val
  if (typeof val === 'number') {
    // Excel serial date (days since 1899-12-30)
    const epoch = new Date(1899, 11, 30)
    const d = new Date(epoch.getTime() + val * 24 * 60 * 60 * 1000)
    return Number.isNaN(+d) ? null : d
  }
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val)
    return Number.isNaN(+d) ? null : d
  }
  return null
}

function getRowDate(row: FbEnrichedRow): Date | null {
  return toDateFromCell((row as any).date_iso ?? (row as any).date ?? (row as any).date_start)
}

function sourceMatchesCampaign(sourcePlacement: string, campaign: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const src = norm(sourcePlacement || '')
  const camp = norm(campaign || '')
  if (!src || !camp) return false

  // Require key tokens (e.g., lf/lp + individual)
  const tokens = camp.split(' ').filter(Boolean)
  const keyPrefix = tokens.find((t) => t === 'lf' || t === 'lp') || tokens[0]
  const keySecond = tokens.find((t) => t !== keyPrefix)
  const required = [keyPrefix, keySecond].filter(Boolean)

  const tokensMatch = required.every((t) => src.includes(t))
  const fullMatch = src.includes(camp)

  return tokensMatch || fullMatch
}

function sumSafe(values: Array<number | undefined | null>) {
  return values.reduce<number>((acc, v) => acc + (Number(v) || 0), 0)
}

// Does a single streak lead belong to a single campaign? Extracted so a variant can
// span several campaigns (see aggregateVariant) without duplicating the rules.
function leadMatchesCampaign(lead: StreakLeadRow, campaign: string): boolean {
  // If we have an explicit mapping, use it instead of fuzzy matching
  const streakMapValue = STREAK_PREFIX_MAP[campaign]
  if (streakMapValue) {
    const sp = (lead.source_placement || '').toLowerCase()
    const cat = ((lead as any).source_category || (lead as any).latest_source_category || '').toUpperCase()
    if (cat !== 'PAID_SOCIAL') return false
    // Object form: prefix + optional exclude list (e.g. landing_gulet_ excluding landing_gulet_v2_)
    if (typeof streakMapValue === 'object') {
      if (!sp.startsWith(streakMapValue.prefix)) return false
      return !(streakMapValue.exclude || []).some((ex) => sp.startsWith(ex))
    }
    // Trailing '_' → exact prefix match (CRO-001 style)
    // Contains spaces → exact full match (SS-002 style)
    // SS-001 keyword match within smart_spirit_ prefix (e.g. '25off', 'family')
    // Generic startsWith fallback (e.g. 'alessandro_tier' matches 'alessandro_tier1_...')
    if (streakMapValue.endsWith('_')) {
      return sp.startsWith(streakMapValue)
    }
    if (streakMapValue.includes(' ')) {
      return sp === streakMapValue
    }
    if (sp.startsWith('smart_spirit_') && sp.includes(streakMapValue)) return true
    return sp.startsWith(streakMapValue)
  }
  // Otherwise fall back to existing fuzzy matching (for LF-001 etc.)
  return sourceMatchesCampaign(lead.source_placement, campaign)
}

function aggregateVariant(
  campaignsRaw: string[],
  startDate: Date | null,
  endDate: Date | null,
  fbRows: FbEnrichedRow[],
  streakRows: StreakLeadRow[],
  debug: VariantDebug
): VariantMetrics {
  const campaigns = campaignsRaw.map((c) => (c || '').trim()).filter(Boolean)
  if (campaigns.length === 0) {
    return {
      spend: 0,
      clicks: 0,
      lpViews: 0,
      leads: 0,
      ql: 0,
      qualityRate: 0,
      cpl: null,
      cpql: null,
      sal: 0,
      salRate: 0,
      cpsal: null,
      engaged: 0,
      engagedRate: 0,
      cpEngaged: null,
      bookings: 0,
      rvc: 0,
    }
  }
  const campaignSet = new Set(campaigns)

  const fbFiltered = fbRows.filter((row) => {
    // drop header/formula artifacts where date is missing
    const camp = (row.campaign_name || '').trim()
    if (!camp) return false
    if (!campaignSet.has(camp)) return false
    const rowDate = getRowDate(row)
    if (!rowDate) return false
    if (startDate && rowDate < startDate) return false
    if (endDate && rowDate > endDate) return false
    // Filter out Mixed Analytics spend anomalies
    const rowSpend = parseFloat(String(row.spend)) || 0
    if (rowSpend > SPEND_ANOMALY_THRESHOLD) return false
    return true
  })
  debug.fbMatched = fbFiltered.length

  const spend = sumSafe(fbFiltered.map((r) => parseFloat(String(r.spend)) || 0))
  const clicks = sumSafe(fbFiltered.map((r) => parseFloat(String(r.clicks)) || 0))
  const lpViews = sumSafe(fbFiltered.map((r) => parseFloat(String(r.lp_views)) || 0))

  const streakFiltered = streakRows.filter((lead) => {
    const d = parseDate(lead.inquiry_date)
    if (startDate) {
      if (!d || d < startDate) return false
    }
    if (endDate && d && d > endDate) return false
    return campaigns.some((campaign) => leadMatchesCampaign(lead, campaign))
  })
  debug.streakMatched = streakFiltered.length

  let ql = 0
  let sal = 0
  let engaged = 0
  let bookings = 0
  const stagesSeen: Record<string, number> = {}
  for (const lead of streakFiltered) {
    const aiRaw = (lead.ai_score as unknown) ?? (lead as any).ai ?? 0
    let ai = Number(aiRaw)
    if (Number.isNaN(ai)) {
      ai = Number.parseFloat(String(aiRaw).replace(',', '.'))
      if (Number.isNaN(ai)) ai = 0
    }
    if (ai >= 50) ql += 1
    const stageKey = normaliseStage(lead.stage) || '(empty)'
    stagesSeen[stageKey] = (stagesSeen[stageKey] || 0) + 1
    if (isSalStage(lead.stage)) sal += 1
    if (isEngagedStage(lead.stage)) engaged += 1
    if (typeof lead.stage === 'string' && lead.stage.toLowerCase().includes('won')) {
      bookings += 1
    }
  }
  // Surfaced in _debug so an unrecognised Streak stage shows up as a bucket that
  // never lands in SAL, instead of silently deflating the variant.
  debug.stagesSeen = stagesSeen

  const leads = streakFiltered.length
  const qualityRate = leads > 0 ? (ql / leads) * 100 : 0
  const cpl = leads > 0 ? spend / leads : null
  const cpql = ql > 0 ? spend / ql : null
  const salRate = leads > 0 ? (sal / leads) * 100 : 0
  const cpsal = sal > 0 ? spend / sal : null
  const engagedRate = leads > 0 ? (engaged / leads) * 100 : 0
  const cpEngaged = engaged > 0 ? spend / engaged : null

  return {
    spend,
    clicks,
    lpViews,
    leads,
    ql,
    qualityRate,
    cpl,
    cpql,
    sal,
    salRate,
    cpsal,
    engaged,
    engagedRate,
    cpEngaged,
    bookings,
    rvc: 0,
  }
}

export async function GET() {
  try {
    const [testsRaw, fbRows, streakRows, variantRows] = await Promise.all([
      fetchTestTracker(fetchSheet),
      fetchFbEnriched(fetchSheet),
      fetchStreakSync(fetchSheet),
      fetchTestVariants(fetchSheet),
    ])

    const campaignSamples = fbRows.slice(0, 5).map((r) => r.campaign_name)
    const fbDataRaw = fbRows.map((r) => [r.campaign_name, (r as any).date_iso ?? (r as any).date ?? (r as any).date_start, r.spend])
    const streakDataRaw = streakRows.map((r) => [r.inquiry_date, r.source_placement])

    const tests: TestWithVariants[] = testsRaw.map((test, index) => {
      const sheetRowIndex = index + 2 // row 1 = header, data starts at row 2
      // "Campaign(s)" format: "<variant A>, <variant B>".
      // Each side may list several campaigns joined by '|' — used when one test runs
      // across parallel campaigns (e.g. CRO-004 runs the same form test on three
      // vessels) and only the pooled sample is big enough to read.
      const sides = (test.campaigns || '').split(',').map((s) => s.trim())
      const splitSide = (side: string) =>
        side
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
      const campaignsA = splitSide(sides[0] || '')
      const campaignsB = splitSide(sides[1] || '')
      const campaignA = campaignsA.join(' | ')
      const campaignB = campaignsB.join(' | ')
      const setA = new Set(campaignsA)
      const setB = new Set(campaignsB)
      const startDate = parseDate(test.start_date)
      const endDate = parseDate(test.end_date)

      const debugA: VariantDebug = { fbMatched: 0, streakMatched: 0 }
      const debugB: VariantDebug = { fbMatched: 0, streakMatched: 0 }

      // Debug: find ANY fb rows matching campaign names, ignoring dates
      const fbMatchesA_noDate = fbDataRaw.filter((row) => setA.has(String(row[0] || '').trim())).length

      const fbMatchesB_noDate = fbDataRaw.filter((row) => setB.has(String(row[0] || '').trim())).length

      // Debug: show first 3 matching rows for A
      const fbSampleMatchingA = fbDataRaw
        .filter((row) => setA.has(String(row[0] || '').trim()))
        .slice(0, 3)
        .map((row) => ({ name: String(row[0]).trim(), date: row[1], spend: row[2] }))

      // Debug: show first 3 matching rows for B
      const fbSampleMatchingB = fbDataRaw
        .filter((row) => setB.has(String(row[0] || '').trim()))
        .slice(0, 3)
        .map((row) => ({ name: String(row[0]).trim(), date: row[1], spend: row[2] }))

      // Debug: streak B matching - show placements containing "individual"
      const streakIndividualPlacements = streakDataRaw
        .filter((row) => String(row[1] || '').toLowerCase().includes('individual'))
        .slice(0, 10)
        .map((row) => String(row[1]))

      // Use frozen data for done/killed tests if available
      const isDone = ['done', 'killed'].includes(test.status.toLowerCase())
      let variants: { A: VariantMetrics; B: VariantMetrics }
      let frozen = false

      const hsA = hubspotVariantFrom(variantRows.find((v) => v.test_id === test.test_id && v.variant === 'A'))
      const hsB = hubspotVariantFrom(variantRows.find((v) => v.test_id === test.test_id && v.variant === 'B'))

      if (hsA && hsB) {
        variants = { A: hsA, B: hsB }
      } else if (isDone && test.frozen_variants) {
        try {
          variants = JSON.parse(test.frozen_variants)
          frozen = true
        } catch {
          variants = {
            A: aggregateVariant(campaignsA, startDate, endDate, fbRows, streakRows, debugA),
            B: aggregateVariant(campaignsB, startDate, endDate, fbRows, streakRows, debugB),
          }
        }
      } else {
        variants = {
          A: aggregateVariant(campaignsA, startDate, endDate, fbRows, streakRows, debugA),
          B: aggregateVariant(campaignsB, startDate, endDate, fbRows, streakRows, debugB),
        }
      }

      return {
        ...test,
        variants,
        frozen,
        sheetRowIndex,
        _debug: {
          campaignA,
          campaignB,
          fbRowsTotal: fbRows.length,
          fbSampleNames: campaignSamples,
          fbMatchesA: fbRows.filter((row) => {
            const camp = (row.campaign_name || '').trim()
            if (!camp) return false
            if (!setA.has(camp)) return false
            if (startDate) {
              const d = parseDate((row as any).date_iso ?? (row as any).date ?? (row as any).date_start)
              if (!d || d < startDate) return false
            }
            return true
          }).length,
          fbMatchesB: fbRows.filter((row) => {
            const camp = (row.campaign_name || '').trim()
            if (!camp) return false
            if (!setB.has(camp)) return false
            if (startDate) {
              const d = parseDate((row as any).date_iso ?? (row as any).date ?? (row as any).date_start)
              if (!d || d < startDate) return false
            }
            return true
          }).length,
          fbMatchesA_noDate,
          fbMatchesB_noDate,
          fbSampleMatchingA,
          fbSampleMatchingB,
          streakRowsTotal: streakRows.length,
          streakSamplePlacements: streakRows.slice(0, 5).map((r) => r.source_placement),
          streakMatchesA: streakRows.filter((lead) => {
            if (startDate) {
              const d = parseDate(lead.inquiry_date)
              if (!d || d < startDate) return false
            }
            return campaignsA.some((c) => leadMatchesCampaign(lead, c))
          }).length,
          streakMatchesB: streakRows.filter((lead) => {
            if (startDate) {
              const d = parseDate(lead.inquiry_date)
              if (!d || d < startDate) return false
            }
            return campaignsB.some((c) => leadMatchesCampaign(lead, c))
          }).length,
          streakIndividualPlacements,
          stagesSeenA: debugA.stagesSeen,
          stagesSeenB: debugB.stagesSeen,
          startDate: test.start_date,
        },
      }
    })

    return NextResponse.json(tests)
  } catch (error) {
    console.error('[api/test-tracker] failed', error)
    return NextResponse.json({ error: 'Failed to load test tracker' }, { status: 500 })
  }
}
