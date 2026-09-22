// src/lib/facebook-ads.ts
import { DEFAULT_WEB_APP_URL, getSheetsUrl, SHEETS_TABS } from './config'
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

/**
 * Daily FB spend from `fb_ads_api` — pulled straight from Meta by
 * code/facebook/sync-fb-ads-api.js. Keyed `YYYY-MM-DD::campaign`.
 *
 * Why this exists (2026-08-17): `fb_ads_enriched` is a Mixed Analytics feed and its spend column
 * is not trustworthy. It stopped producing rows on 2026-08-09, and on several August days it
 * reported €48k–€94k where real spend was ~€2.5k. Overview therefore showed €23.898 of FB spend
 * for 1.–16.8. against a true €36.282, understating total spend by €12.4k and printing ROAS 3,31x
 * when the real figure was 2,52x — the difference between reading "above ROMI break-even" and
 * below it. Leads and LP views still come from enriched; only spend is overridden.
 */
async function fetchFbSpendDaily(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const rows = await fetchSheet({ sheetUrl: getSheetsUrl() || DEFAULT_WEB_APP_URL, tab: SHEETS_TABS.FB_SPEND_DAILY })
    if (!Array.isArray(rows) || rows.length === 0) return out
    for (const r of rows as any[]) {
      const date = String((Array.isArray(r) ? r[0] : r.date) ?? '').slice(0, 10)
      const campaign = String((Array.isArray(r) ? r[1] : r.campaign) ?? '').trim()
      const spend = Number((Array.isArray(r) ? r[2] : r.spend) ?? NaN)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaign || !Number.isFinite(spend)) continue
      out.set(`${date}::${campaign}`, spend)
    }
  } catch (e) {
    console.warn('[facebook-ads] fb_ads_api unavailable, keeping enriched spend', e)
  }
  return out
}

export async function fetchFacebookAds(sheetUrl: string = getSheetsUrl() || DEFAULT_WEB_APP_URL): Promise<FacebookAdRecord[]> {
  try {
    const [enrichedRows, streakLeads, spendDaily] = await Promise.all([
      fetchFbEnriched(fetchSheet),
      fetchStreakSyncFb(fetchSheet),
      fetchFbSpendDaily()
    ])

    // Cache streak leads for later aggregation
    cachedStreakLeads = streakLeads

    const records = enrichedRows.map(mapEnrichedToRecord)

    if (spendDaily.size > 0) {
      // Authoritative spend wins wherever Meta has a figure for that (date, campaign).
      const seen = new Set<string>()
      for (const rec of records) {
        const key = `${String(rec.date).slice(0, 10)}::${rec.campaign}`
        seen.add(key)
        const actual = spendDaily.get(key)
        if (actual != null) rec.spend = actual
      }
      // Days the enriched feed never delivered (it died on 2026-08-09) would otherwise be counted
      // as zero spend, so add them back with spend only — leads/LP views stay 0 because enriched
      // is the only source for those and it genuinely has no data for those days.
      for (const [key, spend] of spendDaily) {
        if (seen.has(key)) continue
        const [date, campaign] = key.split('::')
        records.push({ date, campaign, spend, clicks: 0, lpViews: 0, fbFormLeads: 0, landingLeads: 0 })
      }
    }

    // Return raw records with dates; page handles filtering/aggregation
    return records
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

