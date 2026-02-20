import { DEFAULT_WEB_APP_URL, SHEETS_TABS, getSheetsUrl } from './config'
import { fetchSheet, fetchStreakSyncGoogle, StreakLeadRow } from './sheetsData'

export interface GoogleAdRecord {
  date: string
  campaign: string
  campaignId: string
  adGroup: string
  adGroupId: string
  spend: number
  clicks: number
  impressions: number
  conversions: number
  value: number
  cpc: number
  ctr: number
  convRate: number
  cpa: number
  roas: number
  totalLeads?: number
  qualityLeads?: number
  excellentLeads?: number
  qualityRate?: number
  avgAiScore?: number
  cpql?: number
}

let cachedGoogleStreakLeads: StreakLeadRow[] | null = null

export function getGoogleStreakLeads(): StreakLeadRow[] {
  return cachedGoogleStreakLeads || []
}

// Fetch Google Ads data from DAILY tab (includes all campaign types)
export async function fetchGoogleAds(sheetUrl?: string): Promise<GoogleAdRecord[]> {
  try {
    const [rawData, streakLeads] = await Promise.all([
      fetchSheet({
        sheetUrl: sheetUrl || getSheetsUrl() || DEFAULT_WEB_APP_URL,
        tab: SHEETS_TABS.DAILY
      }),
      fetchStreakSyncGoogle(fetchSheet)
    ])

    cachedGoogleStreakLeads = streakLeads
    if (!rawData || rawData.length < 2) return []

    const [header, ...rows] = rawData
    const colIndex = (name: string) => header.findIndex((h: string) =>
      String(h).toLowerCase() === name.toLowerCase()
    )

    return rows.map((row: any[]) => ({
      date: String(row[colIndex('date')] || ''),
      campaign: String(row[colIndex('campaign')] || ''),
      campaignId: String(row[colIndex('campaignid')] || row[colIndex('campaign_id')] || ''),
      adGroup: '',
      adGroupId: '',
      spend: Number(row[colIndex('cost')]) || 0,
      clicks: Number(row[colIndex('clicks')]) || 0,
      impressions: Number(row[colIndex('impr')]) || 0,
      conversions: Number(row[colIndex('conv')]) || 0,
      value: Number(row[colIndex('value')]) || 0,
      cpc: 0,
      ctr: 0,
      convRate: 0,
      cpa: 0,
      roas: 0,
    }))
  } catch (error) {
    console.error('Error fetching Google Ads:', error)
    return []
  }
}

export function aggregateGoogleByCampaign(records: GoogleAdRecord[]): GoogleAdRecord[] {
  const campaignMap = new Map<string, GoogleAdRecord>()
  for (const record of records) {
    const existing = campaignMap.get(record.campaign)
    if (existing) {
      existing.spend += record.spend
      existing.clicks += record.clicks
      existing.impressions += record.impressions
      existing.conversions += record.conversions
      existing.value += record.value
    } else {
      campaignMap.set(record.campaign, { ...record, date: '' })
    }
  }
  return Array.from(campaignMap.values()).map(c => ({
    ...c,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
    convRate: c.clicks > 0 ? c.conversions / c.clicks : 0,
    cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
    roas: c.spend > 0 ? c.value / c.spend : 0,
  }))
}

export function addGoogleAiMetrics(
  campaigns: GoogleAdRecord[],
  startDate?: string,
  endDate?: string
): GoogleAdRecord[] {
  let streakLeads = getGoogleStreakLeads()
  if (streakLeads.length === 0) return campaigns

  if (startDate && endDate) {
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)
    streakLeads = streakLeads.filter(lead => {
      if (!lead.inquiry_date) return false
      const d = new Date(lead.inquiry_date)
      return d >= start && d <= end
    })
  }

  const leadsByCampaign = new Map<string, StreakLeadRow[]>()
  const unknownBucket: StreakLeadRow[] = []
  let matchedCount = 0

  for (const lead of streakLeads) {
    const sourceDetail = (lead.source_detail || '').toLowerCase().trim()
    let matchedCampaign: string | null = null

    if (sourceDetail.includes('brand')) {
      matchedCampaign = campaigns.find(c => c.campaign.toLowerCase().includes('brand'))?.campaign || null
    } else if (sourceDetail.includes('uk, ca, aus') || sourceDetail.includes('uk,ca,aus')) {
      matchedCampaign = campaigns.find(c =>
        c.campaign.toLowerCase().includes('performance') && c.campaign.toLowerCase().includes('uk')
      )?.campaign || null
    } else if (sourceDetail.includes('perfromance max') || sourceDetail.includes('performance max') || sourceDetail.includes('top 17')) {
      matchedCampaign = campaigns.find(c =>
        c.campaign.toLowerCase().includes('performance') && c.campaign.toLowerCase().includes('eu')
      )?.campaign || null
      if (!matchedCampaign) {
        matchedCampaign = campaigns.find(c =>
          c.campaign.toLowerCase().includes('performance max') || c.campaign.toLowerCase().includes('perfromance max')
        )?.campaign || null
      }
    } else if (sourceDetail.includes('sem') || sourceDetail.includes('tofu')) {
      matchedCampaign = campaigns.find(c =>
        c.campaign.toLowerCase().includes('search') &&
        c.campaign.toLowerCase().includes('croatia') &&
        c.campaign.toLowerCase().includes('en')
      )?.campaign || null
    } else if (sourceDetail.includes('latam') || sourceDetail.includes('latm')) {
      matchedCampaign = campaigns.find(c => c.campaign.toLowerCase().includes('latm'))?.campaign || null
    } else if (sourceDetail.includes('demand gen')) {
      matchedCampaign = campaigns.find(c => c.campaign.toLowerCase().includes('demand gen'))?.campaign || null
    }

    if (matchedCampaign) {
      const arr = leadsByCampaign.get(matchedCampaign) || []
      arr.push(lead)
      leadsByCampaign.set(matchedCampaign, arr)
      matchedCount++
    } else {
      unknownBucket.push(lead)
    }
  }

  console.log(`[Google AI] Matched ${matchedCount}/${streakLeads.length} leads to campaigns`)

  const augmented = campaigns.map(campaign => {
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
    const cpql = qualityLeads > 0
      ? Math.round((campaign.spend / qualityLeads) * 100) / 100
      : 0
    return {
      ...campaign,
      totalLeads,
      qualityLeads,
      excellentLeads,
      qualityRate,
      avgAiScore,
      cpql,
    }
  })

  if (unknownBucket.length > 0) {
    const leadsWithAi = unknownBucket.filter(l => l.ai_score > 0)
    const totalLeads = leadsWithAi.length
    const qualityLeads = leadsWithAi.filter(l => l.ai_score >= 50).length
    const excellentLeads = leadsWithAi.filter(l => l.ai_score >= 70).length
    const avgAiScore = totalLeads > 0
      ? Math.round(leadsWithAi.reduce((sum, l) => sum + l.ai_score, 0) / totalLeads)
      : 0
    const qualityRate = totalLeads > 0
      ? Math.round((qualityLeads / totalLeads) * 100)
      : 0
    augmented.push({
      date: '',
      campaign: 'Unknown Google',
      campaignId: '',
      adGroup: '',
      adGroupId: '',
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      value: 0,
      cpc: 0,
      ctr: 0,
      convRate: 0,
      cpa: 0,
      roas: 0,
      totalLeads,
      qualityLeads,
      excellentLeads,
      qualityRate,
      avgAiScore,
      cpql: 0,
    })
  }

  return augmented
}

export function calculateGoogleTotals(records: GoogleAdRecord[]) {
  return records.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
      conversions: acc.conversions + r.conversions,
      value: acc.value + r.value,
    }),
    { spend: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 }
  )
}

