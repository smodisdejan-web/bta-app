// src/lib/metrics.ts
import type { AdMetric, DailyMetrics, SearchTermMetric } from './types'

// Interface for Search Terms with calculated metrics
export interface CalculatedSearchTermMetric extends SearchTermMetric {
  CTR: number
  CvR: number
  CPA: number
  ROAS: number
  CPC: number
}

// Calculate aggregated metrics for daily campaign data
export function calculateMetrics(data: AdMetric[]): DailyMetrics {
  const totals = data.reduce((acc, d) => ({
    campaign: d.campaign,
    campaignId: d.campaignId,
    date: '',  // Not relevant for totals
    clicks: acc.clicks + d.clicks,
    impr: acc.impr + d.impr,
    cost: acc.cost + d.cost,
    conv: acc.conv + d.conv,
    value: acc.value + d.value,
  }), {
    campaign: '',
    campaignId: '',
    date: '',
    clicks: 0,
    impr: 0,
    cost: 0,
    conv: 0,
    value: 0
  } as AdMetric)

  return {
    ...totals,
    CTR: totals.impr ? (totals.clicks / totals.impr) * 100 : 0,
    CvR: totals.clicks ? (totals.conv / totals.clicks) * 100 : 0,
    CPA: totals.conv ? totals.cost / totals.conv : 0,
    ROAS: totals.cost ? totals.value / totals.cost : 0,
    CPC: totals.clicks ? totals.cost / totals.clicks : 0
  }
}

// Calculate daily metrics for campaign data
export function calculateDailyMetrics(data: AdMetric[]): DailyMetrics[] {
  return data.map(d => ({
    ...d,
    CTR: d.impr ? (d.clicks / d.impr) * 100 : 0,
    CvR: d.clicks ? (d.conv / d.clicks) * 100 : 0,
    CPA: d.conv ? d.cost / d.conv : 0,
    ROAS: d.cost ? d.value / d.cost : 0,
    CPC: d.clicks ? d.cost / d.clicks : 0
  }))
}

// Calculate derived metrics for a single Search Term row
export function calculateSingleSearchTermMetrics(term: SearchTermMetric): CalculatedSearchTermMetric {
  const { impr, clicks, cost, conv, value } = term;
  const CTR = impr > 0 ? (clicks / impr) * 100 : 0;
  const CvR = clicks > 0 ? (conv / clicks) * 100 : 0;
  const CPA = conv > 0 ? cost / conv : 0;
  const ROAS = cost > 0 ? value / cost : 0;
  const CPC = clicks > 0 ? cost / clicks : 0;

  return {
    ...term,
    CTR,
    CvR,
    CPA,
    ROAS,
    CPC,
  };
}

// Calculate derived metrics for an array of Search Terms
export function calculateAllSearchTermMetrics(terms: SearchTermMetric[]): CalculatedSearchTermMetric[] {
  return terms.map(calculateSingleSearchTermMetrics);
}

// Format metric values consistently
export function formatMetric(value: number, type: 'number' | 'currency' | 'percent', currency = '$'): string {
  if (value === 0 || !value) return '0'

  if (type === 'currency') {
    return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  if (type === 'percent') {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
  }

  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
} 