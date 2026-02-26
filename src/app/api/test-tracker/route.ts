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

function sourceMatchesCampaign(sourcePlacement: string, campaign: string) {
  const src = (sourcePlacement || '').toLowerCase()
  const camp = (campaign || '').toLowerCase()
  const variants = [
    camp,
    camp.replace(/[\s-]+/g, '_'),
    camp.replace(/[\s_]+/g, '-'),
    camp.replace(/[\s_-]+/g, ' '),
  ].filter(Boolean)
  return variants.some((v) => v && src.includes(v))
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

  const fbFiltered = fbRows.filter((row) => {
    const camp = (row.campaign_name || '').trim()
    if (!camp) return false
    if (camp !== campaign) return false
    if (startDate) {
      const d = parseDate(row.date)
      if (!d || d < startDate) return false
    }
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

      const variants = {
        A: aggregateVariant(campaignA, startDate, fbRows, streakRows, debugA),
        B: aggregateVariant(campaignB, startDate, fbRows, streakRows, debugB),
      }

      console.log('[test-tracker] campaigns', {
        test: test.test_id,
        campaignA,
        campaignB,
        fbMatchedA: debugA.fbMatched,
        fbMatchedB: debugB.fbMatched,
        streakMatchedA: debugA.streakMatched,
        streakMatchedB: debugB.streakMatched,
        sampleCampaigns: campaignSamples,
      })

      return { ...test, variants }
    })

    return NextResponse.json(tests)
  } catch (error) {
    console.error('[api/test-tracker] failed', error)
    return NextResponse.json({ error: 'Failed to load test tracker' }, { status: 500 })
  }
}
