import { NextResponse } from 'next/server'

import {
  fetchFbEnriched,
  fetchSheet,
  fetchStreakSync,
  fetchTestTracker,
  type FbEnrichedRow,
  type StreakLeadRow,
  type TestTrackerRow,
} from '@/lib/sheetsData'

export const dynamic = 'force-dynamic'

type VariantMetrics = {
  spend: number
  clicks: number
  lpViews: number
  leads: number
  ql: number
  qualityRate: number
  cpl: number | null
  cpql: number | null
  bookings: number
  rvc: number
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
  return values.reduce((acc, v) => acc + (Number(v) || 0), 0)
}

function aggregateVariant(
  campaignRaw: string,
  startDate: Date | null,
  fbRows: FbEnrichedRow[],
  streakRows: StreakLeadRow[],
  debug: { fbMatched: number; streakMatched: number }
): VariantMetrics {
  const campaign = (campaignRaw || '').trim()
  if (!campaign) {
    return {
      spend: 0,
      clicks: 0,
      lpViews: 0,
      leads: 0,
      ql: 0,
      qualityRate: 0,
      cpl: null,
      cpql: null,
      bookings: 0,
      rvc: 0,
    }
  }

  const fbFiltered = fbRows.filter((row, idx) => {
    // drop header/formula artifacts where date is missing
    const camp = (row.campaign_name || '').trim()
    if (!camp) return false
    if (camp !== campaign) return false
    const rowDate = getRowDate(row)
    if (!rowDate) return false
    if (startDate && rowDate < startDate) return false
    return true
  })
  debug.fbMatched = fbFiltered.length

  const isLfCampaign = campaign.toLowerCase().startsWith('lf')
  const spend = sumSafe(fbFiltered.map((r) => parseFloat(String(r.spend)) || 0))
  const clicks = sumSafe(fbFiltered.map((r) => parseFloat(String(r.clicks)) || 0))
  const lpViews = sumSafe(fbFiltered.map((r) => parseFloat(String(r.lp_views)) || 0))
  const leads = sumSafe(
    fbFiltered.map((r) =>
      isLfCampaign ? parseFloat(String(r.fb_form_leads)) || 0 : parseFloat(String(r.landing_leads)) || 0
    )
  )

  const streakFiltered = streakRows.filter((lead) => {
    if (startDate) {
      const d = parseDate(lead.inquiry_date)
      if (!d || d < startDate) return false
    }
    return sourceMatchesCampaign(lead.source_placement, campaign)
  })
  debug.streakMatched = streakFiltered.length

  let ql = 0
  let bookings = 0
  for (const lead of streakFiltered) {
    const aiRaw = (lead.ai_score as unknown) ?? (lead as any).ai ?? 0
    let ai = Number(aiRaw)
    if (Number.isNaN(ai)) {
      ai = Number.parseFloat(String(aiRaw).replace(',', '.'))
      if (Number.isNaN(ai)) ai = 0
    }
    if (ai >= 50) ql += 1
    if (typeof lead.stage === 'string' && lead.stage.toLowerCase().includes('won')) {
      bookings += 1
    }
  }

  const qualityRate = leads > 0 ? (ql / leads) * 100 : 0
  const cpl = leads > 0 ? spend / leads : null
  const cpql = ql > 0 ? spend / ql : null

  return {
    spend,
    clicks,
    lpViews,
    leads,
    ql,
    qualityRate,
    cpl,
    cpql,
    bookings,
    rvc: 0,
  }
}

export async function GET() {
  try {
    const [testsRaw, fbRows, streakRows] = await Promise.all([
      fetchTestTracker(fetchSheet),
      fetchFbEnriched(fetchSheet),
      fetchStreakSync(fetchSheet),
    ])

    const campaignSamples = fbRows.slice(0, 5).map((r) => r.campaign_name)
    const fbDataRaw = fbRows.map((r) => [r.campaign_name, (r as any).date_iso ?? (r as any).date ?? (r as any).date_start, r.spend])
    const streakDataRaw = streakRows.map((r) => [r.inquiry_date, r.source_placement])

    const tests: TestWithVariants[] = testsRaw.map((test) => {
      const campaigns = (test.campaigns || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
      const campaignA = campaigns[0] || ''
      const campaignB = campaigns[1] || ''
      const startDate = parseDate(test.start_date)

      const debugA = { fbMatched: 0, streakMatched: 0 }
      const debugB = { fbMatched: 0, streakMatched: 0 }

      // Debug: find ANY fb rows matching campaign names, ignoring dates
      const fbMatchesA_noDate = fbDataRaw.filter((row) => {
        const name = String(row[0] || '').trim()
        return name === campaignA
      }).length

      const fbMatchesB_noDate = fbDataRaw.filter((row) => {
        const name = String(row[0] || '').trim()
        return name === campaignB
      }).length

      // Debug: show first 3 matching rows for A
      const fbSampleMatchingA = fbDataRaw
        .filter((row) => String(row[0] || '').trim() === campaignA)
        .slice(0, 3)
        .map((row) => ({ name: String(row[0]).trim(), date: row[1], spend: row[2] }))

      // Debug: show first 3 matching rows for B
      const fbSampleMatchingB = fbDataRaw
        .filter((row) => String(row[0] || '').trim() === campaignB)
        .slice(0, 3)
        .map((row) => ({ name: String(row[0]).trim(), date: row[1], spend: row[2] }))

      // Debug: streak B matching - show placements containing "individual"
      const streakIndividualPlacements = streakDataRaw
        .filter((row) => String(row[1] || '').toLowerCase().includes('individual'))
        .slice(0, 10)
        .map((row) => String(row[1]))

      const variants = {
        A: aggregateVariant(campaignA, startDate, fbRows, streakRows, debugA),
        B: aggregateVariant(campaignB, startDate, fbRows, streakRows, debugB),
      }

      return {
        ...test,
        variants,
        _debug: {
          campaignA,
          campaignB,
          fbRowsTotal: fbRows.length,
          fbSampleNames: campaignSamples,
          fbMatchesA: fbRows.filter((row) => {
            const camp = (row.campaign_name || '').trim()
            if (!camp) return false
            if (camp !== campaignA.trim()) return false
            if (startDate) {
              const d = parseDate(row.date)
              if (!d || d < startDate) return false
            }
            return true
          }).length,
          fbMatchesB: fbRows.filter((row) => {
            const camp = (row.campaign_name || '').trim()
            if (!camp) return false
            if (camp !== campaignB.trim()) return false
            if (startDate) {
              const d = parseDate(row.date)
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
            return sourceMatchesCampaign(lead.source_placement, campaignA)
          }).length,
          streakMatchesB: streakRows.filter((lead) => {
            if (startDate) {
              const d = parseDate(lead.inquiry_date)
              if (!d || d < startDate) return false
            }
            return sourceMatchesCampaign(lead.source_placement, campaignB)
          }).length,
          streakIndividualPlacements,
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
