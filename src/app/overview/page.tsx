// src/app/overview/page.tsx
'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { OverviewFilters, OverviewMetrics, DailyMetric, CampaignPerformance, AISummaryResponse, AIAskResponse, CACMode } from '@/lib/overview-types'
import { getOverviewMetrics, getDailyMetrics, getCampaignPerformance } from '@/lib/overview-data'
import { TopBar } from '@/components/overview/TopBar'
import { KpiCard } from '@/components/overview/KpiCard'
import { Funnel } from '@/components/overview/Funnel'
import { RevenueSpendChart } from '@/components/overview/RevenueSpendChart'
import { MiniMetric } from '@/components/overview/MiniMetric'
import { TopMovers } from '@/components/overview/TopMovers'
import { AiSummary } from '@/components/overview/AiSummary'
import { AiAsk } from '@/components/overview/AiAsk'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function OverviewPage() {
  const { settings } = useSettings()
  const [filters, setFilters] = useState<OverviewFilters>({
    dateRange: '30d',
    channel: 'all',
    comparePrevious: true
  })
  // Default empty metrics
  const defaultMetrics: OverviewMetrics = {
    revenueWon: { value: 0, deltaPct: null, previousValue: null },
    wonDeals: { value: 0, deltaPct: null, previousValue: null },
    winRate: { value: 0, deltaPct: null, previousValue: null },
    avgDealSize: { value: 0, deltaPct: null, previousValue: null },
    spend: { value: 0, deltaPct: null, previousValue: null },
    leads: { value: 0, deltaPct: null, previousValue: null },
    cac: { value: 0, deltaPct: null, previousValue: null },
    roas: { value: 0, deltaPct: null, previousValue: null },
    lpViews: 0,
    leadsCount: 0,
    sqlCount: 0,
    dealsCount: 0,
    revenueTotal: 0,
    lpToLeadRate: 0,
    leadToSqlRate: 0,
    sqlToDealRate: 0,
    dealToRevenueRate: 0,
    lpViewsDelta: null,
    leadsDelta: null,
    sqlDelta: null,
    dealsDelta: null
  }
  
  const [metrics, setMetrics] = useState<OverviewMetrics>(defaultMetrics)
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([])
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([])
  const [summary, setSummary] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [regeneratingSummary, setRegeneratingSummary] = useState(false)
  const [cacMode, setCacMode] = useState<CACMode>('leads')
  const [error, setError] = useState<string | null>(null)
  
  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [metricsData, dailyData, campaignsData] = await Promise.all([
          getOverviewMetrics(filters, settings.sheetUrl),
          getDailyMetrics(filters, settings.sheetUrl),
          getCampaignPerformance(filters, settings.sheetUrl)
        ])
        setMetrics(metricsData)
        setDailyMetrics(dailyData)
        setCampaigns(campaignsData)
      } catch (error) {
        console.error('Error loading overview data:', error)
        setError(error instanceof Error ? error.message : 'Failed to load data')
        // Keep default metrics on error
      } finally {
        setLoading(false)
      }
    }
    
    if (settings.sheetUrl) {
      loadData()
    } else {
      setLoading(false)
      setError('No sheet URL configured. Please configure it in Settings.')
    }
  }, [filters, settings.sheetUrl])
  
  // Load summary on mount and when filters change
  useEffect(() => {
    async function loadSummary() {
      try {
        const res = await fetch('/api/insights/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters, sheetUrl: settings.sheetUrl })
        })
        if (res.ok) {
          const data: AISummaryResponse = await res.json()
          setSummary(data.bullets || [])
        }
      } catch (error) {
        console.error('Error loading summary:', error)
      }
    }
    
    if (metrics) {
      loadSummary()
    }
  }, [filters, settings.sheetUrl, metrics])
  
  const handleRegenerateSummary = async () => {
    setRegeneratingSummary(true)
    try {
      const res = await fetch('/api/insights/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, sheetUrl: settings.sheetUrl })
      })
      if (res.ok) {
        const data: AISummaryResponse = await res.json()
        setSummary(data.bullets || [])
      }
    } catch (error) {
      console.error('Error regenerating summary:', error)
    } finally {
      setRegeneratingSummary(false)
    }
  }
  
  const handleAsk = async (prompt: string): Promise<AIAskResponse> => {
    const res = await fetch('/api/insights/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, filters, sheetUrl: settings.sheetUrl })
    })
    if (!res.ok) {
      throw new Error('Failed to generate insights')
    }
    return res.json()
  }
  
  // Calculate CAC based on mode
  const cacValue = useMemo(() => {
    if (!metrics) return { value: 0, deltaPct: null, previousValue: null }
    if (cacMode === 'deals') {
      const dealsCac = metrics.wonDeals.value > 0 ? metrics.spend.value / metrics.wonDeals.value : 0
      const prevDealsCac = metrics.wonDeals.previousValue && metrics.wonDeals.previousValue > 0 
        ? (metrics.spend.previousValue || 0) / metrics.wonDeals.previousValue 
        : 0
      return {
        value: dealsCac,
        deltaPct: prevDealsCac > 0 ? ((dealsCac - prevDealsCac) / prevDealsCac) * 100 : null,
        previousValue: metrics.comparePrevious ? prevDealsCac : null
      }
    }
    return metrics.cac
  }, [metrics, cacMode])
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading overview data...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <Card>
            <CardContent className="p-8 text-center space-y-4">
              <p className="text-destructive font-semibold">Error loading data</p>
              <p className="text-muted-foreground">{error}</p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Marketing Overview</h1>
          <p className="text-muted-foreground mt-2">
            Cross-channel performance dashboard for paid marketing
          </p>
        </div>
        
        {/* Top Bar */}
        <TopBar
          filters={filters}
          onFiltersChange={setFilters}
          onRegenerateSummary={handleRegenerateSummary}
          isRegenerating={regeneratingSummary}
        />
        
        {/* Executive Summary */}
        <AiSummary
          bullets={summary}
          onRegenerate={handleRegenerateSummary}
          isRegenerating={regeneratingSummary}
        />
        
        {/* KPI Cards - Row 1: Business */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Business Metrics (HubSpot)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Revenue Won"
              metric={metrics.revenueWon}
              format={(v) => formatCurrency(v, 'EUR')}
              isPositiveIncrease={true}
            />
            <KpiCard
              title="Won Deals"
              metric={metrics.wonDeals}
              format={(v) => v.toLocaleString()}
              isPositiveIncrease={true}
            />
            <KpiCard
              title="Win Rate"
              metric={metrics.winRate}
              format={(v) => formatPercent(v)}
              isPositiveIncrease={true}
            />
            <KpiCard
              title="Avg Deal Size"
              metric={metrics.avgDealSize}
              format={(v) => formatCurrency(v, 'EUR')}
              isPositiveIncrease={true}
            />
          </div>
        </div>
        
        {/* KPI Cards - Row 2: Acquisition */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Acquisition Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Spend"
              metric={metrics.spend}
              format={(v) => formatCurrency(v, 'EUR')}
              isPositiveIncrease={false}
            />
            <KpiCard
              title="Leads"
              metric={metrics.leads}
              format={(v) => v.toLocaleString()}
              isPositiveIncrease={true}
            />
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-muted-foreground">CAC Mode:</span>
                <Button
                  variant={cacMode === 'leads' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCacMode('leads')}
                >
                  By Leads
                </Button>
                <Button
                  variant={cacMode === 'deals' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCacMode('deals')}
                >
                  By Deals
                </Button>
              </div>
              <KpiCard
                title="CAC"
                metric={cacValue}
                format={(v) => formatCurrency(v, 'EUR')}
                isPositiveIncrease={false}
              />
            </div>
            <KpiCard
              title="ROAS"
              metric={metrics.roas}
              format={(v) => `${v.toFixed(2)}x`}
              isPositiveIncrease={true}
            />
          </div>
        </div>
        
        {/* Funnel */}
        <Funnel metrics={metrics} />
        
        {/* Performance Trends */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Performance Trends</h2>
          <div className="space-y-4">
            <RevenueSpendChart data={dailyMetrics} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MiniMetric
                title="Win Rate"
                data={dailyMetrics}
                dataKey="winRate"
                format={(v) => formatPercent(v)}
                color="#3D7C4D"
              />
              <MiniMetric
                title="CAC"
                data={dailyMetrics}
                dataKey="cac"
                format={(v) => formatCurrency(v, 'EUR')}
                color="#B83C3C"
              />
              <MiniMetric
                title="ROAS"
                data={dailyMetrics}
                dataKey="roas"
                format={(v) => `${v.toFixed(2)}x`}
                color="#B39262"
              />
            </div>
          </div>
        </div>
        
        {/* Top Movers */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Top Movers</h2>
          <TopMovers campaigns={campaigns} />
        </div>
        
        {/* AI Ask */}
        <AiAsk onAsk={handleAsk} />
      </div>
    </div>
  )
}

