// src/lib/types.ts
import { SheetTab } from './config'

export interface Settings {
  sheetUrl: string
  currency: string
  selectedCampaign?: string
  activeTab?: SheetTab
}

export interface Campaign {
  id: string
  name: string
  totalCost: number
}

// Daily campaign metrics
export interface AdMetric {
  campaign: string
  campaignId: string
  clicks: number
  value: number
  conv: number
  cost: number
  impr: number
  date: string
}


// Search term metrics - Core metrics from script
export interface SearchTermMetric {
  searchTerm: string
  keywordText?: string
  campaign: string
  adGroup: string
  impr: number
  clicks: number
  cost: number
  conv: number
  value: number
}

// Ad group metrics - Core metrics from script
export interface AdGroupRecord {
  campaign: string
  campaignId: string
  adGroup: string
  adGroupId: string
  impr: number
  clicks: number
  value: number        // conversion value
  conv: number         // conversions
  cost: number         // account currency
  date: Date
  cpc: number
  ctr: number          // 0..1
  convRate: number     // 0..1
  cpa: number
  roas: number
}

// Calculated metrics for daily data
export interface DailyMetrics extends AdMetric {
  CTR: number
  CvR: number
  CPA: number
  ROAS: number
  CPC: number
}

// Regular metrics excluding metadata fields
export type MetricKey = keyof Omit<AdMetric, 'campaign' | 'campaignId' | 'date'>

// Search term metrics excluding metadata
export type SearchTermMetricKey = keyof Omit<SearchTermMetric, 'searchTerm' | 'campaign' | 'adGroup'>

// All possible metrics (regular + calculated)
export type AllMetricKeys = MetricKey | keyof Omit<DailyMetrics, keyof AdMetric>

export interface MetricOption {
  label: string
  format: (val: number) => string
}

export interface MetricOptions {
  [key: string]: MetricOption
}

export interface TabConfig {
  metrics: MetricOptions
}

export interface TabConfigs {
  [key: string]: TabConfig
}

// Type guard for search term data
export function isSearchTermMetric(data: any): data is SearchTermMetric {
  return 'searchTerm' in data && 'adGroup' in data
}

// Type guard for daily metrics
export function isAdMetric(data: any): data is AdMetric {
  return 'campaignId' in data && 'impr' in data
}

// Type guard for ad group data
export function isAdGroupRecord(data: any): data is AdGroupRecord {
  return 'adGroupId' in data && 'adGroup' in data && 'date' in data
}

// Combined tab data type
export type TabData = {
  daily: AdMetric[]
  searchTerms: SearchTermMetric[]
  adGroups: AdGroupRecord[]
}

// Helper type to get numeric values from metrics
export type MetricValue<T> = T extends number ? T : never 