'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { fetchFacebookAds, aggregateByCampaign, calculateTotals, addAiMetrics, type FacebookAdRecord } from '@/lib/facebook-ads'
import { formatCurrency } from '@/lib/utils'
import { COLORS } from '@/lib/config'
import { 
  Search, 
  Filter, 
  Download, 
  TrendingUp, 
  TrendingDown, 
  RefreshCw,
  DollarSign,
  MousePointerClick,
  Eye,
  Users,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  BarChart3,
  Sparkles,
  Zap,
  Trophy,
  Star,
  Target
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AiAsk } from '@/components/overview/AiAsk'

// Enhanced Metric Card Component
const MetricCard = ({ 
  title, 
  value, 
  icon: Icon, 
  trend,
  subtitle,
  gradient = false
}: {
  title: string
  value: string | number
  icon: any
  trend?: { value: number; label: string }
  subtitle?: string
  gradient?: boolean
}) => {
  const trendColor = trend?.value && trend.value > 0 
    ? 'text-green-600' 
    : trend?.value && trend.value < 0 
    ? 'text-red-600' 
    : 'text-gray-500'
  
  return (
    <Card className={`relative overflow-hidden transition-all hover:shadow-lg ${gradient ? 'bg-gradient-to-br from-white to-gray-50' : ''}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              <div className={`p-2 rounded-lg ${gradient ? 'bg-primary/10' : 'bg-gray-100'}`}>
                <Icon className={`h-4 w-4 ${gradient ? 'text-primary' : 'text-gray-600'}`} />
              </div>
              <span className="text-sm font-medium text-gray-600">{title}</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{value}</div>
            {subtitle && <div className="text-xs text-gray-500 mb-2">{subtitle}</div>}
            {trend && (
              <div className={`flex items-center space-x-1 text-sm font-medium ${trendColor}`}>
                {trend.value > 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : trend.value < 0 ? (
                  <ArrowDownRight className="h-3 w-3" />
                ) : null}
                <span>{trend.label}</span>
              </div>
            )}
          </div>
          {gradient && (
            <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
              <Icon className="w-full h-full" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function FacebookAdsPage() {
  const { settings } = useSettings()
  const [data, setData] = useState<FacebookAdRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof FacebookAdRecord>('spend')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'campaign' | 'daily'>('campaign')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'custom'>('30d')
  const [customDateRange, setCustomDateRange] = useState<[Date, Date] | null>(null)
  const [aiBullets, setAiBullets] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const generateAiSummary = async () => {
    if (!settings.sheetUrl) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/insights/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Provide 3-5 concise insights to optimize Facebook Ads for Goolets. Focus on campaign efficiency, creative performance, audience targeting, lead form vs landing page comparison, and CPQL optimization.',
          filters: { dateRange, channel: 'facebook', comparePrevious: true },
          sheetUrl: settings.sheetUrl
        })
      })
      if (!res.ok) {
        console.error('AI FB summary failed:', res.status, await res.text())
        setAiBullets([])
        return
      }
      const data = await res.json()
      const parsed = Array.isArray(data?.bullets) ? data.bullets : []
      setAiBullets(parsed.map((b: string) => b.replace(/\*\*/g, '')))
    } catch (e) {
      console.error('AI FB summary error:', e)
      setAiBullets([])
    } finally {
      setAiLoading(false)
    }
  }

  useEffect(() => {
    const loadData = async () => {
      if (!settings.sheetUrl) {
        setError('Please configure your Google Sheet URL in settings')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        const records = await fetchFacebookAds(settings.sheetUrl)
        setData(records)
        setLastRefresh(new Date())
      } catch (err: any) {
        console.error('Error loading Facebook Ads:', err)
        setError(err?.message || 'Failed to load Facebook Ads data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [settings.sheetUrl])

  useEffect(() => {
    generateAiSummary()
  }, [settings.sheetUrl, dateRange])

  // Get date range boundaries (defined early for use in JSX)
  const getDateRangeBounds = useMemo(() => {
    return () => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    
    let startDate: Date
    let endDate: Date = new Date(today)
    
    if (dateRange === 'custom' && customDateRange) {
      startDate = new Date(customDateRange[0])
      endDate = new Date(customDateRange[1])
      startDate.setHours(0, 0, 0, 0)
      endDate.setHours(23, 59, 59, 999)
    } else {
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90
      startDate = new Date(today)
      startDate.setDate(today.getDate() - days + 1)
      startDate.setHours(0, 0, 0, 0)
    }
    
      return { startDate, endDate }
    }
  }, [dateRange, customDateRange])

  // Filter data by date range
  const filterByDateRange = (records: FacebookAdRecord[]) => {
    const { startDate, endDate } = getDateRangeBounds()
    
    return records.filter(record => {
      if (!record.date) return false
      
      try {
        // Handle different date formats
        let recordDate: Date
        if (record.date.includes('T')) {
          recordDate = new Date(record.date)
        } else {
          // Assume YYYY-MM-DD format
          const parts = record.date.split('-')
          if (parts.length === 3) {
            recordDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
          } else {
            recordDate = new Date(record.date)
          }
        }
        
        // Normalize to date only (ignore time)
        recordDate.setHours(0, 0, 0, 0)
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        
        return recordDate >= start && recordDate <= end
      } catch (e) {
        return false
      }
    })
  }

  // Process data based on view mode and filters
  const processedData = useMemo(() => {
    // First filter by date range
    const { startDate, endDate } = getDateRangeBounds()
    let filtered = filterByDateRange(data)
    
    // Then aggregate if needed
    let processed = viewMode === 'campaign' 
      ? addAiMetrics(
          aggregateByCampaign(filtered),
          startDate?.toISOString().split('T')[0],
          endDate?.toISOString().split('T')[0]
        )
      : filtered

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      processed = processed.filter(r => 
        r.campaign.toLowerCase().includes(term)
      )
    }

    // Sort
    processed = [...processed].sort((a, b) => {
      const av = a[sortField] as number | undefined
      const bv = b[sortField] as number | undefined

      if (sortField === 'cpql') {
        // Lower CPQL is better
        const aVal = av ?? Infinity
        const bVal = bv ?? Infinity
        return sortDirection === 'desc' ? aVal - bVal : bVal - aVal
      }

      if (sortField === 'qualityRate') {
        const aVal = av ?? 0
        const bVal = bv ?? 0
        return sortDirection === 'desc' ? bVal - aVal : aVal - bVal
      }

      const aVal = av ?? 0
      const bVal = bv ?? 0
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })

    return processed
  }, [data, viewMode, searchTerm, sortField, sortDirection, dateRange, customDateRange])

  // Calculate totals from filtered raw data (sum of all records in date range)
  const filteredDataForTotals = useMemo(() => filterByDateRange(data), [data, dateRange, customDateRange])
  const totals = useMemo(() => {
    const result = calculateTotals(filteredDataForTotals)
    // Debug: Log totals calculation
    console.log('[Facebook Ads] Totals calculation:', {
      recordCount: filteredDataForTotals.length,
      totalSpend: result.spend,
      sampleSpends: filteredDataForTotals.slice(0, 5).map(r => ({ campaign: r.campaign, spend: r.spend, date: r.date }))
    })
    return result
  }, [filteredDataForTotals])

  // Calculate AI metrics totals from processed campaign data
  const aiTotals = useMemo(() => {
    if (viewMode !== 'campaign') return null
    const campaigns = processedData as FacebookAdRecord[]
    const totalQuality = campaigns.reduce((sum, c) => sum + (c.qualityLeads || 0), 0)
    const totalExcellent = campaigns.reduce((sum, c) => sum + (c.excellentLeads || 0), 0)
    const totalLeadsWithAi = campaigns.reduce((sum, c) => sum + (c.totalLeads || 0), 0)
    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0)
    const avgQualityRate = totalLeadsWithAi > 0 ? Math.round((totalQuality / totalLeadsWithAi) * 100) : 0
    const avgCpql = totalQuality > 0 ? Math.round((totalSpend / totalQuality) * 100) / 100 : 0
    return { totalQuality, totalExcellent, totalLeadsWithAi, avgQualityRate, avgCpql }
  }, [processedData, viewMode])

  // Format currency
  const fmtEUR = (n: number) => formatCurrency(n, '€')

  // Prepare chart data (daily aggregation)
  const chartData = useMemo(() => {
    if (viewMode === 'campaign') return []
    
    // Use filtered data for charts
    const filtered = filterByDateRange(data)
    
    const dailyMap = new Map<string, {
      date: string
      spend: number
      clicks: number
      lpViews: number
      fbFormLeads: number
      landingLeads: number
    }>()

    filtered.forEach(record => {
      const dateKey = record.date ? new Date(record.date).toLocaleDateString() : 'Unknown'
      const existing = dailyMap.get(dateKey)
      
      if (existing) {
        existing.spend += record.spend
        existing.clicks += record.clicks
        existing.lpViews += record.lpViews
        existing.fbFormLeads += record.fbFormLeads
        existing.landingLeads += record.landingLeads
      } else {
        dailyMap.set(dateKey, {
          date: dateKey,
          spend: record.spend,
          clicks: record.clicks,
          lpViews: record.lpViews,
          fbFormLeads: record.fbFormLeads,
          landingLeads: record.landingLeads,
        })
      }
    })

    return Array.from(dailyMap.values())
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [data, viewMode, dateRange, customDateRange])

  // Quality highlights from processed campaign data
  const qualityHighlights = useMemo(() => {
    if (viewMode !== 'campaign' || !processedData.length) return null
    const campaigns = processedData as FacebookAdRecord[]
    const withQuality = campaigns.filter(c => (c.qualityLeads || 0) > 0)
    const withTracked = campaigns.filter(c => (c.totalLeads || 0) > 0)

    const bestCpql = withQuality.length > 0
      ? withQuality.reduce((best, c) =>
          (c.cpql || Infinity) < (best.cpql || Infinity) ? c : best
        )
      : null

    const highestQRate = withTracked.length > 0
      ? withTracked.reduce((best, c) =>
          (c.qualityRate || 0) > (best.qualityRate || 0) ? c : best
        )
      : null

    const mostQuality = withQuality.length > 0
      ? withQuality.reduce((best, c) =>
          (c.qualityLeads || 0) > (best.qualityLeads || 0) ? c : best
        )
      : null

    return { bestCpql, highestQRate, mostQuality }
  }, [processedData, viewMode])

  // Handle sort
  const handleSort = (field: keyof FacebookAdRecord) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Sort indicator
  const SortIndicator = ({ field }: { field: keyof FacebookAdRecord }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? <ArrowUpRight className="h-3 w-3 ml-1" /> : <ArrowDownRight className="h-3 w-3 ml-1" />
  }

  if (loading && data.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
              <p className="text-gray-600">Loading Facebook Ads data...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20">
      <div className="container mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              Facebook Ads
            </h1>
            <p className="text-gray-600 mt-1">
              Performance analytics and campaign insights
            </p>
            {(() => {
              const { startDate, endDate } = getDateRangeBounds()
              return (
                <p className="text-xs text-gray-500 mt-1">
                  Showing data from {startDate.toLocaleDateString()} to {endDate.toLocaleDateString()}
                </p>
              )
            })()}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                const loadData = async () => {
                  if (!settings.sheetUrl) return
                  try {
                    setLoading(true)
                    const records = await fetchFacebookAds(settings.sheetUrl)
                    setData(records)
                    setLastRefresh(new Date())
                  } catch (err: any) {
                    setError(err?.message || 'Failed to refresh data')
                  } finally {
                    setLoading(false)
                  }
                }
                loadData()
              }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* AI Executive Summary */}
        <div className="bg-[#fdf8f3] rounded-3xl p-6 shadow-sm border border-[#e8d5b0]/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#b48e49]/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#b48e49]" />
              </div>
              <div>
                <h3 className="font-semibold text-[#1a1a1a]">AI Executive Summary</h3>
                <p className="text-xs text-[#6b7280]">Facebook Ads insights</p>
              </div>
            </div>
            <button
              onClick={generateAiSummary}
              disabled={aiLoading}
              className="text-sm text-[#b48e49] hover:text-[#96743c] font-medium flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${aiLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <div className="space-y-3">
            {aiLoading && <div className="text-sm text-[#6b7280]">Generating insights...</div>}
            {!aiLoading && aiBullets.length === 0 && (
              <div className="text-sm text-[#6b7280]">Click refresh to generate AI insights.</div>
            )}
            {!aiLoading && aiBullets.length > 0 && (
              <div className="space-y-3">
                {aiBullets.map((b, i) => (
                  <p key={i} className="text-sm leading-relaxed text-[#1a1a1a] whitespace-pre-wrap">
                    {b}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            title="Total Spend"
            value={fmtEUR(totals.spend)}
            icon={DollarSign}
            gradient
            subtitle={`${processedData.length} ${viewMode === 'campaign' ? 'campaigns' : 'records'}`}
          />
          <MetricCard
            title="Clicks"
            value={totals.clicks.toLocaleString()}
            icon={MousePointerClick}
            subtitle={`Avg: ${data.length > 0 ? (totals.clicks / data.length).toFixed(1) : 0}`}
          />
          <MetricCard
            title="LP Views"
            value={totals.lpViews.toLocaleString()}
            icon={Eye}
            subtitle={`${data.length > 0 && totals.clicks > 0 ? ((totals.lpViews / totals.clicks) * 100).toFixed(1) : 0}% of clicks`}
          />
          <MetricCard
            title="FB Form Leads"
            value={totals.fbFormLeads.toLocaleString()}
            icon={FileText}
            subtitle={`${data.length > 0 && totals.lpViews > 0 ? ((totals.fbFormLeads / totals.lpViews) * 100).toFixed(1) : 0}% conversion`}
          />
          <MetricCard
            title="Landing Leads"
            value={totals.landingLeads.toLocaleString()}
            icon={Users}
            subtitle={`${data.length > 0 && totals.lpViews > 0 ? ((totals.landingLeads / totals.lpViews) * 100).toFixed(1) : 0}% conversion`}
          />
        </div>

        {/* AI Quality Metrics Row */}
        {aiTotals && aiTotals.totalLeadsWithAi > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {/* CPQL Card */}
            <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-2 rounded-lg bg-amber-100">
                        <Zap className="h-4 w-4 text-amber-600" />
                      </div>
                      <span className="text-sm font-medium text-amber-800">CPQL</span>
                      <div className="group relative">
                        <span className="text-amber-400 cursor-help text-xs">ⓘ</span>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                          Cost Per Quality Lead (AI Score 50+)
                        </div>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-amber-900">€{aiTotals.avgCpql.toFixed(2)}</div>
                    <div className="text-xs text-amber-600 mt-1">Lower is better</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quality Leads Card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-2 rounded-lg bg-green-100">
                    <Users className="h-4 w-4 text-green-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-600">Quality Leads</span>
                  <div className="group relative">
                    <span className="text-gray-400 cursor-help text-xs">ⓘ</span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                      Leads with AI Score ≥ 50
                    </div>
                  </div>
                </div>
                <div className="text-3xl font-bold text-gray-900">{aiTotals.totalQuality}</div>
                <div className="text-xs text-gray-500 mt-1">
                  <span className="text-green-600 font-medium">{aiTotals.totalExcellent}</span> excellent (70+)
                </div>
              </CardContent>
            </Card>

            {/* Quality Rate Card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-2 rounded-lg bg-blue-100">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-600">Quality Rate</span>
                </div>
                <div className="text-3xl font-bold text-gray-900">{aiTotals.avgQualityRate}%</div>
                <div className="text-xs text-gray-500 mt-1">of leads are quality</div>
              </CardContent>
            </Card>

            {/* Tracked Leads Card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-2 rounded-lg bg-purple-100">
                    <BarChart3 className="h-4 w-4 text-purple-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-600">Tracked Leads</span>
                </div>
                <div className="text-3xl font-bold text-gray-900">{aiTotals.totalLeadsWithAi}</div>
                <div className="text-xs text-gray-500 mt-1">with AI score</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters and Controls */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search campaigns..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={viewMode} onValueChange={(v: 'campaign' | 'daily') => setViewMode(v)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="campaign">By Campaign</SelectItem>
                  <SelectItem value="daily">Daily View</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dateRange} onValueChange={(v: '7d' | '30d' | '90d' | 'custom') => {
                setDateRange(v)
                if (v !== 'custom') {
                  setCustomDateRange(null)
                }
              }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {dateRange === 'custom' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[240px] justify-start text-left font-normal">
                      <Calendar className="mr-2 h-4 w-4" />
                      {customDateRange ? (
                        `${customDateRange[0].toLocaleDateString()} - ${customDateRange[1].toLocaleDateString()}`
                      ) : (
                        'Pick a date range'
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Start Date</label>
                        <Input
                          type="date"
                          value={customDateRange ? customDateRange[0].toISOString().split('T')[0] : ''}
                          onChange={(e) => {
                            const start = new Date(e.target.value)
                            const end = customDateRange ? customDateRange[1] : new Date()
                            if (start > end) {
                              setCustomDateRange([start, start])
                            } else {
                              setCustomDateRange([start, end])
                            }
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">End Date</label>
                        <Input
                          type="date"
                          value={customDateRange ? customDateRange[1].toISOString().split('T')[0] : ''}
                          onChange={(e) => {
                            const end = new Date(e.target.value)
                            const start = customDateRange ? customDateRange[0] : new Date()
                            if (end < start) {
                              setCustomDateRange([end, end])
                            } else {
                              setCustomDateRange([start, end])
                            }
                          }}
                          min={customDateRange ? customDateRange[0].toISOString().split('T')[0] : undefined}
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <div className="text-sm text-gray-500 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Last updated: {lastRefresh.toLocaleTimeString()}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quality Highlight Cards */}
        {qualityHighlights && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Best CPQL */}
            <Card className="bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-md bg-amber-100">
                    <Trophy className="h-4 w-4 text-amber-600" />
                  </div>
                  <span className="text-sm font-medium text-amber-700">Best CPQL</span>
                </div>
                {qualityHighlights.bestCpql ? (
                  <>
                    <div className="font-semibold text-gray-900 truncate mb-1">
                      {qualityHighlights.bestCpql.campaign}
                    </div>
                    <div className="text-lg font-bold text-amber-700">
                      €{qualityHighlights.bestCpql.cpql?.toFixed(2)} per quality lead
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400 text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            {/* Highest Quality Rate */}
            <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-md bg-green-100">
                    <Star className="h-4 w-4 text-green-600" />
                  </div>
                  <span className="text-sm font-medium text-green-700">Highest Quality Rate</span>
                </div>
                {qualityHighlights.highestQRate ? (
                  <>
                    <div className="font-semibold text-gray-900 truncate mb-1">
                      {qualityHighlights.highestQRate.campaign}
                    </div>
                    <div className="text-lg font-bold text-green-700">
                      {qualityHighlights.highestQRate.qualityRate}% quality rate
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400 text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            {/* Most Quality Leads */}
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-md bg-blue-100">
                    <Target className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium text-blue-700">Most Quality Leads</span>
                </div>
                {qualityHighlights.mostQuality ? (
                  <>
                    <div className="font-semibold text-gray-900 truncate mb-1">
                      {qualityHighlights.mostQuality.campaign}
                    </div>
                    <div className="text-lg font-bold text-blue-700">
                      {qualityHighlights.mostQuality.qualityLeads} quality leads
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400 text-sm">No data</div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts */}
        {viewMode === 'daily' && chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Spend & Clicks Trend
                </CardTitle>
                <CardDescription>Last 30 days performance</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      fontSize={12}
                      tick={{ fill: '#6b7280' }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      yAxisId="left"
                      fontSize={12}
                      tick={{ fill: '#6b7280' }}
                      tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      fontSize={12}
                      tick={{ fill: '#6b7280' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255,255,255,0.95)', 
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'spend') return [fmtEUR(value), 'Spend']
                        return [value.toLocaleString(), name]
                      }}
                    />
                    <Legend />
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="spend" 
                      stroke={COLORS.primary} 
                      strokeWidth={2}
                      dot={false}
                      name="Spend"
                    />
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="clicks" 
                      stroke="#3D7C4D" 
                      strokeWidth={2}
                      dot={false}
                      name="Clicks"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Leads Performance
                </CardTitle>
                <CardDescription>FB Forms vs Landing Leads</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      fontSize={12}
                      tick={{ fill: '#6b7280' }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      fontSize={12}
                      tick={{ fill: '#6b7280' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255,255,255,0.95)', 
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                      }}
                      formatter={(value: number) => value.toLocaleString()}
                    />
                    <Legend />
                    <Bar 
                      dataKey="fbFormLeads" 
                      fill={COLORS.primary} 
                      radius={[8, 8, 0, 0]}
                      name="FB Form Leads"
                    />
                    <Bar 
                      dataKey="landingLeads" 
                      fill="#3D7C4D" 
                      radius={[8, 8, 0, 0]}
                      name="Landing Leads"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Data Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {viewMode === 'campaign' ? 'Campaign Performance' : 'Daily Performance'}
            </CardTitle>
            <CardDescription>
              {processedData.length} {viewMode === 'campaign' ? 'campaigns' : 'records'} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort('campaign')}
                    >
                      <div className="flex items-center">
                        Campaign
                        <SortIndicator field="campaign" />
                      </div>
                    </TableHead>
                    {viewMode === 'daily' && (
                      <TableHead 
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handleSort('date')}
                      >
                        <div className="flex items-center">
                          Date
                          <SortIndicator field="date" />
                        </div>
                      </TableHead>
                    )}
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort('spend')}
                    >
                      <div className="flex items-center justify-end">
                        Spend
                        <SortIndicator field="spend" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort('clicks')}
                    >
                      <div className="flex items-center justify-end">
                        Clicks
                        <SortIndicator field="clicks" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort('lpViews')}
                    >
                      <div className="flex items-center justify-end">
                        LP Views
                        <SortIndicator field="lpViews" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end">
                        FB Form Leads
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end">
                        Landing Leads
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        Quality
                        <div className="group relative">
                          <span className="text-gray-400 cursor-help text-xs">ⓘ</span>
                          <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                            Quality (Excellent) - AI Score 50+ (70+)
                          </div>
                        </div>
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort('qualityRate')}
                    >
                      <div className="flex items-center justify-end">
                        Q.Rate
                        <SortIndicator field="qualityRate" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Avg AI</TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSort('cpql')}
                    >
                      <div className="flex items-center justify-end">
                        CPQL
                        <SortIndicator field="cpql" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={viewMode === 'daily' ? 11 : 10} className="text-center py-8 text-gray-500">
                        No data found
                      </TableCell>
                    </TableRow>
                  ) : (
                    processedData.map((row, idx) => (
                      <TableRow key={idx} className="hover:bg-gray-50">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-primary"></div>
                            {row.campaign}
                          </div>
                        </TableCell>
                        {viewMode === 'daily' && (
                          <TableCell className="text-gray-600">
                            {row.date ? new Date(row.date).toLocaleDateString() : '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-right font-semibold">
                          {fmtEUR(row.spend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.lpViews.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={row.fbFormLeads > 0 ? 'default' : 'secondary'}>
                            {row.fbFormLeads.toLocaleString()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={row.landingLeads > 0 ? 'default' : 'secondary'}>
                            {row.landingLeads.toLocaleString()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.qualityLeads !== undefined ? (
                            <span>
                              {row.qualityLeads}
                              {row.excellentLeads ? (
                                <span className="text-green-600 text-xs ml-1">
                                  ({row.excellentLeads})
                                </span>
                              ) : null}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.qualityRate !== undefined && row.qualityRate > 0 ? (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              row.qualityRate >= 50 
                                ? 'bg-green-100 text-green-800 ring-1 ring-green-600/20' 
                                : row.qualityRate >= 30 
                                ? 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-600/20' 
                                : 'bg-red-100 text-red-800 ring-1 ring-red-600/20'
                            }`}>
                              {row.qualityRate}%
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.avgAiScore !== undefined ? row.avgAiScore : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {row.cpql && row.cpql > 0 ? (
                            <span className={`${
                              row.cpql < 50 ? 'text-green-600 font-semibold' :
                              row.cpql < 100 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              €{row.cpql.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span className="font-medium">Quality:</span> AI Score 50+ (includes Excellent 70+)
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">CPQL:</span> Cost Per Quality Lead = Spend ÷ Quality Leads
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-green-100 ring-1 ring-green-600/20"></span>
              <span>Q.Rate ≥50%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-yellow-100 ring-1 ring-yellow-600/20"></span>
              <span>Q.Rate 30-49%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-red-100 ring-1 ring-red-600/20"></span>
              <span>Q.Rate &lt;30%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

