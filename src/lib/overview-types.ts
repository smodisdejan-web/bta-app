// src/lib/overview-types.ts
// Types for Overview page data sources

export interface FacebookAdRecord {
  date: string // YYYY-MM-DD
  campaign: string
  adset?: string
  ad?: string
  spend: number
  impressions: number
  clicks: number
  landing_page_view?: number
  landing_page_view_unique?: number
  [key: string]: any // Allow other fields
}

export interface HubSpotDeal {
  dealId: string
  dealname: string
  amount: number
  closedate: string // ISO date
  dealstage: string
  createdate: string // ISO date
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  [key: string]: any
}

export interface HubSpotContact {
  contactId: string
  email: string
  createdate: string // ISO date
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  [key: string]: any
}

export interface MarketingFunnelRecord {
  date: string
  lp_views?: number
  leads?: number
  sql?: number
  deals?: number
  revenue?: number
  [key: string]: any
}

export type DateRange = '30d' | '60d' | '90d' | 'custom'
export type Channel = 'all' | 'google' | 'facebook'
export type CACMode = 'leads' | 'deals'

export interface OverviewFilters {
  dateRange: DateRange
  customStart?: string
  customEnd?: string
  channel: Channel
  market?: string
  campaign?: string
  comparePrevious: boolean
}

export interface MetricDelta {
  value: number
  deltaPct: number | null
  previousValue: number | null
}

export interface OverviewMetrics {
  // Business (HubSpot)
  revenueWon: MetricDelta
  wonDeals: MetricDelta
  winRate: MetricDelta
  avgDealSize: MetricDelta
  
  // Acquisition
  spend: MetricDelta
  leads: MetricDelta
  cac: MetricDelta
  roas: MetricDelta
  
  // Funnel
  lpViews: number
  leadsCount: number
  sqlCount: number
  dealsCount: number
  revenueTotal: number
  
  // Conversion rates
  lpToLeadRate: number
  leadToSqlRate: number
  sqlToDealRate: number
  dealToRevenueRate: number
  
  // Deltas for funnel
  lpViewsDelta: number | null
  leadsDelta: number | null
  sqlDelta: number | null
  dealsDelta: number | null
}

export interface DailyMetric {
  date: string
  revenue: number
  spend: number
  winRate: number
  cac: number
  roas: number
}

export interface CampaignPerformance {
  campaign: string
  channel: 'google' | 'facebook'
  spend: number
  leads: number
  cac: number
  deals: number
  revenue: number
  deltaPct: number
  utmCampaign?: string
}

export interface AISummaryResponse {
  bullets: string[]
}

export interface AIAskResponse {
  bullets: string[]
}



