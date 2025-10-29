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

// Landing page metrics - Core metrics from script
export interface LandingPageData {
  url: string
  clicks: number
  impr: number
  ctr: number
  cost: number
  cpc: number
  conv: number
  convRate: number
  cpa: number
  value: number
  roas: number
  status: string
}

// Combined tab data type
export type TabData = {
  daily: AdMetric[]
  searchTerms: SearchTermMetric[]
  adGroups: AdGroupRecord[]
  landingPages: LandingPageData[]
}

// Helper type to get numeric values from metrics
export type MetricValue<T> = T extends number ? T : never

// Budget Pacing Types
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly'
export type PacingStatus = 'on-track' | 'slight-off' | 'moderate-off' | 'critical'

export interface Budget {
  id: string
  campaignName: string
  accountName?: string
  totalBudget: number
  budgetPeriod: BudgetPeriod
  startDate: string // ISO date string
  endDate: string // ISO date string
  spendEntries: SpendEntry[]
  budgetHistory: BudgetHistoryEntry[]
  createdAt: string
  updatedAt: string
}

export interface SpendEntry {
  date: string // ISO date string
  amount: number
}

export interface BudgetHistoryEntry {
  date: string // ISO date string
  previousBudget: number
  newBudget: number
  note?: string
}

export interface BudgetPacingData {
  budget: Budget
  totalSpend: number
  remainingBudget: number
  daysElapsed: number
  totalDays: number
  percentTimeElapsed: number
  percentBudgetSpent: number
  pacingStatus: PacingStatus
  pacingDeviation: number // percentage deviation from ideal pace
  projectedEndSpend: number
  dailyBudgetNeeded: number
  daysRemaining: number
  overspendEvents: number // count of days with 2x+ daily budget spend
  averageDailySpend: number
  targetDailySpend: number
}

export interface BudgetFilter {
  dateRange?: 'today' | 'week' | 'month-to-date' | 'custom'
  customStartDate?: string
  customEndDate?: string
  budgetPeriod?: BudgetPeriod
  pacingStatus?: PacingStatus[]
  accountName?: string
  searchQuery?: string
}

export type BudgetSortKey = 'name' | 'budget' | 'pacing' | 'overpacing' | 'underpacing'
export type SortDirection = 'asc' | 'desc'

// Data Insights Types
export type LLMProvider = 'gemini-pro' | 'gpt-4' | 'claude-3-sonnet'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface LLMResponse {
  text: string
  tokenUsage?: TokenUsage
  error?: string
}

export type ColumnDataType = 'metric' | 'dimension' | 'date'

export interface ColumnDefinition {
  name: string
  key: string
  type: ColumnDataType
}

export type FilterOperator = 
  | 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'starts-with' | 'ends-with'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'after' | 'before' | 'on-or-after' | 'on-or-before'

export interface DataFilter {
  id: string
  column: string
  operator: FilterOperator
  value: string
}

export interface DataSummary {
  totalRows: number
  metrics: Record<string, {
    min: number
    max: number
    avg: number
    sum: number
  }>
  dimensions: Record<string, {
    uniqueCount: number
    topValues?: Array<{ value: string; count: number }>
  }>
}

export type DataSourceType = 'searchTerms' | 'adGroups' | 'daily'

export interface InsightsPayload {
  prompt: string
  provider: LLMProvider
  dataSource: DataSourceType
  data: any[]
  filters: DataFilter[]
  totalRowsOriginal: number
  totalRowsFiltered: number
  currency: string
}