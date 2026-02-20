'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { fetchGoogleAds, aggregateGoogleByCampaign, addGoogleAiMetrics, calculateGoogleTotals, type GoogleAdRecord } from '@/lib/google-ads'
import { fetchStreakSyncGoogle, fetchBookings, fetchSheet, type BookingRecord, type StreakLeadRow } from '@/lib/sheetsData'
import { getSheetsUrl } from '@/lib/config'
import { formatCurrency } from '@/lib/utils'
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

// Simple metric card
const MetricCard = ({
  title,
  value,
  icon: Icon,
  subtitle,
  gradient = false
}: {
  title: string
  value: string | number
  icon: any
  subtitle?: string
  gradient?: boolean
}) => {
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
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function GoogleAdsPage() {
  const { settings } = useSettings()
  const [data, setData] = useState<GoogleAdRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<keyof GoogleAdRecord>('spend')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'campaign' | 'daily'>('campaign')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'custom'>('30d')
  const [customDateRange, setCustomDateRange] = useState<[Date, Date] | null>(null)
  const [aiBullets, setAiBullets] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [googleLeadsState, setGoogleLeadsState] = useState<StreakLeadRow[]>([])
  const [bookingsState, setBookingsState] = useState<BookingRecord[]>([])
  const [googleLeads, setGoogleLeads] = useState<StreakLeadRow[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const generateAiSummary = async () => {
    if (!settings.sheetUrl) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/insights/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Provide 3-5 concise insights to optimize Google Ads for Goolets. Focus on search term quality, keyword performance, campaign types (Search vs PMax), geographic targeting, and CPQL optimization.',
          filters: { dateRange, channel: 'google', comparePrevious: true },
          sheetUrl: settings.sheetUrl
        })
      })
      if (!res.ok) {
        console.error('AI Google summary failed:', res.status, await res.text())
        setAiBullets([])
        return
      }
      const data = await res.json()
      const parsed = Array.isArray(data?.bullets) ? data.bullets : []
      setAiBullets(parsed.map((b: string) => b.replace(/\*\*/g, '')))
    } catch (e) {
      console.error('AI Google summary error:', e)
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
        const [records, leads, bookingRows] = await Promise.all([
          fetchGoogleAds(settings.sheetUrl || getSheetsUrl()),
          fetchStreakSyncGoogle(fetchSheet, settings.sheetUrl || getSheetsUrl()),
          fetchBookings(fetchSheet, settings.sheetUrl || getSheetsUrl()),
        ])
        setData(records)
        setGoogleLeadsState(leads || [])
        setBookingsState(bookingRows || [])
        setLastRefresh(new Date())
      } catch (err: any) {
        console.error('Error loading Google Ads:', err)
        setError(err?.message || 'Failed to load Google Ads data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [settings.sheetUrl])

  useEffect(() => {
    generateAiSummary()
  }, [settings.sheetUrl, dateRange])

  // Date range bounds
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

  const filterByDateRange = (records: GoogleAdRecord[]) => {
    const { startDate, endDate } = getDateRangeBounds()
    return records.filter(record => {
      if (!record.date) return false
      const recordDate = new Date(record.date)
      recordDate.setHours(0, 0, 0, 0)
      return recordDate >= startDate && recordDate <= endDate
    })
  }

  const { startDate: kpiStart, endDate: kpiEnd } = getDateRangeBounds()
  const leadsInRange = useMemo(() => {
    return googleLeadsState.filter((lead) => {
      if (!lead.inquiry_date) return false
      const d = new Date(lead.inquiry_date)
      if (Number.isNaN(+d)) return false
      d.setHours(0, 0, 0, 0)
      return d >= kpiStart && d <= kpiEnd
    })
  }, [googleLeadsState, kpiStart, kpiEnd])

  const paidSearchLeads = useMemo(
    () => leadsInRange.filter((l) => (l.source_category || '').toLowerCase() === 'paid_search'),
    [leadsInRange]
  )

  const conversionsFromLeads = paidSearchLeads.length
  const valueFromBookings = useMemo(() => {
    const start = kpiStart
    const end = kpiEnd
    const campaignNames = new Set(data.map((c) => (c.campaign || '').toLowerCase()))
    return bookingsState
      .filter((b) => {
        const rawDate = b.booking_date || b.inquiry_date
        if (!rawDate) return false
        const d = new Date(rawDate.length === 7 ? `${rawDate}-01` : rawDate)
        if (Number.isNaN(+d)) return false
        d.setHours(0, 0, 0, 0)
        return d >= start && d <= end
      })
      .filter((b) => {
        const src = (b.source || '').toLowerCase()
        const camp = (b.campaign || '').toLowerCase()
        if (src === 'google') return true
        return Array.from(campaignNames).some((c) => c && camp.includes(c))
      })
      .reduce((sum, b) => sum + (b.rvc || 0), 0)
  }, [bookingsState, data, kpiStart, kpiEnd])

  const processedData = useMemo(() => {
    const { startDate, endDate } = getDateRangeBounds()
    let filtered = filterByDateRange(data)
    let processed = viewMode === 'campaign'
      ? addGoogleAiMetrics(
          aggregateGoogleByCampaign(filtered),
          startDate?.toISOString().split('T')[0],
          endDate?.toISOString().split('T')[0]
        )
      : filtered
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      processed = processed.filter(r =>
        r.campaign.toLowerCase().includes(term)
      )
    }
    processed = [...processed].sort((a, b) => {
      const av = a[sortField] as number | undefined
      const bv = b[sortField] as number | undefined
      if (sortField === 'cpql') {
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
  }, [data, viewMode, searchTerm, sortField, sortDirection, dateRange, customDateRange, getDateRangeBounds])

  const filteredDataForTotals = useMemo(() => filterByDateRange(data), [data, dateRange, customDateRange])
  const totals = useMemo(() => calculateGoogleTotals(filteredDataForTotals), [filteredDataForTotals])

  const aiTotals = useMemo(() => {
    if (viewMode !== 'campaign') return null
    const campaigns = processedData as GoogleAdRecord[]
    const totalQuality = campaigns.reduce((sum, c) => sum + (c.qualityLeads || 0), 0)
    const totalExcellent = campaigns.reduce((sum, c) => sum + (c.excellentLeads || 0), 0)
    const totalLeadsWithAi = campaigns.reduce((sum, c) => sum + (c.totalLeads || 0), 0)
    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0)
    const avgQualityRate = totalLeadsWithAi > 0 ? Math.round((totalQuality / totalLeadsWithAi) * 100) : 0
    const avgCpql = totalQuality > 0 ? Math.round((totalSpend / totalQuality) * 100) / 100 : 0
    return { totalQuality, totalExcellent, totalLeadsWithAi, avgQualityRate, avgCpql }
  }, [processedData, viewMode])

  const chartData = useMemo(() => {
    if (viewMode === 'campaign') return []
    const filtered = filterByDateRange(data)
    const dailyMap = new Map<string, any>()
    filtered.forEach(record => {
      const key = record.date ? new Date(record.date).toLocaleDateString() : 'Unknown'
      const existing = dailyMap.get(key)
      if (existing) {
        existing.spend += record.spend
        existing.clicks += record.clicks
        existing.impressions += record.impressions
        existing.conversions += record.conversions
        existing.value += record.value
      } else {
        dailyMap.set(key, {
          date: key,
          spend: record.spend,
          clicks: record.clicks,
          impressions: record.impressions,
          conversions: record.conversions,
          value: record.value,
        })
      }
    })
    return Array.from(dailyMap.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [data, viewMode, dateRange, customDateRange])

  const qualityHighlights = useMemo(() => {
    if (viewMode !== 'campaign' || !processedData.length) return null
    const campaigns = processedData as GoogleAdRecord[]
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

  const fmtEUR = (n: number) => formatCurrency(n, '€')

  const tableData = useMemo(() => {
    if (viewMode !== 'campaign') return processedData
    return (processedData as GoogleAdRecord[]).map((row) => {
      const conv = perCampaignConversions.get(row.campaign) || 0
      const val = perCampaignValue.get(row.campaign) || 0
      const spend = row.spend || 0
      const cpa = conv > 0 ? spend / conv : 0
      const roas = spend > 0 ? val / spend : 0
      return {
        ...row,
        conversions: conv,
        value: val,
        cpa,
        roas,
      }
    })
  }, [processedData, viewMode, perCampaignConversions, perCampaignValue])

  const matchLeadToCampaign = (detail: string, campaigns: string[]): string | null => {
    const sd = (detail || '').toLowerCase().trim()
    const camps = campaigns.map((c) => c.toLowerCase())
    const find = (predicate: (c: string) => boolean) => {
      const idx = camps.findIndex(predicate)
      return idx >= 0 ? campaigns[idx] : null
    }
    if (sd.includes('brand')) return find((c) => c.includes('brand'))
    if (sd.includes('uk, ca, aus') || sd.includes('uk,ca,aus'))
      return find((c) => c.includes('performance') && c.includes('uk'))
    if (sd.includes('perfromance max') || sd.includes('performance max') || sd.includes('top 17')) {
      let c = find((c) => c.includes('performance') && c.includes('eu'))
      if (!c) c = find((c) => c.includes('performance max') || c.includes('perfromance max'))
      return c
    }
    if (sd.includes('sem') || sd.includes('tofu'))
      return find((c) => c.includes('search') && c.includes('croatia') && c.includes('en'))
    if (sd.includes('latam') || sd.includes('latm'))
      return find((c) => c.includes('latm'))
    if (sd.includes('demand gen'))
      return find((c) => c.includes('demand gen'))
    return null
  }

  const campaignNames = useMemo(() => processedData.filter((r) => r.campaign).map((r) => r.campaign), [processedData])

  const perCampaignConversions = useMemo(() => {
    const map = new Map<string, number>()
    paidSearchLeads.forEach((lead) => {
      const matched = matchLeadToCampaign(lead.source_detail || '', campaignNames) || 'Unknown Google'
      map.set(matched, (map.get(matched) || 0) + 1)
    })
    return map
  }, [paidSearchLeads, campaignNames])

  const bookingsInRange = useMemo(() => {
    const start = kpiStart
    const end = kpiEnd
    return bookings.filter((b) => {
      const rawDate = b.booking_date || b.inquiry_date
      if (!rawDate) return false
      const d = new Date(rawDate.length === 7 ? `${rawDate}-01` : rawDate)
      if (Number.isNaN(+d)) return false
      d.setHours(0, 0, 0, 0)
      return d >= start && d <= end
    })
  }, [bookings, kpiStart, kpiEnd])

  const perCampaignValue = useMemo(() => {
    const map = new Map<string, number>()
    const campaignSet = campaignNames.map((c) => c.toLowerCase())
    bookingsInRange.forEach((b) => {
      const camp = (b.campaign || '').toLowerCase()
      const src = (b.source || '').toLowerCase()
      let matched: string | null = null
      const idx = campaignSet.findIndex((c) => c && camp.includes(c))
      if (idx >= 0) matched = campaignNames[idx]
      else if (src === 'google') matched = 'Unknown Google'
      if (matched) {
        map.set(matched, (map.get(matched) || 0) + (b.rvc || 0))
      }
    })
    return map
  }, [bookingsInRange, campaignNames])

  const handleSort = (field: keyof GoogleAdRecord) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }
  const SortIndicator = ({ field }: { field: keyof GoogleAdRecord }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? <ArrowUpRight className="h-3 w-3 ml-1" /> : <ArrowDownRight className="h-3 w-3 ml-1" />
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-6 px-6 pb-12">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="mb-2">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Google Ads</h1>
            <p className="text-gray-600">Performance analytics and campaign insights</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const load = async () => {
                  try {
                    setLoading(true)
                    const records = await fetchGoogleAds()
                    setData(records)
                    setLastRefresh(new Date())
                  } catch (err: any) {
                    setError(err?.message || 'Failed to refresh data')
                  } finally {
                    setLoading(false)
                  }
                }
                load()
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
                <p className="text-xs text-[#6b7280]">Google Ads insights</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <MetricCard title="Total Spend" value={fmtEUR(totals.spend)} icon={DollarSign} gradient />
          <MetricCard title="Clicks" value={totals.clicks.toLocaleString()} icon={MousePointerClick} />
          <MetricCard title="Impressions" value={totals.impressions.toLocaleString()} icon={Eye} />
          <MetricCard title="Conversions" value={conversionsFromLeads.toLocaleString()} icon={FileText} />
          <MetricCard title="Value" value={fmtEUR(valueFromBookings)} icon={BarChart3} />
        </div>

        {/* AI Quality Metrics Row */}
        {aiTotals && aiTotals.totalLeadsWithAi > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
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
        <Card className="mb-6">
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
                if (v !== 'custom') setCustomDateRange(null)
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
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">Start</label>
                          <input
                            type="date"
                            className="border rounded-md px-2 py-1 w-full"
                            value={customDateRange ? customDateRange[0].toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              const start = new Date(e.target.value)
                              const end = customDateRange ? customDateRange[1] : new Date()
                              if (start > end) setCustomDateRange([start, start])
                              else setCustomDateRange([start, end])
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">End</label>
                          <input
                            type="date"
                            className="border rounded-md px-2 py-1 w-full"
                            value={customDateRange ? customDateRange[1].toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              const end = new Date(e.target.value)
                              const start = customDateRange ? customDateRange[0] : new Date()
                              if (end < start) setCustomDateRange([end, end])
                              else setCustomDateRange([start, end])
                            }}
                            min={customDateRange ? customDateRange[0].toISOString().split('T')[0] : undefined}
                          />
                        </div>
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

        {/* Quality Highlights */}
        {qualityHighlights && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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
                <CardDescription>Daily performance</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" fontSize={12} tick={{ fill: '#6b7280' }} />
                    <YAxis yAxisId="left" fontSize={12} tick={{ fill: '#6b7280' }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" fontSize={12} tick={{ fill: '#6b7280' }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="spend" stroke="#b48e49" name="Spend" />
                    <Line yAxisId="right" type="monotone" dataKey="clicks" stroke="#2563eb" name="Clicks" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Conversions & Value
                </CardTitle>
                <CardDescription>Daily conversions and value</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" fontSize={12} tick={{ fill: '#6b7280' }} />
                    <YAxis fontSize={12} tick={{ fill: '#6b7280' }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="conversions" fill="#16a34a" name="Conversions" />
                    <Bar dataKey="value" fill="#0ea5e9" name="Value" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Campaign Performance */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {viewMode === 'campaign' ? 'Campaign Performance' : 'Daily Performance'}
            </CardTitle>
            <CardDescription>{tableData.length} {viewMode === 'campaign' ? 'campaigns' : 'records'} found</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer hover:bg-gray-50" onClick={() => handleSort('campaign')}>
                      <div className="flex items-center">
                        Campaign
                        <SortIndicator field="campaign" />
                      </div>
                    </TableHead>
                    {viewMode === 'daily' && (
                      <TableHead> Date </TableHead>
                    )}
                    <TableHead className="text-right cursor-pointer hover:bg-gray-50" onClick={() => handleSort('spend')}>
                      <div className="flex items-center justify-end">
                        Spend
                        <SortIndicator field="spend" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer hover:bg-gray-50" onClick={() => handleSort('clicks')}>
                      <div className="flex items-center justify-end">
                        Clicks
                        <SortIndicator field="clicks" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Impr</TableHead>
                    <TableHead className="text-right">Conv</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">CPA</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
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
                  {tableData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={viewMode === 'daily' ? 12 : 11} className="text-center py-8 text-gray-500">
                        No data found
                      </TableCell>
                    </TableRow>
                  ) : (
                    (tableData as GoogleAdRecord[]).map((row, idx) => (
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
                          {row.impressions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.conversions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtEUR(row.value)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.cpa ? fmtEUR(row.cpa) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.roas ? `${row.roas.toFixed(2)}x` : '—'}
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
                              row.cpql < 100 ? 'text-green-600 font-semibold' :
                              row.cpql < 200 ? 'text-yellow-600' :
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

