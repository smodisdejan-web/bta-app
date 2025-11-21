// src/lib/overview-data.ts
// Data fetching and aggregation for Overview page

import { FacebookAdRecord, HubSpotDeal, HubSpotContact, MarketingFunnelRecord, OverviewFilters, OverviewMetrics, DailyMetric, CampaignPerformance } from './overview-types'
import { useSettings } from './contexts/SettingsContext'

const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycby4WR2b5WyZ7qKcJvNUtYjGQPPVpJzFWAnF5SyJntvtNGwGaob-hCu4hAdECHmnRVfn/exec'

// Fetch Facebook Ads data
export async function fetchFacebookAds(sheetUrl: string = DEFAULT_SHEET_URL): Promise<FacebookAdRecord[]> {
  try {
    if (!sheetUrl) {
      console.warn('No sheet URL provided for Facebook Ads')
      return []
    }
    const url = `${sheetUrl}?tab=fb_ads_raw`
    const response = await fetch(url, { 
      cache: 'no-store'
    })
    if (!response.ok) {
      console.warn(`Failed to fetch fb_ads_raw (${response.status}): ${response.statusText}`)
      return []
    }
    const data = await response.json()
    if (!Array.isArray(data)) {
      console.warn('Facebook Ads data is not an array')
      return []
    }
    
    return data.map((row: any) => ({
      date: String(row['date'] || row['Date'] || ''),
      campaign: String(row['campaign'] || row['Campaign'] || ''),
      adset: row['adset'] || row['Adset'] || undefined,
      ad: row['ad'] || row['Ad'] || undefined,
      spend: Number(row['spend'] || row['Spend'] || 0),
      impressions: Number(row['impressions'] || row['Impressions'] || 0),
      clicks: Number(row['clicks'] || row['Clicks'] || 0),
      landing_page_view: Number(row['landing_page_view'] || row['Landing Page View'] || 0),
      landing_page_view_unique: Number(row['landing_page_view_unique'] || row['Landing Page View (Unique)'] || 0),
      ...row
    }))
  } catch (error) {
    console.error('Error fetching Facebook Ads:', error)
    return []
  }
}

// Fetch HubSpot Deals
export async function fetchHubSpotDeals(sheetUrl: string = DEFAULT_SHEET_URL): Promise<HubSpotDeal[]> {
  try {
    if (!sheetUrl) {
      console.warn('No sheet URL provided for HubSpot Deals')
      return []
    }
    const url = `${sheetUrl}?tab=hubspot_deals_raw`
    const response = await fetch(url, { 
      cache: 'no-store'
    })
    if (!response.ok) {
      console.warn(`Failed to fetch hubspot_deals_raw (${response.status}): ${response.statusText}`)
      return []
    }
    const data = await response.json()
    if (!Array.isArray(data)) {
      console.warn('HubSpot Deals data is not an array')
      return []
    }
    
    return data.map((row: any) => ({
      dealId: String(row['dealId'] || row['deal_id'] || row['hs_object_id'] || ''),
      dealname: String(row['dealname'] || row['deal_name'] || ''),
      amount: Number(row['amount'] || row['deal_amount'] || 0),
      closedate: String(row['closedate'] || row['close_date'] || ''),
      dealstage: String(row['dealstage'] || row['deal_stage'] || ''),
      createdate: String(row['createdate'] || row['create_date'] || ''),
      utm_source: row['utm_source'] || undefined,
      utm_medium: row['utm_medium'] || undefined,
      utm_campaign: row['utm_campaign'] || undefined,
      ...row
    }))
  } catch (error) {
    console.error('Error fetching HubSpot Deals:', error)
    return []
  }
}

// Fetch HubSpot Contacts (prefer 90d, fallback to raw)
export async function fetchHubSpotContacts(sheetUrl: string = DEFAULT_SHEET_URL): Promise<HubSpotContact[]> {
  try {
    if (!sheetUrl) {
      console.warn('No sheet URL provided for HubSpot Contacts')
      return []
    }
    // Try 90d first
    let url = `${sheetUrl}?tab=hubspot_contacts_90d`
    let response = await fetch(url, { 
      cache: 'no-store'
    })
    
    if (!response.ok) {
      // Fallback to raw
      url = `${sheetUrl}?tab=hubspot_contacts_raw`
      response = await fetch(url, { 
        cache: 'no-store'
      })
    }
    
    if (!response.ok) {
      console.warn(`Failed to fetch HubSpot contacts (${response.status}): ${response.statusText}`)
      return []
    }
    
    const data = await response.json()
    if (!Array.isArray(data)) {
      console.warn('HubSpot Contacts data is not an array')
      return []
    }
    
    return data.map((row: any) => ({
      contactId: String(row['contactId'] || row['contact_id'] || row['hs_object_id'] || ''),
      email: String(row['email'] || ''),
      createdate: String(row['createdate'] || row['create_date'] || ''),
      utm_source: row['utm_source'] || undefined,
      utm_medium: row['utm_medium'] || undefined,
      utm_campaign: row['utm_campaign'] || undefined,
      ...row
    }))
  } catch (error) {
    console.error('Error fetching HubSpot Contacts:', error)
    return []
  }
}

// Fetch Marketing Funnel (try named range first, then tab)
export async function fetchMarketingFunnel(sheetUrl: string = DEFAULT_SHEET_URL): Promise<MarketingFunnelRecord[]> {
  try {
    // Try named range first
    let url = `${sheetUrl}?tab=MARKETING_FUNNEL`
    let response = await fetch(url)
    
    if (!response.ok) {
      // Fallback to tab
      url = `${sheetUrl}?tab=marketing_funnel`
      response = await fetch(url)
    }
    
    if (!response.ok) {
      console.warn('Marketing funnel not found, returning empty array')
      return []
    }
    
    const data = await response.json()
    if (!Array.isArray(data)) return []
    
    return data.map((row: any) => ({
      date: String(row['date'] || row['Date'] || ''),
      lp_views: Number(row['lp_views'] || row['LP Views'] || 0),
      leads: Number(row['leads'] || row['Leads'] || 0),
      sql: Number(row['sql'] || row['SQL'] || 0),
      deals: Number(row['deals'] || row['Deals'] || 0),
      revenue: Number(row['revenue'] || row['Revenue'] || 0),
      ...row
    }))
  } catch (error) {
    console.error('Error fetching Marketing Funnel:', error)
    return []
  }
}

// Helper to get date range
export function getDateRange(range: '30d' | '60d' | '90d' | 'custom', customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  
  if (range === 'custom' && customStart && customEnd) {
    return {
      start: new Date(customStart),
      end: new Date(customEnd)
    }
  }
  
  const days = range === '30d' ? 30 : range === '60d' ? 60 : 90
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  
  return { start, end }
}

// Helper to check if date is in range
export function isDateInRange(dateStr: string, start: Date, end: Date): boolean {
  const date = new Date(dateStr)
  return date >= start && date <= end
}

// Check if contact came from paid channel
export function isPaidContact(contact: HubSpotContact): boolean {
  const source = (contact.utm_source || '').toLowerCase()
  const medium = (contact.utm_medium || '').toLowerCase()
  
  const paidSources = ['google', 'facebook', 'meta', 'cpc', 'paid', 'adwords', 'fb']
  const paidMediums = ['cpc', 'paid', 'social', 'display']
  
  return paidSources.includes(source) || paidMediums.includes(medium)
}

// Aggregate metrics for date range
export async function getOverviewMetrics(
  filters: OverviewFilters,
  sheetUrl: string = DEFAULT_SHEET_URL
): Promise<OverviewMetrics> {
  const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
  const prevStart = new Date(start)
  const prevEnd = new Date(end)
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  prevStart.setDate(prevStart.getDate() - daysDiff)
  prevEnd.setDate(prevEnd.getDate() - daysDiff)
  
  // Fetch all data
  const [fbAds, deals, contacts, funnel] = await Promise.all([
    fetchFacebookAds(sheetUrl),
    fetchHubSpotDeals(sheetUrl),
    fetchHubSpotContacts(sheetUrl),
    fetchMarketingFunnel(sheetUrl)
  ])
  
  // Filter by date range
  const currentFbAds = fbAds.filter(ad => isDateInRange(ad.date, start, end))
  const currentDeals = deals.filter(deal => {
    const closeDate = deal.closedate || deal.createdate
    return isDateInRange(closeDate, start, end)
  })
  const currentContacts = contacts.filter(contact => isDateInRange(contact.createdate, start, end))
  
  // Previous period
  const prevFbAds = filters.comparePrevious ? fbAds.filter(ad => isDateInRange(ad.date, prevStart, prevEnd)) : []
  const prevDeals = filters.comparePrevious ? deals.filter(deal => {
    const closeDate = deal.closedate || deal.createdate
    return isDateInRange(closeDate, prevStart, prevEnd)
  }) : []
  const prevContacts = filters.comparePrevious ? contacts.filter(contact => isDateInRange(contact.createdate, prevStart, prevEnd)) : []
  
  // Calculate metrics
  const wonDeals = currentDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
  })
  const revenueWon = wonDeals.reduce((sum, d) => sum + (d.amount || 0), 0)
  
  const prevWonDeals = filters.comparePrevious ? prevDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
  }) : []
  const prevRevenueWon = prevWonDeals.reduce((sum, d) => sum + (d.amount || 0), 0)
  
  const paidContacts = currentContacts.filter(isPaidContact)
  const prevPaidContacts = prevContacts.filter(isPaidContact)
  
  const spend = currentFbAds.reduce((sum, ad) => sum + (ad.spend || 0), 0)
  const prevSpend = prevFbAds.reduce((sum, ad) => sum + (ad.spend || 0), 0)
  
  const lpViews = currentFbAds.reduce((sum, ad) => 
    sum + (ad.landing_page_view_unique || ad.landing_page_view || 0), 0
  )
  
  const sqlCount = currentDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('sql') || stage.includes('sales qualified') || stage.includes('qualified')
  }).length
  
  const dealsCreated = currentDeals.length
  
  const winRate = dealsCreated > 0 ? (wonDeals.length / dealsCreated) * 100 : 0
  const prevDealsCreated = prevDeals.length
  const prevWinRate = prevDealsCreated > 0 ? (prevWonDeals.length / prevDealsCreated) * 100 : 0
  
  const cacByLeads = paidContacts.length > 0 ? spend / paidContacts.length : 0
  const cacByDeals = wonDeals.length > 0 ? spend / wonDeals.length : 0
  const roas = spend > 0 ? revenueWon / spend : 0
  
  const prevCacByLeads = prevPaidContacts.length > 0 ? prevSpend / prevPaidContacts.length : 0
  const prevCacByDeals = prevWonDeals.length > 0 ? prevSpend / prevWonDeals.length : 0
  const prevRoas = prevSpend > 0 ? prevRevenueWon / prevSpend : 0
  
  const avgDealSize = wonDeals.length > 0 ? revenueWon / wonDeals.length : 0
  const prevAvgDealSize = prevWonDeals.length > 0 ? prevRevenueWon / prevWonDeals.length : 0
  
  // Funnel metrics
  const leadsCount = paidContacts.length
  const dealsCount = dealsCreated
  const revenueTotal = revenueWon
  
  // Conversion rates
  const lpToLeadRate = lpViews > 0 ? (leadsCount / lpViews) * 100 : 0
  const leadToSqlRate = leadsCount > 0 ? (sqlCount / leadsCount) * 100 : 0
  const sqlToDealRate = sqlCount > 0 ? (dealsCount / sqlCount) * 100 : 0
  const dealToRevenueRate = dealsCount > 0 ? (revenueTotal / dealsCount) : 0
  
  // Previous period deltas
  const prevLpViews = prevFbAds.reduce((sum, ad) => 
    sum + (ad.landing_page_view_unique || ad.landing_page_view || 0), 0
  )
  const prevLeadsCount = prevPaidContacts.length
  const prevSqlCount = filters.comparePrevious ? prevDeals.filter(d => {
    const stage = (d.dealstage || '').toLowerCase()
    return stage.includes('sql') || stage.includes('sales qualified') || stage.includes('qualified')
  }).length : 0
  const prevDealsCount = prevDeals.length
  
  return {
    revenueWon: {
      value: revenueWon,
      deltaPct: prevRevenueWon > 0 ? ((revenueWon - prevRevenueWon) / prevRevenueWon) * 100 : null,
      previousValue: filters.comparePrevious ? prevRevenueWon : null
    },
    wonDeals: {
      value: wonDeals.length,
      deltaPct: prevWonDeals.length > 0 ? ((wonDeals.length - prevWonDeals.length) / prevWonDeals.length) * 100 : null,
      previousValue: filters.comparePrevious ? prevWonDeals.length : null
    },
    winRate: {
      value: winRate,
      deltaPct: prevWinRate > 0 ? winRate - prevWinRate : null,
      previousValue: filters.comparePrevious ? prevWinRate : null
    },
    avgDealSize: {
      value: avgDealSize,
      deltaPct: prevAvgDealSize > 0 ? ((avgDealSize - prevAvgDealSize) / prevAvgDealSize) * 100 : null,
      previousValue: filters.comparePrevious ? prevAvgDealSize : null
    },
    spend: {
      value: spend,
      deltaPct: prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : null,
      previousValue: filters.comparePrevious ? prevSpend : null
    },
    leads: {
      value: leadsCount,
      deltaPct: prevLeadsCount > 0 ? ((leadsCount - prevLeadsCount) / prevLeadsCount) * 100 : null,
      previousValue: filters.comparePrevious ? prevLeadsCount : null
    },
    cac: {
      value: cacByLeads, // Default to leads-based
      deltaPct: prevCacByLeads > 0 ? ((cacByLeads - prevCacByLeads) / prevCacByLeads) * 100 : null,
      previousValue: filters.comparePrevious ? prevCacByLeads : null
    },
    roas: {
      value: roas,
      deltaPct: prevRoas > 0 ? ((roas - prevRoas) / prevRoas) * 100 : null,
      previousValue: filters.comparePrevious ? prevRoas : null
    },
    lpViews,
    leadsCount,
    sqlCount,
    dealsCount,
    revenueTotal,
    lpToLeadRate,
    leadToSqlRate,
    sqlToDealRate,
    dealToRevenueRate,
    lpViewsDelta: prevLpViews > 0 ? lpViews - prevLpViews : null,
    leadsDelta: prevLeadsCount > 0 ? leadsCount - prevLeadsCount : null,
    sqlDelta: prevSqlCount > 0 ? sqlCount - prevSqlCount : null,
    dealsDelta: prevDealsCount > 0 ? dealsCount - prevDealsCount : null
  }
}

// Get daily metrics for charts
export async function getDailyMetrics(
  filters: OverviewFilters,
  sheetUrl: string = DEFAULT_SHEET_URL
): Promise<DailyMetric[]> {
  const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
  
  const [fbAds, deals] = await Promise.all([
    fetchFacebookAds(sheetUrl),
    fetchHubSpotDeals(sheetUrl)
  ])
  
  const dailyMap = new Map<string, DailyMetric>()
  
  // Initialize all days in range
  const current = new Date(start)
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0]
    dailyMap.set(dateStr, {
      date: dateStr,
      revenue: 0,
      spend: 0,
      winRate: 0,
      cac: 0,
      roas: 0
    })
    current.setDate(current.getDate() + 1)
  }
  
  // Aggregate FB ads
  fbAds.forEach(ad => {
    if (isDateInRange(ad.date, start, end)) {
      const metric = dailyMap.get(ad.date) || {
        date: ad.date,
        revenue: 0,
        spend: 0,
        winRate: 0,
        cac: 0,
        roas: 0
      }
      metric.spend += ad.spend || 0
      dailyMap.set(ad.date, metric)
    }
  })
  
  // Aggregate deals
  deals.forEach(deal => {
    const closeDate = deal.closedate || deal.createdate
    if (isDateInRange(closeDate, start, end)) {
      const dateStr = closeDate.split('T')[0]
      const metric = dailyMap.get(dateStr) || {
        date: dateStr,
        revenue: 0,
        spend: 0,
        winRate: 0,
        cac: 0,
        roas: 0
      }
      
      const stage = (deal.dealstage || '').toLowerCase()
      const isWon = stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
      if (isWon) {
        metric.revenue += deal.amount || 0
      }
      dailyMap.set(dateStr, metric)
    }
  })
  
  // Calculate derived metrics per day
  const dailyDealsMap = new Map<string, { total: number; won: number }>()
  const dailyContactsMap = new Map<string, number>()
  
  deals.forEach(deal => {
    const closeDate = deal.closedate || deal.createdate
    if (isDateInRange(closeDate, start, end)) {
      const dateStr = closeDate.split('T')[0]
      const existing = dailyDealsMap.get(dateStr) || { total: 0, won: 0 }
      existing.total += 1
      const stage = (deal.dealstage || '').toLowerCase()
      const isWon = stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
      if (isWon) {
        existing.won += 1
      }
      dailyDealsMap.set(dateStr, existing)
    }
  })
  
  contacts.forEach(contact => {
    if (isDateInRange(contact.createdate, start, end) && isPaidContact(contact)) {
      const dateStr = contact.createdate.split('T')[0]
      dailyContactsMap.set(dateStr, (dailyContactsMap.get(dateStr) || 0) + 1)
    }
  })
  
  Array.from(dailyMap.values()).forEach(metric => {
    const dealsData = dailyDealsMap.get(metric.date) || { total: 0, won: 0 }
    const leads = dailyContactsMap.get(metric.date) || 0
    
    metric.winRate = dealsData.total > 0 ? (dealsData.won / dealsData.total) * 100 : 0
    metric.cac = leads > 0 ? metric.spend / leads : 0
    metric.roas = metric.spend > 0 ? metric.revenue / metric.spend : 0
  })
  
  return Array.from(dailyMap.values()).sort((a, b) => 
    a.date.localeCompare(b.date)
  )
}

// Get campaign performance for Top Movers
export async function getCampaignPerformance(
  filters: OverviewFilters,
  sheetUrl: string = DEFAULT_SHEET_URL
): Promise<CampaignPerformance[]> {
  const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
  const prevStart = new Date(start)
  const prevEnd = new Date(end)
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  prevStart.setDate(prevStart.getDate() - daysDiff)
  prevEnd.setDate(prevEnd.getDate() - daysDiff)
  
  const [fbAds, deals, contacts] = await Promise.all([
    fetchFacebookAds(sheetUrl),
    fetchHubSpotDeals(sheetUrl),
    fetchHubSpotContacts(sheetUrl)
  ])
  
  const currentFbAds = fbAds.filter(ad => isDateInRange(ad.date, start, end))
  const prevFbAds = fbAds.filter(ad => isDateInRange(ad.date, prevStart, prevEnd))
  
  const campaignMap = new Map<string, CampaignPerformance>()
  
  // Process current period
  currentFbAds.forEach(ad => {
    const key = ad.campaign || 'Unknown'
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        campaign: key,
        channel: 'facebook',
        spend: 0,
        leads: 0,
        cac: 0,
        deals: 0,
        revenue: 0,
        deltaPct: 0,
        utmCampaign: undefined
      })
    }
    const perf = campaignMap.get(key)!
    perf.spend += ad.spend || 0
  })
  
  // Match deals and contacts by utm_campaign
  deals.forEach(deal => {
    const closeDate = deal.closedate || deal.createdate
    if (isDateInRange(closeDate, start, end)) {
      const utmCampaign = deal.utm_campaign
      if (utmCampaign) {
        // Try to match to campaign
        for (const [campaign, perf] of campaignMap.entries()) {
          if (campaign.toLowerCase().includes(utmCampaign.toLowerCase()) || 
              utmCampaign.toLowerCase().includes(campaign.toLowerCase())) {
            perf.deals += 1
            const stage = (deal.dealstage || '').toLowerCase()
            const isWon = stage.includes('won') || stage.includes('closed won') || stage === 'closedwon'
            if (isWon) {
              perf.revenue += deal.amount || 0
            }
            break
          }
        }
      }
    }
  })
  
  contacts.forEach(contact => {
    if (isDateInRange(contact.createdate, start, end) && isPaidContact(contact)) {
      const utmCampaign = contact.utm_campaign
      if (utmCampaign) {
        for (const [campaign, perf] of campaignMap.entries()) {
          if (campaign.toLowerCase().includes(utmCampaign.toLowerCase()) || 
              utmCampaign.toLowerCase().includes(campaign.toLowerCase())) {
            perf.leads += 1
            break
          }
        }
      }
    }
  })
  
  // Calculate CAC
  campaignMap.forEach(perf => {
    perf.cac = perf.leads > 0 ? perf.spend / perf.leads : 0
  })
  
  // Calculate previous period for deltas
  const prevMap = new Map<string, CampaignPerformance>()
  prevFbAds.forEach(ad => {
    const key = ad.campaign || 'Unknown'
    if (!prevMap.has(key)) {
      prevMap.set(key, {
        campaign: key,
        channel: 'facebook',
        spend: 0,
        leads: 0,
        cac: 0,
        deals: 0,
        revenue: 0,
        deltaPct: 0
      })
    }
    const perf = prevMap.get(key)!
    perf.spend += ad.spend || 0
  })
  
  // Calculate deltas
  campaignMap.forEach((perf, key) => {
    const prev = prevMap.get(key)
    if (prev && prev.revenue > 0) {
      perf.deltaPct = ((perf.revenue - prev.revenue) / prev.revenue) * 100
    }
  })
  
  return Array.from(campaignMap.values())
    .filter(p => p.spend > 0 || p.revenue > 0)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
}

