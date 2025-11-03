'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { getSheetData } from '@/lib/api-router'
import type { LandingPageData } from '@/lib/types'
import { COLORS } from '@/lib/config'
import { InsightsGenerator } from '@/components/ai/InsightsGenerator'
import { 
  Search, 
  Filter, 
  Download, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  BarChart3,
  PieChart,
  Target,
  Zap,
  Eye,
  MousePointer,
  DollarSign,
  Users,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Settings,
  MoreHorizontal
} from 'lucide-react'

// North metric configuration for summary cards
type Row = LandingPageData
const NORTH_METRIC: keyof Row = 'conv' // conversions
const formatNorth = (v: number) => v.toLocaleString() // integer formatting
const northLabel = 'Conv'

// Enhanced UI Components
const Card = ({ children, className = '', gradient = false }: { 
  children: React.ReactNode
  className?: string
  gradient?: boolean 
}) => (
  <div className={`bg-white rounded-xl border border-gray-200/60 shadow-sm hover:shadow-md transition-all duration-200 p-6 ${gradient ? 'bg-gradient-to-br from-white to-gray-50' : ''} ${className}`}>
    {children}
  </div>
)

const MetricCard = ({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  trend = 'neutral',
  subtitle,
  className = ''
}: {
  title: string
  value: string | number
  change?: number
  icon: any
  trend?: 'up' | 'down' | 'neutral'
  subtitle?: string
  className?: string
}) => {
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-500'
  const trendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : null
  
  return (
    <Card className={`relative overflow-hidden ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <Icon className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-600">{title}</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-1">{value}</div>
          {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
          {change !== undefined && (
            <div className={`flex items-center space-x-1 text-sm font-medium ${trendColor}`}>
              {trendIcon && React.createElement(trendIcon, { className: "h-3 w-3" })}
              <span>{Math.abs(change).toFixed(1)}%</span>
            </div>
          )}
        </div>
        <div className="absolute top-0 right-0 w-20 h-20 opacity-5">
          <Icon className="w-full h-full" />
        </div>
      </div>
    </Card>
  )
}

const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig = {
    active: { color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle },
    paused: { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: AlertTriangle },
    inactive: { color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle },
    pending: { color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Settings }
  }
  
  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.inactive
  const Icon = config.icon
  
  return (
    <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>
      <Icon className="h-3 w-3" />
      <span className="capitalize">{status}</span>
    </span>
  )
}

const PerformanceIndicator = ({ value, threshold = 0.1, type = 'ctr' }: { 
  value: number
  threshold?: number
  type?: 'ctr' | 'roas' | 'conv'
}) => {
  const isGood = type === 'roas' ? value > 2 : value > threshold
  const color = isGood ? 'bg-green-500' : 'bg-red-500'
  
  return (
    <div className="flex items-center space-x-2">
      <div className="w-2 h-2 rounded-full bg-gray-300">
        <div className={`w-2 h-2 rounded-full ${color} animate-pulse`}></div>
      </div>
      <span className={`text-xs font-medium ${isGood ? 'text-green-600' : 'text-red-600'}`}>
        {isGood ? 'Good' : 'Needs Attention'}
      </span>
    </div>
  )
}

export default function LandingPagesPage() {
  const [data, setData] = useState<LandingPageData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<keyof LandingPageData>('cost')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const result = await getSheetData('landingPages', { sort: 'cost', dir: 'desc', limit: 200 })
        setData(result)
        setLastRefresh(new Date())
      } catch (err) {
        console.error('Error fetching data:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Enhanced filtering and sorting
  const filteredAndSortedData = useMemo(() => {
    let filtered = data.filter(item => {
      const matchesSearch = item.url.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      return matchesSearch && matchesStatus
    })

    return filtered.sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }
      
      const numA = Number(aVal)
      const numB = Number(bVal)
      
      return sortDirection === 'asc' ? numA - numB : numB - numA
    })
  }, [data, searchTerm, statusFilter, sortField, sortDirection])

  // Enhanced KPI calculations
  const kpis = useMemo(() => {
    const totals = data.reduce((acc, row) => ({
      impr: acc.impr + row.impr,
      clicks: acc.clicks + row.clicks,
      cost: acc.cost + row.cost,
      conv: acc.conv + row.conv,
      value: acc.value + row.value,
      roas: acc.roas + row.roas
    }), { impr: 0, clicks: 0, cost: 0, conv: 0, value: 0, roas: 0 })

    const avgCtr = data.length > 0 ? data.reduce((sum, row) => sum + row.ctr, 0) / data.length : 0
    const avgConvRate = data.length > 0 ? data.reduce((sum, row) => sum + row.convRate, 0) / data.length : 0
    const avgRoas = data.length > 0 ? totals.roas / data.length : 0
    const avgCpc = totals.clicks > 0 ? totals.cost / totals.clicks : 0
    const avgCpa = totals.conv > 0 ? totals.cost / totals.conv : 0

    return {
      ...totals,
      avgCtr,
      avgConvRate,
      avgRoas,
      avgCpc,
      avgCpa,
      totalPages: data.length,
      activePages: data.filter(row => row.status === 'active').length
    }
  }, [data])

  // Performance insights
  const insights = useMemo(() => {
    // Top Performers: sort desc by conv (highest conversions first)
    const topPerformers = data
      .filter(row => row.status === 'active')
      .sort((a, b) => b.conv - a.conv)
      .slice(0, 3)

    // Needs Attention: sort asc by conv (lowest conversions first)
    const underperformers = data
      .filter(row => row.status === 'active')
      .sort((a, b) => a.conv - b.conv)
      .slice(0, 3)

    // High Volume: keep volume filter, but prefer higher conv when breaking ties
    const highVolume = data
      .filter(row => row.clicks > 100)
      .sort((a, b) => {
        // Primary sort by clicks (volume), secondary by conv (desc)
        const clicksDiff = b.clicks - a.clicks
        if (clicksDiff !== 0) return clicksDiff
        return b.conv - a.conv
      })
      .slice(0, 3)

    return { topPerformers, underperformers, highVolume }
  }, [data])

  const formatNumber = (value: number) => value.toLocaleString()
  const formatCurrency = (value: number) => `€${value.toFixed(2)}`
  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`
  const formatRoas = (value: number) => `${value.toFixed(2)}x`
  const formatCompact = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
    return value.toString()
  }

  const handleSort = (field: keyof LandingPageData) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const handleRefresh = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const result = await getSheetData('landingPages', { sort: 'cost', dir: 'desc', limit: 200 })
      setData(result)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Error refreshing data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-16">
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-primary mx-auto"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-primary animate-pulse" />
              </div>
            </div>
            <p className="mt-6 text-lg text-gray-600 font-medium">Loading landing pages analytics...</p>
            <p className="mt-2 text-sm text-gray-500">Fetching latest performance data</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-16">
        <div className="container mx-auto px-6 py-8">
          <Card className="border-red-200 bg-red-50/50 backdrop-blur-sm">
            <div className="text-red-800">
              <div className="flex items-center space-x-3 mb-4">
                <AlertTriangle className="h-6 w-6" />
                <h3 className="text-xl font-semibold">Error Loading Data</h3>
              </div>
              <p className="mb-4">{error}</p>
              <button 
                onClick={handleRefresh}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Retry</span>
              </button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-16">
      <div className="container mx-auto px-6 py-8">
        {/* Enhanced Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">Landing Pages</h1>
              <p className="text-lg text-gray-600">Advanced performance analytics & insights</p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <div className="text-sm text-gray-500">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col lg:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search landing pages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="inactive">Inactive</option>
            </select>
            <div className="flex space-x-2">
              <button
                onClick={() => setViewMode('table')}
                className={`px-4 py-3 rounded-lg transition-colors ${
                  viewMode === 'table' 
                    ? 'bg-primary text-white' 
                    : 'bg-white border border-gray-300 hover:bg-gray-50'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-4 py-3 rounded-lg transition-colors ${
                  viewMode === 'cards' 
                    ? 'bg-primary text-white' 
                    : 'bg-white border border-gray-300 hover:bg-gray-50'
                }`}
              >
                <PieChart className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Enhanced KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-6 mb-8">
          <MetricCard
            title="Total Pages"
            value={kpis.totalPages}
            icon={Target}
            subtitle={`${kpis.activePages} active`}
            trend="neutral"
          />
          <MetricCard
            title="Impressions"
            value={formatCompact(kpis.impr)}
            icon={Eye}
            trend="neutral"
          />
          <MetricCard
            title="Clicks"
            value={formatCompact(kpis.clicks)}
            icon={MousePointer}
            trend="neutral"
          />
          <MetricCard
            title="Total Cost"
            value={formatCurrency(kpis.cost)}
            icon={DollarSign}
            trend="neutral"
          />
          <MetricCard
            title="Conversions"
            value={formatCompact(kpis.conv)}
            icon={Users}
            trend="neutral"
          />
          <MetricCard
            title="Avg ROAS"
            value={formatRoas(kpis.avgRoas)}
            icon={Star}
            trend={kpis.avgRoas > 2 ? 'up' : 'down'}
            subtitle={`€${formatCompact(kpis.value)} value`}
          />
        </div>

        {/* Performance Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card gradient>
            <div className="flex items-center space-x-2 mb-4">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-900">Top Performers</h3>
            </div>
            <div className="space-y-3">
              {insights.topPerformers.map((page, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{page.url}</p>
                    <p className="text-xs text-gray-500">{northLabel}: {formatNorth(page.conv)}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <PerformanceIndicator value={page.convRate} type="conv" />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card gradient>
            <div className="flex items-center space-x-2 mb-4">
              <TrendingDown className="h-5 w-5 text-red-600" />
              <h3 className="text-lg font-semibold text-gray-900">Needs Attention</h3>
            </div>
            <div className="space-y-3">
              {insights.underperformers.map((page, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{page.url}</p>
                    <p className="text-xs text-gray-500">{northLabel}: {formatNorth(page.conv)}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <PerformanceIndicator value={page.convRate} type="conv" />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card gradient>
            <div className="flex items-center space-x-2 mb-4">
              <Zap className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">High Volume</h3>
            </div>
            <div className="space-y-3">
              {insights.highVolume.map((page, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{page.url}</p>
                    <p className="text-xs text-gray-500">{northLabel}: {formatNorth(page.conv)}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <PerformanceIndicator value={page.convRate} type="conv" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Enhanced Data Table */}
        <Card>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900">Landing Pages Performance</h3>
            <div className="text-sm text-gray-500">
              Showing {filteredAndSortedData.length} of {data.length} pages
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    { key: 'url', label: 'Landing Page URL' },
                    { key: 'clicks', label: 'Clicks' },
                    { key: 'impr', label: 'Impressions' },
                    { key: 'ctr', label: 'CTR' },
                    { key: 'cost', label: 'Cost' },
                    { key: 'cpc', label: 'CPC' },
                    { key: 'conv', label: 'Conversions' },
                    { key: 'convRate', label: 'Conv Rate' },
                    { key: 'cpa', label: 'CPA' },
                    { key: 'value', label: 'Value' },
                    { key: 'roas', label: 'ROAS' },
                    { key: 'status', label: 'Status' }
                  ].map(({ key, label }) => (
                    <th 
                      key={key}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort(key as keyof LandingPageData)}
                    >
                      <div className="flex items-center space-x-1">
                        <span>{label}</span>
                        {sortField === key && (
                          <span className="text-primary">
                            {sortDirection === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAndSortedData.map((row, index) => (
                  <tr key={index} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <div className="max-w-xs">
                        <a 
                          href={row.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 font-medium truncate block"
                          title={row.url}
                        >
                          {row.url}
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span>{formatNumber(row.clicks)}</span>
                        {row.clicks > 1000 && <span className="text-green-600 text-xs">🔥</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      {formatNumber(row.impr)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span>{formatPercent(row.ctr)}</span>
                        <PerformanceIndicator value={row.ctr} type="ctr" />
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      {formatCurrency(row.cost)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      {formatCurrency(row.cpc)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span>{formatNumber(row.conv)}</span>
                        {row.conv > 10 && <span className="text-green-600 text-xs">⭐</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span>{formatPercent(row.convRate)}</span>
                        <PerformanceIndicator value={row.convRate} type="conv" />
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      {formatCurrency(row.cpa)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      {formatCurrency(row.value)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <div className="flex items-center space-x-2">
                        <span className={`font-semibold ${row.roas > 2 ? 'text-green-600' : row.roas < 1 ? 'text-red-600' : 'text-gray-900'}`}>
                          {formatRoas(row.roas)}
                        </span>
                        <PerformanceIndicator value={row.roas} type="roas" />
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 border-b border-gray-100">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {filteredAndSortedData.length === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <Search className="h-12 w-12 mx-auto" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No landing pages found</h3>
              <p className="text-gray-500">Try adjusting your search or filter criteria</p>
            </div>
          )}
        </Card>

        {/* AI Insights Generator */}
        <div className="mt-8">
          <InsightsGenerator
            defaultModel="gpt-4"
            defaultPrompt="Based on the landing pages table above, identify the underperforming URLs and give me 3–6 specific actions to improve conversions."
            contextHint="AI Insights for Landing Pages"
          />
        </div>
      </div>
    </div>
  )
}