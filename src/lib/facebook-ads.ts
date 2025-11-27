// src/lib/facebook-ads.ts
import { DEFAULT_WEB_APP_URL } from './config'
import { fetchFbEnriched, fetchSheet, FbEnrichedRow } from './sheetsData'

export interface FacebookAdRecord {
  date: string
  campaign: string
  spend: number
  clicks: number
  lpViews: number
  fbFormLeads: number
  landingLeads: number
  impressions?: number
  [key: string]: any
}

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

export async function fetchFacebookAds(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<FacebookAdRecord[]> {
  try {
    const enrichedRows = await fetchFbEnriched(fetchSheet)
    return enrichedRows.map(mapEnrichedToRecord)
  } catch (error) {
    console.error('Error fetching Facebook Ads:', error)
    return []
  }
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
        date: '', // No single date for aggregated campaign
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

