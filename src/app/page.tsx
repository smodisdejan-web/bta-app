// src/app/page.tsx
'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { getCampaigns } from '@/lib/sheetsData'
import type { AdMetric, DailyMetrics } from '@/lib/types'
import { calculateDailyMetrics } from '@/lib/metrics'
import { MetricCard } from '@/components/MetricCard'
import { MetricsChart } from '@/components/MetricsChart'
import { CampaignSelect } from '@/components/CampaignSelect'
import { formatCurrency, formatPercent, formatConversions } from '@/lib/utils'
import { COLORS } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  TrendingUp, TrendingDown, Calendar, Download, RefreshCw, 
  BarChart3, LineChart, PieChart, Zap, Target, DollarSign,
  MousePointerClick, Eye, ShoppingCart, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type DisplayMetric = 'impr' | 'clicks' | 'CTR' | 'CPC' | 'cost' |
    'conv' | 'CvR' | 'CPA' | 'value' | 'ROAS'

const metricConfig = {
    impr: { 
        label: 'Impressions', 
        format: (v: number) => v.toLocaleString(), 
        icon: Eye,
        row: 1,
        color: 'from-blue-500 to-cyan-500'
    },
    clicks: { 
        label: 'Clicks', 
        format: (v: number) => v.toLocaleString(), 
        icon: MousePointerClick,
        row: 1,
        color: 'from-green-500 to-emerald-500'
    },
    CTR: { 
        label: 'CTR', 
        format: formatPercent, 
        icon: Target,
        row: 2,
        color: 'from-purple-500 to-pink-500'
    },
    CPC: { 
        label: 'CPC', 
        format: (v: number, currency: string) => formatCurrency(v, currency), 
        icon: DollarSign,
        row: 2,
        color: 'from-amber-500 to-orange-500'
    },
    cost: { 
        label: 'Cost', 
        format: (v: number, currency: string) => formatCurrency(v, currency), 
        icon: DollarSign,
        row: 1,
        color: 'from-red-500 to-pink-500'
    },
    conv: { 
        label: 'Conversions', 
        format: formatConversions, 
        icon: ShoppingCart,
        row: 1,
        color: 'from-indigo-500 to-purple-500'
    },
    CvR: { 
        label: 'Conv Rate', 
        format: formatPercent, 
        icon: TrendingUp,
        row: 2,
        color: 'from-teal-500 to-cyan-500'
    },
    CPA: { 
        label: 'CPA', 
        format: (v: number, currency: string) => formatCurrency(v, currency), 
        icon: Target,
        row: 2,
        color: 'from-rose-500 to-red-500'
    },
    value: { 
        label: 'Conv Value', 
        format: (v: number, currency: string) => formatCurrency(v, currency), 
        icon: Zap,
        row: 1,
        color: 'from-yellow-500 to-amber-500'
    },
    ROAS: { 
        label: 'ROAS', 
        format: (v: number) => v.toFixed(2) + 'x', 
        icon: TrendingUp,
        row: 2,
        color: 'from-green-500 to-teal-500'
    }
} as const

export default function DashboardPage() {
    const { settings, fetchedData, dataError, isDataLoading, campaigns, refreshData } = useSettings()
    const [selectedMetrics, setSelectedMetrics] = useState<[DisplayMetric, DisplayMetric]>(['cost', 'value'])
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
    const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('area')
    const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d')
    const [isRefreshing, setIsRefreshing] = useState(false)

    // Aggregate metrics by date when viewing all campaigns
    const aggregateMetricsByDate = (data: AdMetric[]): AdMetric[] => {
        const metricsByDate = data.reduce((acc, metric) => {
            const date = metric.date
            if (!acc[date]) {
                acc[date] = {
                    campaign: 'All Campaigns',
                    campaignId: '',
                    date,
                    impr: 0,
                    clicks: 0,
                    cost: 0,
                    conv: 0,
                    value: 0,
                }
            }
            acc[date].impr += metric.impr
            acc[date].clicks += metric.clicks
            acc[date].cost += metric.cost
            acc[date].conv += metric.conv
            acc[date].value += metric.value
            return acc
        }, {} as Record<string, AdMetric>)

        return Object.values(metricsByDate).sort((a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
        )
    }

    // Filter data by date range
    const filterByDateRange = (data: AdMetric[]) => {
        if (dateRange === 'all') return data
        
        const now = new Date()
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90
        const cutoffDate = new Date(now.setDate(now.getDate() - days))
        
        return data.filter(d => new Date(d.date) >= cutoffDate)
    }

    const handleCampaignNavigate = (direction: 'next' | 'prev') => {
        if (!campaigns || campaigns.length === 0) return;

        const campaignIds = ['', ...campaigns.map(c => c.id)];
        const currentIndex = campaignIds.indexOf(selectedCampaignId);

        let nextIndex;
        if (direction === 'next') {
            nextIndex = (currentIndex + 1) % campaignIds.length;
        } else {
            nextIndex = (currentIndex - 1 + campaignIds.length) % campaignIds.length;
        }
        setSelectedCampaignId(campaignIds[nextIndex]);
    };

    const rawData = selectedCampaignId
        ? (fetchedData?.daily || []).filter(d => d.campaignId === selectedCampaignId)
        : aggregateMetricsByDate(fetchedData?.daily || [])

    const filteredData = filterByDateRange(rawData)
    const dailyMetrics = calculateDailyMetrics(filteredData)

    const calculateTotals = () => {
        if (dailyMetrics.length === 0) return null

        const sums = dailyMetrics.reduce((acc, d) => ({
            impr: acc.impr + d.impr,
            clicks: acc.clicks + d.clicks,
            cost: acc.cost + d.cost,
            conv: acc.conv + d.conv,
            value: acc.value + d.value,
        }), {
            impr: 0, clicks: 0, cost: 0, conv: 0, value: 0,
        })

        return {
            ...sums,
            CTR: (sums.impr ? (sums.clicks / sums.impr) * 100 : 0),
            CPC: (sums.clicks ? sums.cost / sums.clicks : 0),
            CvR: (sums.clicks ? (sums.conv / sums.clicks) * 100 : 0),
            CPA: (sums.conv ? sums.cost / sums.conv : 0),
            ROAS: (sums.cost ? sums.value / sums.cost : 0),
        }
    }

    // Calculate previous period for comparison
    const calculatePreviousPeriod = () => {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : filteredData.length
        const now = new Date()
        const startDate = new Date(now.setDate(now.getDate() - days * 2))
        const midDate = new Date(now.setDate(now.getDate() - days))
        
        const previousData = rawData.filter(d => {
            const date = new Date(d.date)
            return date >= startDate && date < midDate
        })
        
        const previousMetrics = calculateDailyMetrics(previousData)
        if (previousMetrics.length === 0) return null
        
        const sums = previousMetrics.reduce((acc, d) => ({
            cost: acc.cost + d.cost,
            value: acc.value + d.value,
            clicks: acc.clicks + d.clicks,
            conv: acc.conv + d.conv,
        }), { cost: 0, value: 0, clicks: 0, conv: 0 })
        
        return sums
    }

    const handleMetricClick = (metric: DisplayMetric) => {
        setSelectedMetrics(prev => [prev[1], metric])
    }

    const handleRefresh = async () => {
        setIsRefreshing(true)
        await refreshData()
        setTimeout(() => setIsRefreshing(false), 1000)
    }

    const exportData = () => {
        const csv = [
            ['Date', ...Object.keys(metricConfig).map(k => metricConfig[k as DisplayMetric].label)],
            ...dailyMetrics.map(d => [
                d.date,
                d.impr,
                d.clicks,
                d.CTR,
                d.CPC,
                d.cost,
                d.conv,
                d.CvR,
                d.CPA,
                d.value,
                d.ROAS
            ])
        ].map(row => row.join(',')).join('\n')
        
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `campaign-metrics-${Date.now()}.csv`
        a.click()
    }

    if (isDataLoading) return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
                <RefreshCw className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                <p className="text-muted-foreground">Loading your campaigns...</p>
            </div>
        </div>
    )
    
    if (!settings.sheetUrl) return (
        <div className="flex items-center justify-center min-h-screen">
            <Card className="max-w-md">
                <CardHeader>
                    <CardTitle>⚙️ Setup Required</CardTitle>
                    <CardDescription>Configure your Google Sheet URL to get started</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={() => window.location.href = '/settings'}>
                        Go to Settings
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
    
    if (dataError) return (
        <div className="flex items-center justify-center min-h-screen">
            <Card className="max-w-md border-destructive">
                <CardHeader>
                    <CardTitle className="text-destructive">⚠️ Data Load Error</CardTitle>
                    <CardDescription>Failed to load data. Please check your Sheet URL.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Button onClick={handleRefresh} variant="outline">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry
                    </Button>
                    <Button onClick={() => window.location.href = '/settings'} variant="secondary">
                        Check Settings
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
    
    if (dailyMetrics.length === 0 && !isDataLoading) return (
        <div className="flex items-center justify-center min-h-screen">
            <Card className="max-w-md">
                <CardHeader>
                    <CardTitle>📊 No Data Available</CardTitle>
                    <CardDescription>No campaign data found for the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleRefresh}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh Data
                    </Button>
                </CardContent>
            </Card>
        </div>
    )

    const totals = calculateTotals()
    const previousPeriod = calculatePreviousPeriod()
    if (!totals) return null

    const calculateChange = (current: number, previous: number) => {
        if (!previous || previous === 0) return null
        return ((current - previous) / previous) * 100
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
            <div className="container mx-auto px-4 py-8 mt-16 space-y-6">
                {/* Hero Header */}
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-background p-8 border-2">
                    <div className="relative z-10">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent mb-2">
                                    Campaign Performance
                                </h1>
                                <p className="text-muted-foreground text-lg">
                                    Real-time insights and analytics for your advertising campaigns
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Button onClick={exportData} variant="outline" size="sm" className="gap-2">
                                    <Download className="h-4 w-4" />
                                    Export
                                </Button>
                                <Button onClick={handleRefresh} variant="outline" size="sm" className="gap-2" disabled={isRefreshing}>
                                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                    Refresh
                                </Button>
                            </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div className="flex gap-4 mt-4">
                            <Badge variant="secondary" className="gap-2">
                                <BarChart3 className="h-4 w-4" />
                                {filteredData.length} days of data
                            </Badge>
                            <Badge variant="secondary" className="gap-2">
                                <Target className="h-4 w-4" />
                                {campaigns?.length || 0} campaigns
                            </Badge>
                            <Badge variant="secondary" className="gap-2">
                                <DollarSign className="h-4 w-4" />
                                {formatCurrency(totals.cost, settings.currency)} spend
                            </Badge>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -z-0" />
                </div>

                {/* Controls */}
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-[200px] max-w-md">
                        <CampaignSelect
                            campaigns={campaigns || []}
                            selectedId={selectedCampaignId}
                            onSelect={setSelectedCampaignId}
                        />
                    </div>
                    
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleCampaignNavigate('prev')}>
                            ← Prev
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleCampaignNavigate('next')}>
                            Next →
                        </Button>
                    </div>

                    <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                        <SelectTrigger className="w-[140px]">
                            <Calendar className="h-4 w-4 mr-2" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7d">Last 7 days</SelectItem>
                            <SelectItem value="30d">Last 30 days</SelectItem>
                            <SelectItem value="90d">Last 90 days</SelectItem>
                            <SelectItem value="all">All time</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={chartType} onValueChange={(v: any) => setChartType(v)}>
                        <SelectTrigger className="w-[120px]">
                            <LineChart className="h-4 w-4 mr-2" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="line">Line</SelectItem>
                            <SelectItem value="area">Area</SelectItem>
                            <SelectItem value="bar">Bar</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Metrics Row 1 - Primary Metrics */}
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" />
                        Primary Metrics
                    </h2>
                    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                        {Object.entries(metricConfig)
                            .filter(([_, config]) => config.row === 1)
                            .map(([key, config]) => {
                                const Icon = config.icon
                                const change = previousPeriod ? calculateChange(
                                    totals[key as DisplayMetric] as number,
                                    previousPeriod[key as keyof typeof previousPeriod] || 0
                                ) : null
                                
                                return (
                                    <Card 
                                        key={key}
                                        className={`cursor-pointer transition-all hover:shadow-lg hover:scale-105 ${
                                            selectedMetrics.includes(key as DisplayMetric) 
                                                ? 'ring-2 ring-primary shadow-lg' 
                                                : ''
                                        }`}
                                        onClick={() => handleMetricClick(key as DisplayMetric)}
                                    >
                                        <CardHeader className="pb-2">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                                    {config.label}
                                                </CardTitle>
                                                <div className={`p-2 rounded-lg bg-gradient-to-br ${config.color}`}>
                                                    <Icon className="h-4 w-4 text-white" />
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">
                                                {config.format(totals[key as DisplayMetric], settings.currency)}
                                            </div>
                                            {change !== null && (
                                                <div className={`flex items-center gap-1 text-sm mt-1 ${
                                                    change >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                    {change >= 0 ? (
                                                        <ArrowUpRight className="h-4 w-4" />
                                                    ) : (
                                                        <ArrowDownRight className="h-4 w-4" />
                                                    )}
                                                    {Math.abs(change).toFixed(1)}% vs previous
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )
                            })}
                    </div>
                </div>

                {/* Metrics Row 2 - Performance Metrics */}
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        Performance Metrics
                    </h2>
                    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                        {Object.entries(metricConfig)
                            .filter(([_, config]) => config.row === 2)
                            .map(([key, config]) => {
                                const Icon = config.icon
                                const change = previousPeriod ? calculateChange(
                                    totals[key as DisplayMetric] as number,
                                    key === 'CTR' || key === 'CvR' ? 0 : previousPeriod[key as keyof typeof previousPeriod] || 0
                                ) : null
                                
                                return (
                                    <Card 
                                        key={key}
                                        className={`cursor-pointer transition-all hover:shadow-lg hover:scale-105 ${
                                            selectedMetrics.includes(key as DisplayMetric) 
                                                ? 'ring-2 ring-primary shadow-lg' 
                                                : ''
                                        }`}
                                        onClick={() => handleMetricClick(key as DisplayMetric)}
                                    >
                                        <CardHeader className="pb-2">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                                    {config.label}
                                                </CardTitle>
                                                <div className={`p-2 rounded-lg bg-gradient-to-br ${config.color}`}>
                                                    <Icon className="h-4 w-4 text-white" />
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">
                                                {config.format(totals[key as DisplayMetric], settings.currency)}
                                            </div>
                                            {change !== null && change !== 0 && (
                                                <div className={`flex items-center gap-1 text-sm mt-1 ${
                                                    change >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                    {change >= 0 ? (
                                                        <ArrowUpRight className="h-4 w-4" />
                                                    ) : (
                                                        <ArrowDownRight className="h-4 w-4" />
                                                    )}
                                                    {Math.abs(change).toFixed(1)}% vs previous
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )
                            })}
                    </div>
                </div>

                {/* Charts */}
                <Card className="border-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <LineChart className="h-5 w-5" />
                            Performance Trends
                        </CardTitle>
                        <CardDescription>
                            Comparing {metricConfig[selectedMetrics[0]].label} and {metricConfig[selectedMetrics[1]].label}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MetricsChart
                            data={dailyMetrics}
                            metric1={{
                                key: selectedMetrics[0],
                                label: metricConfig[selectedMetrics[0]].label,
                                color: COLORS.primary,
                                format: (v: number) => metricConfig[selectedMetrics[0]].format(v, settings.currency)
                            }}
                            metric2={{
                                key: selectedMetrics[1],
                                label: metricConfig[selectedMetrics[1]].label,
                                color: COLORS.secondary,
                                format: (v: number) => metricConfig[selectedMetrics[1]].format(v, settings.currency)
                            }}
                        />
                    </CardContent>
                </Card>

                {/* Keyboard Shortcuts Help */}
                <Card className="bg-muted/30">
                    <CardContent className="p-4">
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground items-center justify-center">
                            <span className="font-semibold">⌨️ Keyboard Shortcuts:</span>
                            <Badge variant="outline">←/→: Navigate campaigns</Badge>
                            <Badge variant="outline">Cmd+E: Export data</Badge>
                            <Badge variant="outline">Cmd+R: Refresh</Badge>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
