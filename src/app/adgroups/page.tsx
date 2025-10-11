// src/app/adgroups/page.tsx
'use client'

import { useState, useMemo } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import type { AdGroupRecord } from '@/lib/types'
import { usePagination, DOTS } from '@/hooks/use-pagination'
import { MetricsChart } from '@/components/MetricsChart'
import { MetricCard } from '@/components/MetricCard'
import { COLORS } from '@/lib/config'
import { Search, SlidersHorizontal, Download, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

type SortField = keyof AdGroupRecord
type SortDirection = 'asc' | 'desc'
type DisplayMetric = 'impr' | 'clicks' | 'ctr' | 'cpc' | 'cost' |
    'conv' | 'convRate' | 'cpa' | 'value' | 'roas'

const PAGE_SIZE = 25

const metricConfig = {
    impr: { label: 'Impressions', format: (v: number) => v.toLocaleString(), row: 1 },
    clicks: { label: 'Clicks', format: (v: number) => v.toLocaleString(), row: 1 },
    ctr: { label: 'CTR', format: (v: number) => formatPercent(v * 100), row: 2 },
    cpc: { label: 'CPC', format: (v: number, currency: string) => formatCurrency(v, currency), row: 2 },
    cost: { label: 'Cost', format: (v: number, currency: string) => formatCurrency(v, currency), row: 1 },
    conv: { label: 'Conv', format: (v: number) => v.toFixed(1), row: 1 },
    convRate: { label: 'Conv Rate', format: (v: number) => formatPercent(v * 100), row: 2 },
    cpa: { label: 'CPA', format: (v: number, currency: string) => formatCurrency(v, currency), row: 2 },
    value: { label: 'Value', format: (v: number, currency: string) => formatCurrency(v, currency), row: 1 },
    roas: { label: 'ROAS', format: (v: number) => v.toFixed(2) + 'x', row: 2 }
} as const

export default function AdGroupsPage() {
    const { settings, fetchedData, dataError, isDataLoading, campaigns, refreshData } = useSettings()
    const [sortField, setSortField] = useState<SortField>('cost')
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
    const [currentPage, setCurrentPage] = useState(1)
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
    const [selectedMetrics, setSelectedMetrics] = useState<[DisplayMetric, DisplayMetric]>(['cost', 'value'])
    const [searchQuery, setSearchQuery] = useState('')
    const [minCost, setMinCost] = useState<string>('')
    const [showFilters, setShowFilters] = useState(false)

    // Get ad groups data
    const adGroupsRaw = useMemo(() => (fetchedData?.adGroups || []) as AdGroupRecord[], [fetchedData])

    // Filter by campaign, search, and cost
    const filteredAdGroups = useMemo(() => {
        let filtered = adGroupsRaw

        // Campaign filter
        if (selectedCampaignId) {
            filtered = filtered.filter(ag => ag.campaignId === selectedCampaignId)
        }

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase()
            filtered = filtered.filter(ag =>
                ag.campaign.toLowerCase().includes(query) ||
                ag.adGroup.toLowerCase().includes(query) ||
                ag.adGroupId.toLowerCase().includes(query)
            )
        }

        // Cost filter
        if (minCost && !isNaN(parseFloat(minCost))) {
            const minCostNum = parseFloat(minCost)
            filtered = filtered.filter(ag => ag.cost >= minCostNum)
        }

        return filtered
    }, [adGroupsRaw, selectedCampaignId, searchQuery, minCost])

    // Sort data
    const sortedAdGroups = useMemo(() => {
        return [...filteredAdGroups].sort((a, b) => {
            const aVal = a[sortField]
            const bVal = b[sortField]
            
            // Handle Date objects
            if (aVal instanceof Date && bVal instanceof Date) {
                return (aVal.getTime() - bVal.getTime()) * (sortDirection === 'asc' ? 1 : -1)
            }
            
            // Handle string sorting
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return aVal.localeCompare(bVal) * (sortDirection === 'asc' ? 1 : -1)
            }
            
            // Handle numeric sorting
            return (Number(aVal) - Number(bVal)) * (sortDirection === 'asc' ? 1 : -1)
        })
    }, [filteredAdGroups, sortField, sortDirection])

    // Pagination
    const paginationRange = usePagination({
        currentPage,
        totalCount: sortedAdGroups.length,
        siblingCount: 1,
        pageSize: PAGE_SIZE
    })

    const totalPages = Math.ceil(sortedAdGroups.length / PAGE_SIZE)
    const paginatedAdGroups = useMemo(() => {
        const startIndex = (currentPage - 1) * PAGE_SIZE
        return sortedAdGroups.slice(startIndex, startIndex + PAGE_SIZE)
    }, [sortedAdGroups, currentPage])

    // Aggregate metrics by date for chart
    const chartData = useMemo(() => {
        const metricsByDate = filteredAdGroups.reduce((acc, ag) => {
            const dateKey = ag.date instanceof Date 
                ? ag.date.toISOString().split('T')[0] 
                : String(ag.date)
            
            if (!acc[dateKey]) {
                acc[dateKey] = {
                    date: dateKey,
                    impr: 0,
                    clicks: 0,
                    cost: 0,
                    conv: 0,
                    value: 0,
                    ctr: 0,
                    cpc: 0,
                    convRate: 0,
                    cpa: 0,
                    roas: 0
                }
            }
            
            acc[dateKey].impr += ag.impr
            acc[dateKey].clicks += ag.clicks
            acc[dateKey].cost += ag.cost
            acc[dateKey].conv += ag.conv
            acc[dateKey].value += ag.value
            
            return acc
        }, {} as Record<string, any>)

        // Calculate derived metrics for each date
        return Object.values(metricsByDate).map((d: any) => ({
            ...d,
            ctr: d.impr > 0 ? d.clicks / d.impr : 0,
            cpc: d.clicks > 0 ? d.cost / d.clicks : 0,
            convRate: d.clicks > 0 ? d.conv / d.clicks : 0,
            cpa: d.conv > 0 ? d.cost / d.conv : 0,
            roas: d.cost > 0 ? d.value / d.cost : 0
        })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    }, [filteredAdGroups])

    // Calculate totals
    const calculateTotals = () => {
        if (filteredAdGroups.length === 0) return null

        const sums = filteredAdGroups.reduce((acc, ag) => ({
            impr: acc.impr + ag.impr,
            clicks: acc.clicks + ag.clicks,
            cost: acc.cost + ag.cost,
            conv: acc.conv + ag.conv,
            value: acc.value + ag.value,
        }), {
            impr: 0, clicks: 0, cost: 0, conv: 0, value: 0,
        })

        return {
            ...sums,
            ctr: sums.impr ? sums.clicks / sums.impr : 0,
            cpc: sums.clicks ? sums.cost / sums.clicks : 0,
            convRate: sums.clicks ? sums.conv / sums.clicks : 0,
            cpa: sums.conv ? sums.cost / sums.conv : 0,
            roas: sums.cost ? sums.value / sums.cost : 0,
        }
    }

    // Handle loading and error states
    if (dataError) {
        return (
            <div className="container mx-auto px-4 py-12 mt-16">
                <div className="text-red-500 mb-4 text-center">Error loading data</div>
            </div>
        )
    }

    if (isDataLoading) {
        return (
            <div className="container mx-auto px-4 py-12 mt-16">
                <div className="text-center">Loading...</div>
            </div>
        )
    }

    const handleSort = (field: SortField) => {
        const isStringField = ['campaign', 'campaignId', 'adGroup', 'adGroupId'].includes(field)
        const defaultDirection = isStringField ? 'asc' : 'desc'

        if (field === sortField) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection(defaultDirection)
        }
    }

    const handleMetricClick = (metric: DisplayMetric) => {
        setSelectedMetrics(prev => [prev[1], metric])
    }

    const SortButton = ({ field, children }: { field: SortField, children: React.ReactNode }) => (
        <Button
            variant="ghost"
            onClick={() => handleSort(field)}
            className="h-8 px-2 lg:px-3"
        >
            {children}
            {sortField === field && (
                <span className="ml-2">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
            )}
        </Button>
    )

    const totals = calculateTotals()
    if (!totals) {
        return (
            <div className="container mx-auto px-4 py-12 mt-16">
                <h1 className="text-3xl font-bold mb-12 text-gray-900">Ad Groups</h1>
                <div className="text-center">No ad group data found</div>
            </div>
        )
    }

    const getPerformanceBadge = (roas: number) => {
        if (roas >= 3) return <Badge className="bg-green-500">High</Badge>
        if (roas >= 1.5) return <Badge className="bg-blue-500">Good</Badge>
        if (roas >= 0.5) return <Badge className="bg-yellow-500">Fair</Badge>
        return <Badge variant="destructive">Low</Badge>
    }

    const exportData = () => {
        const csv = [
            ['Campaign', 'Ad Group', 'Date', 'Impressions', 'Clicks', 'CTR', 'Cost', 'CPC', 'Conversions', 'Conv Rate', 'Value', 'CPA', 'ROAS'].join(','),
            ...sortedAdGroups.map(ag => [
                `"${ag.campaign}"`,
                `"${ag.adGroup}"`,
                ag.date instanceof Date ? ag.date.toISOString().split('T')[0] : String(ag.date),
                ag.impr,
                ag.clicks,
                (ag.ctr * 100).toFixed(2) + '%',
                ag.cost.toFixed(2),
                ag.cpc.toFixed(2),
                ag.conv.toFixed(1),
                (ag.convRate * 100).toFixed(2) + '%',
                ag.value.toFixed(2),
                ag.cpa.toFixed(2),
                ag.roas.toFixed(2)
            ].join(','))
        ].join('\n')

        const blob = new Blob([csv], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `ad-groups-${new Date().toISOString().split('T')[0]}.csv`
        a.click()
        window.URL.revokeObjectURL(url)
    }

    return (
        <div className="container mx-auto px-4 py-8 mt-16">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-4xl font-bold text-gray-900 mb-2">Ad Groups Performance</h1>
                        <p className="text-gray-600">Monitor and analyze your ad group metrics across campaigns</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refreshData()}
                            disabled={isDataLoading}
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${isDataLoading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={exportData}
                            disabled={sortedAdGroups.length === 0}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Export CSV
                        </Button>
                    </div>
                </div>

                {/* Search and Filters Bar */}
                <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-lg border shadow-sm">
                    <div className="flex-1 min-w-[300px] relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search campaigns or ad groups..."
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setCurrentPage(1)
                            }}
                            className="pl-10"
                        />
                    </div>
                    
                    <Select value={selectedCampaignId || "all"} onValueChange={(value) => {
                        setSelectedCampaignId(value === "all" ? "" : value)
                        setCurrentPage(1)
                    }}>
                        <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="All Campaigns" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Campaigns ({adGroupsRaw.length})</SelectItem>
                            {campaigns?.map(campaign => (
                                <SelectItem key={campaign.id} value={campaign.id}>
                                    {campaign.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowFilters(!showFilters)}
                        className={showFilters ? 'bg-gray-100' : ''}
                    >
                        <SlidersHorizontal className="h-4 w-4 mr-2" />
                        Filters
                        {(minCost) && <Badge variant="secondary" className="ml-2">1</Badge>}
                    </Button>
                </div>

                {/* Advanced Filters */}
                {showFilters && (
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg border">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Min Cost ({settings.currency})
                                </label>
                                <Input
                                    type="number"
                                    placeholder="0.00"
                                    value={minCost}
                                    onChange={(e) => {
                                        setMinCost(e.target.value)
                                        setCurrentPage(1)
                                    }}
                                    step="0.01"
                                />
                            </div>
                            <div className="flex items-end">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setMinCost('')
                                        setSearchQuery('')
                                        setSelectedCampaignId('')
                                        setCurrentPage(1)
                                    }}
                                >
                                    Clear All Filters
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Results Summary */}
                <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
                    <span>
                        Showing <strong>{filteredAdGroups.length.toLocaleString()}</strong> of <strong>{adGroupsRaw.length.toLocaleString()}</strong> ad groups
                    </span>
                    {(selectedCampaignId || searchQuery || minCost) && (
                        <Badge variant="secondary">Filtered</Badge>
                    )}
                </div>
            </div>

            {/* Key Metrics Scorecards */}
            <div className="space-y-4 mb-8">
                {[1, 2].map(row => (
                    <div key={row} className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                        {Object.entries(metricConfig)
                            .filter(([_, config]) => config.row === row)
                            .map(([key, config]) => (
                                <MetricCard
                                    key={key}
                                    label={config.label}
                                    value={config.format(totals[key as DisplayMetric], settings.currency)}
                                    isSelected={selectedMetrics.includes(key as DisplayMetric)}
                                    onClick={() => handleMetricClick(key as DisplayMetric)}
                                />
                            ))}
                    </div>
                ))}
            </div>

            {/* Performance Chart */}
            {chartData.length > 0 && (
                <div className="mb-8">
                    <MetricsChart
                        data={chartData}
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
                </div>
            )}

            {/* Ad Groups Table */}
            <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-50">
                                <TableHead className="w-[180px] font-semibold">
                                    <SortButton field="campaign">Campaign</SortButton>
                                </TableHead>
                                <TableHead className="w-[150px] font-semibold">
                                    <SortButton field="adGroup">Ad Group</SortButton>
                                </TableHead>
                                <TableHead className="w-[100px] font-semibold">
                                    <SortButton field="date">Date</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="impr">Impr</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="clicks">Clicks</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="ctr">CTR</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="cost">Cost</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="cpc">CPC</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="conv">Conv</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="convRate">Conv Rate</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="value">Value</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="cpa">CPA</SortButton>
                                </TableHead>
                                <TableHead className="text-right font-semibold">
                                    <SortButton field="roas">ROAS</SortButton>
                                </TableHead>
                                <TableHead className="w-[80px] font-semibold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedAdGroups.map((ag, i) => {
                                const dateStr = ag.date instanceof Date 
                                    ? ag.date.toISOString().split('T')[0] 
                                    : String(ag.date)
                                
                                const isHighPerformer = ag.roas >= 2 && ag.conv > 0
                                const isLowPerformer = ag.cost > 50 && ag.conv === 0
                                
                                return (
                                    <TableRow 
                                        key={`${ag.adGroupId}-${dateStr}-${i}`}
                                        className={`hover:bg-gray-50 transition-colors ${isHighPerformer ? 'bg-green-50/30' : isLowPerformer ? 'bg-red-50/30' : ''}`}
                                    >
                                        <TableCell className="font-medium">
                                            <div className="max-w-[180px] truncate" title={ag.campaign}>
                                                {ag.campaign}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="max-w-[150px] truncate font-medium" title={ag.adGroup}>
                                                {ag.adGroup}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-600">{dateStr}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatNumber(ag.impr)}</TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">{formatNumber(ag.clicks)}</TableCell>
                                        <TableCell className={`text-right tabular-nums ${ag.ctr >= 0.05 ? 'text-green-600 font-medium' : ag.ctr < 0.01 ? 'text-red-600' : ''}`}>
                                            {formatPercent(ag.ctr * 100)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">{formatCurrency(ag.cost, settings.currency)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(ag.cpc, settings.currency)}</TableCell>
                                        <TableCell className={`text-right tabular-nums ${ag.conv > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                                            {ag.conv > 0 ? ag.conv.toFixed(1) : '-'}
                                        </TableCell>
                                        <TableCell className={`text-right tabular-nums ${ag.convRate >= 0.02 ? 'text-green-600 font-medium' : ''}`}>
                                            {ag.convRate > 0 ? formatPercent(ag.convRate * 100) : '-'}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">{formatCurrency(ag.value, settings.currency)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{ag.conv > 0 ? formatCurrency(ag.cpa, settings.currency) : '-'}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {ag.roas && isFinite(ag.roas) && ag.roas > 0 ? (
                                                <span className={ag.roas >= 2 ? 'text-green-600 font-bold' : ag.roas >= 1 ? 'text-blue-600 font-medium' : 'text-orange-600'}>
                                                    {ag.roas >= 2 && <TrendingUp className="inline h-3 w-3 mr-1" />}
                                                    {ag.roas < 1 && <TrendingDown className="inline h-3 w-3 mr-1" />}
                                                    {ag.roas.toFixed(2)}x
                                                </span>
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {ag.conv > 0 && getPerformanceBadge(ag.roas)}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between mt-6 gap-4">
                <div className="text-sm text-gray-600">
                    Showing <span className="font-semibold text-gray-900">{((currentPage - 1) * PAGE_SIZE) + 1}</span> to{' '}
                    <span className="font-semibold text-gray-900">{Math.min(currentPage * PAGE_SIZE, filteredAdGroups.length)}</span> of{' '}
                    <span className="font-semibold text-gray-900">{filteredAdGroups.length.toLocaleString()}</span> ad groups
                </div>
                <Pagination>
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault()
                                    setCurrentPage(prev => Math.max(prev - 1, 1))
                                }}
                                className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
                            />
                        </PaginationItem>

                        {paginationRange?.map((pageNumber, index) => {
                            if (pageNumber === DOTS) {
                                return <PaginationItem key={`dots-${index}`}><PaginationEllipsis /></PaginationItem>
                            }

                            return (
                                <PaginationItem key={pageNumber}>
                                    <PaginationLink
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            setCurrentPage(pageNumber as number)
                                        }}
                                        isActive={currentPage === pageNumber}
                                    >
                                        {pageNumber}
                                    </PaginationLink>
                                </PaginationItem>
                            )
                        })}

                        <PaginationItem>
                            <PaginationNext
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault()
                                    setCurrentPage(prev => Math.min(prev + 1, totalPages))
                                }}
                                className={currentPage === totalPages ? "pointer-events-none opacity-50" : undefined}
                            />
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            </div>
        </div>
    )
}

