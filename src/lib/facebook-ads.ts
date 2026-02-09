// src/lib/facebook-ads.ts
import { DEFAULT_WEB_APP_URL, getSheetsUrl } from './config'
import { fetchFbEnriched, fetchSheet, FbEnrichedRow, fetchStreakSyncFb, StreakLeadRow } from './sheetsData'
import { matchLeadsToCampaigns } from './fuzzy-match'

export interface FacebookAdRecord {
  date: string
  campaign: string
  spend: number
  clicks: number
  lpViews: number
  fbFormLeads: number
  landingLeads: number
  impressions?: number
  totalLeads?: number
  qualityLeads?: number
  excellentLeads?: number
  qualityRate?: number
  avgAiScore?: number
  cpql?: number
  [key: string]: any
}

// Cached Streak leads to reuse in page-level aggregation
let cachedStreakLeads: StreakLeadRow[] | null = null

// Map enriched rows to FacebookAdRecord format
function mapEnrichedToRecord(row: FbEnrichedRow): FacebookAdRecord {
  return {
    date: row.date_iso || row.date_start, // Prefer date_iso for filtering, fallback to date_start
    campaign: row.campaign_name,
    spend: row.spend,
    clicks: row.clicks,
    lpViews: row.lp_views,
    fbFormLeads: row.fb_form_leads,
    landingLeads: row.landing_leads,
    impressions: undefined, // Not in enriched data
  }
}

export async function fetchFacebookAds(sheetUrl: string = getSheetsUrl() || DEFAULT_WEB_APP_URL): Promise<FacebookAdRecord[]> {
  try {
    const [enrichedRows, streakLeads] = await Promise.all([
      fetchFbEnriched(fetchSheet),
      fetchStreakSyncFb(fetchSheet)
    ])

    // Cache streak leads for later aggregation
    cachedStreakLeads = streakLeads

    // Return raw records with dates; page handles filtering/aggregation
    return enrichedRows.map(mapEnrichedToRecord)
  } catch (error) {
    console.error('Error fetching Facebook Ads:', error)
    return []
  }
}

export function getStreakLeads(): StreakLeadRow[] {
  return cachedStreakLeads || []
}

export function aggregateByCampaign(records: FacebookAdRecord[]): FacebookAdRecord[] {
  const campaignMap = new Map<string, FacebookAdRecord>()
  
  // First, deduplicate by campaign+date to avoid double counting
  const deduplicated = new Map<string, FacebookAdRecord>()
  for (const record of records) {
    const key = `${record.campaign}::${record.date}`
    if (!deduplicated.has(key)) {
      deduplicated.set(key, { ...record })
    } else {
      // If same campaign+date exists, sum the values (in case of duplicates)
      const existing = deduplicated.get(key)!
      existing.spend += record.spend
      existing.clicks += record.clicks
      existing.lpViews += record.lpViews
      existing.fbFormLeads += record.fbFormLeads
      existing.landingLeads += record.landingLeads
      if (record.impressions) {
        existing.impressions = (existing.impressions || 0) + record.impressions
      }
    }
  }
  
  // Now aggregate by campaign (sum across all dates)
  for (const record of Array.from(deduplicated.values())) {
    const existing = campaignMap.get(record.campaign)
    
    if (existing) {
      existing.spend += record.spend
      existing.clicks += record.clicks
      existing.lpViews += record.lpViews
      existing.fbFormLeads += record.fbFormLeads
      existing.landingLeads += record.landingLeads
      if (record.impressions) {
        existing.impressions = (existing.impressions || 0) + (record.impressions || 0)
      }
    } else {
      // Create a fresh copy to avoid reference issues
      campaignMap.set(record.campaign, {
        date: record.date || '', // retain date if present
        campaign: record.campaign,
        spend: record.spend,
        clicks: record.clicks,
        lpViews: record.lpViews,
        fbFormLeads: record.fbFormLeads,
        landingLeads: record.landingLeads,
        impressions: record.impressions,
      })
    }
  }
  
  return Array.from(campaignMap.values())
}

export function calculateTotals(records: FacebookAdRecord[]) {
  return records.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      clicks: acc.clicks + r.clicks,
      lpViews: acc.lpViews + r.lpViews,
      fbFormLeads: acc.fbFormLeads + r.fbFormLeads,
      landingLeads: acc.landingLeads + r.landingLeads,
    }),
    { spend: 0, clicks: 0, lpViews: 0, fbFormLeads: 0, landingLeads: 0 }
  )
}

// Attach AI metrics to campaigns using Streak leads (optionally filtered by date)
export function addAiMetrics(
  campaigns: FacebookAdRecord[],
  startDate?: string,
  endDate?: string
): FacebookAdRecord[] {
  let streakLeads = getStreakLeads()
  if (streakLeads.length === 0) return campaigns

  // Filter Streak leads by date range if provided
  if (startDate && endDate) {
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)
    streakLeads = streakLeads.filter(lead => {
      if (!lead.inquiry_date) return false
      const d = new Date(lead.inquiry_date)
      return d >= start && d <= end
    })
    console.log(`[AI Metrics] Filtered streak leads: ${streakLeads.length} in range ${startDate} to ${endDate}`)
  }

  const campaignNames = campaigns.map(c => c.campaign)
  const mapping = matchLeadsToCampaigns(streakLeads, campaignNames)

  const leadsByCampaign = new Map<string, StreakLeadRow[]>()
  for (const lead of streakLeads) {
    const campaign = mapping.get(lead.source_placement)
    if (campaign) {
      const arr = leadsByCampaign.get(campaign) || []
      arr.push(lead)
      leadsByCampaign.set(campaign, arr)
    }
  }

  return campaigns.map(campaign => {
    const leads = leadsByCampaign.get(campaign.campaign) || []
    const leadsWithAi = leads.filter(l => l.ai_score > 0)
    const totalLeads = leadsWithAi.length
    const qualityLeads = leadsWithAi.filter(l => l.ai_score >= 50).length
    const excellentLeads = leadsWithAi.filter(l => l.ai_score >= 70).length
    const avgAiScore = totalLeads > 0
      ? Math.round(leadsWithAi.reduce((sum, l) => sum + l.ai_score, 0) / totalLeads)
      : 0
    const qualityRate = totalLeads > 0
      ? Math.round((qualityLeads / totalLeads) * 100)
      : 0
    const cpql = qualityLeads > 0 ? Math.round((campaign.spend / qualityLeads) * 100) / 100 : 0

    return {
      ...campaign,
      totalLeads,
      qualityLeads,
      excellentLeads,
      qualityRate,
      avgAiScore,
      cpql
    }
  })
}

