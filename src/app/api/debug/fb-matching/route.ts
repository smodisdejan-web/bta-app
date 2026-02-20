import { NextResponse } from 'next/server'
import { fetchFbEnriched, fetchSheet, fetchStreakSync } from '@/lib/sheetsData'
import { matchLeadsToCampaigns, matchSourceToCampaign } from '@/lib/fuzzy-match'

export async function GET() {
  try {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const start = new Date(end)
    start.setDate(end.getDate() - 29)
    start.setHours(0, 0, 0, 0)

    const inRange = (dateStr?: string) => {
      if (!dateStr) return false
      const d = new Date(dateStr)
      if (Number.isNaN(+d)) return false
      return d >= start && d <= end
    }

    const streakAll = (await fetchStreakSync(fetchSheet)) || []
    const fbLeads = streakAll.filter((l: any) => (l.platform || '').toLowerCase() === 'facebook')
    const fbLeads30d = fbLeads.filter((l: any) => inRange(l.inquiry_date))
    const fbQL30d = fbLeads30d.filter((l: any) => (l.ai_score || 0) >= 50)

    const fbRows = await fetchFbEnriched(fetchSheet)
    const fbCampaigns = fbRows.map((r: any) => r.campaign_name)
    const spend30d = fbRows
      .filter((r: any) => inRange((r as any).date_iso || (r as any).date_start))
      .reduce((sum: number, r: any) => sum + (r.spend || 0), 0)

    const mapping = matchLeadsToCampaigns(fbLeads30d, fbCampaigns)
    const uniqueSources = [...new Set(fbLeads30d.map((l: any) => l.source_placement))]
    const unmatched = uniqueSources.filter((s) => !mapping.has(s))

    const perCampaignQl: Record<string, number> = {}
    fbQL30d.forEach((lead: any) => {
      const campaign =
        mapping.get(lead.source_placement) ||
        matchSourceToCampaign(lead.source_placement, fbCampaigns) ||
        'Unknown Facebook'
      perCampaignQl[campaign] = (perCampaignQl[campaign] || 0) + 1
    })

    const expectedCpql = fbQL30d.length > 0 ? spend30d / fbQL30d.length : 0

    return NextResponse.json({
      date_range: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
      total_fb_leads: fbLeads.length,
      total_fb_leads_30d: fbLeads30d.length,
      quality_leads_30d: fbQL30d.length,
      total_spend_30d: spend30d,
      matched_sources: mapping.size,
      unmatched_sources: unmatched.length,
      unmatched_examples: unmatched.slice(0, 15),
      expected_cpql: expectedCpql,
      quality_leads_per_campaign: perCampaignQl,
    })
  } catch (error: any) {
    console.error('[fb-matching] error', error)
    return NextResponse.json({ error: error?.message || 'Failed to compute' }, { status: 500 })
  }
}
