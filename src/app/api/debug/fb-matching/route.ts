import { NextResponse } from 'next/server'
import { fetchFbEnriched, fetchSheet, fetchStreakSync } from '@/lib/sheetsData'
import { matchLeadsToCampaigns } from '@/lib/fuzzy-match'

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
    const streakAll = (await fetchStreakSync(fetchSheet)) || []
    const fbLeads = streakAll.filter((l: any) => (l.platform || '').toLowerCase() === 'facebook')
    const fbLeads30d = fbLeads.filter((l: any) => inLast30Days(l.inquiry_date))
    const fbQL30d = fbLeads30d.filter((l: any) => (l.ai_score || 0) >= 50)

    const fbRows = await fetchFbEnriched(fetchSheet)
    const fbCampaigns = fbRows.map((r: any) => r.campaign_name)
    const spend30d = fbRows
      .filter((r: any) => inLast30Days((r as any).date_iso || (r as any).date_start))
      .reduce((sum: number, r: any) => sum + (r.spend || 0), 0)

    const mapping = matchLeadsToCampaigns(fbLeads30d, fbCampaigns)
    const uniqueSources = [...new Set(fbLeads30d.map((l: any) => l.source_placement))]
    const unmatched = uniqueSources.filter((s) => !mapping.has(s))

    const expectedCpql = fbQL30d.length > 0 ? spend30d / fbQL30d.length : 0

    return NextResponse.json({
      total_fb_leads: fbLeads.length,
      total_fb_leads_30d: fbLeads30d.length,
      quality_leads_30d: fbQL30d.length,
      total_spend_30d: spend30d,
      matched_sources: mapping.size,
      unmatched_sources: unmatched.length,
      unmatched_examples: unmatched.slice(0, 15),
      expected_cpql: expectedCpql,
    })
  } catch (error: any) {
    console.error('[fb-matching] error', error)
    return NextResponse.json({ error: error?.message || 'Failed to compute' }, { status: 500 })
  }
}
