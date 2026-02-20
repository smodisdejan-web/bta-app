import { NextResponse } from 'next/server'
import { fetchSheet, fetchStreakSync } from '@/lib/sheetsData'
import { addGoogleAiMetrics, aggregateGoogleByCampaign, fetchGoogleAds } from '@/lib/google-ads'

function inLast30Days(dateStr?: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (Number.isNaN(+d)) return false
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(end.getDate() - 29)
  start.setHours(0, 0, 0, 0)
  return d >= start && d <= end
}

export async function GET() {
  try {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const start = new Date(end)
    start.setDate(end.getDate() - 29)
    start.setHours(0, 0, 0, 0)

    const streakAll = (await fetchStreakSync(fetchSheet)) || []
    const googleLeads = streakAll.filter((l: any) => (l.platform || '').toLowerCase() === 'google')
    const googleLeads30d = googleLeads.filter((l: any) => inLast30Days(l.inquiry_date))
    const googleQL30d = googleLeads30d.filter((l: any) => (l.ai_score || 0) >= 50)

    const rawCampaigns = await fetchGoogleAds()
    const campaigns = aggregateGoogleByCampaign(rawCampaigns)
    const campaigns30d = campaigns.filter((c) => inLast30Days(c.date))
    const campaignNames = [...new Set(campaigns.map((c) => c.campaign))]

    const spend30d = campaigns
      .filter((c) => inLast30Days(c.date))
      .reduce((sum, c) => sum + (c.spend || 0), 0)

    // Build mapping similar to addGoogleAiMetrics
    const mapping = new Map<string, string>()
    const leadsByCampaign = new Map<string, any[]>()
    const uniqueSources = new Set<string>()
    let matched = 0

    // Inline match logic mirroring addGoogleAiMetrics
    for (const lead of googleLeads30d) {
      uniqueSources.add(lead.source_detail || '')
      const sourceDetail = (lead.source_detail || '').toLowerCase().trim()
      let matchedCampaign: string | null = null

      if (sourceDetail.includes('brand')) {
        matchedCampaign = campaigns.find((c) => c.campaign.toLowerCase().includes('brand'))?.campaign || null
      } else if (sourceDetail.includes('uk, ca, aus') || sourceDetail.includes('uk,ca,aus')) {
        matchedCampaign = campaigns.find((c) =>
          c.campaign.toLowerCase().includes('performance') && c.campaign.toLowerCase().includes('uk')
        )?.campaign || null
      } else if (sourceDetail.includes('perfromance max') || sourceDetail.includes('performance max') || sourceDetail.includes('top 17')) {
        matchedCampaign = campaigns.find((c) =>
          c.campaign.toLowerCase().includes('performance') && c.campaign.toLowerCase().includes('eu')
        )?.campaign || null
        if (!matchedCampaign) {
          matchedCampaign = campaigns.find((c) =>
            c.campaign.toLowerCase().includes('performance max') || c.campaign.toLowerCase().includes('perfromance max')
          )?.campaign || null
        }
      } else if (sourceDetail.includes('sem') || sourceDetail.includes('tofu')) {
        matchedCampaign = campaigns.find((c) =>
          c.campaign.toLowerCase().includes('search') &&
          c.campaign.toLowerCase().includes('croatia') &&
          c.campaign.toLowerCase().includes('en')
        )?.campaign || null
      }

      if (matchedCampaign) {
        matched++
        mapping.set(lead.source_detail, matchedCampaign)
        const arr = leadsByCampaign.get(matchedCampaign) || []
        arr.push(lead)
        leadsByCampaign.set(matchedCampaign, arr)
      }
    }

    const unmatchedSources: { source: string; total: number; ql: number }[] = []
    const sourceCounts = new Map<string, { total: number; ql: number }>()
    for (const lead of googleLeads30d) {
      const key = lead.source_detail || '(empty)'
      const bucket = sourceCounts.get(key) || { total: 0, ql: 0 }
      bucket.total += 1
      if ((lead.ai_score || 0) >= 50) bucket.ql += 1
      sourceCounts.set(key, bucket)
    }
    for (const [source, counts] of sourceCounts.entries()) {
      if (!mapping.has(source)) {
        unmatchedSources.push({ source, total: counts.total, ql: counts.ql })
      }
    }
    unmatchedSources.sort((a, b) => b.ql - a.ql)

    // Quality leads per campaign (including Unknown Google)
    const qlPerCampaign: Record<string, number> = {}
    for (const [camp, leads] of leadsByCampaign.entries()) {
      const ql = leads.filter((l) => (l.ai_score || 0) >= 50).length
      qlPerCampaign[camp] = ql
    }
    const unknownQL = unmatchedSources.reduce((sum, u) => sum + u.ql, 0)
    if (unknownQL > 0) {
      qlPerCampaign['Unknown Google'] = unknownQL
    }

    const expectedCpql = googleQL30d.length > 0 ? spend30d / googleQL30d.length : 0

    return NextResponse.json({
      date_range: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
      total_google_leads: googleLeads.length,
      total_google_leads_30d: googleLeads30d.length,
      quality_leads_30d: googleQL30d.length,
      total_spend_30d: spend30d,
      matched_sources: mapping.size,
      unmatched_sources: unmatchedSources.length,
      unmatched_examples: unmatchedSources.slice(0, 15),
      quality_leads_per_campaign: qlPerCampaign,
      expected_cpql: expectedCpql,
      actual_campaigns: campaignNames,
    })
  } catch (error: any) {
    console.error('[google-matching] error', error)
    return NextResponse.json({ error: error?.message || 'Failed to compute' }, { status: 500 })
  }
}
