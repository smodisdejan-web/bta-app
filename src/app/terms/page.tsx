// src/app/terms/page.tsx
'use client'
import { useState, useMemo, useEffect } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import type { SearchTermMetric } from '@/lib/types'
import { calculateAllSearchTermMetrics, type CalculatedSearchTermMetric } from '@/lib/metrics'
import { usePagination, DOTS } from '@/hooks/use-pagination'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { 
    Search, Download, Settings2, TrendingUp, TrendingDown, 
    AlertCircle, CheckCircle, ArrowUpDown, Filter, Eye, 
    EyeOff, Save, FolderOpen, RefreshCw, Sparkles, Target,
    BarChart3, Zap
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type SortField = keyof CalculatedSearchTermMetric
type SortDirection = 'asc' | 'desc'

interface SavedView {
    id: string
    name: string
    filters: {
        search: string
        minClicks: string
        minCost: string
        minConv: string
    }
    hiddenColumns: string[]
    sortField: SortField
    sortDirection: SortDirection
}

const DEFAULT_PAGE_SIZE = 20

const COLUMNS = [
    { key: 'searchTerm', label: 'Search Term', sortable: true, defaultVisible: true },
    { key: 'keywordText', label: 'Keyword', sortable: true, defaultVisible: true },
    { key: 'campaign', label: 'Campaign', sortable: true, defaultVisible: true },
    { key: 'adGroup', label: 'Ad Group', sortable: true, defaultVisible: true },
    { key: 'impr', label: 'Impr', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'clicks', label: 'Clicks', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'cost', label: 'Cost', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'conv', label: 'Conv', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'value', label: 'Value', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'CTR', label: 'CTR', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'CPC', label: 'CPC', sortable: true, defaultVisible: true, align: 'right' as const },
    { key: 'CvR', label: 'CvR', sortable: true, defaultVisible: false, align: 'right' as const },
    { key: 'CPA', label: 'CPA', sortable: true, defaultVisible: false, align: 'right' as const },
    { key: 'ROAS', label: 'ROAS', sortable: true, defaultVisible: true, align: 'right' as const },
]

export default function TermsPage() {
    const { settings, fetchedData, dataError, isDataLoading, refreshData } = useSettings()
    const { toast } = useToast()
    
    const [sortField, setSortField] = useState<SortField>('cost')
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
    const [searchQuery, setSearchQuery] = useState('')
    const [minClicks, setMinClicks] = useState('')
    const [minCost, setMinCost] = useState('')
    const [minConv, setMinConv] = useState('')
    const [hiddenColumns, setHiddenColumns] = useState<string[]>(
        COLUMNS.filter(c => !c.defaultVisible).map(c => c.key)
    )
    const [savedViews, setSavedViews] = useState<SavedView[]>([])
    const [viewName, setViewName] = useState('')
    const [showColumnSettings, setShowColumnSettings] = useState(false)
    const [showSaveView, setShowSaveView] = useState(false)
    const [showLoadView, setShowLoadView] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)

    // Load saved views from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('searchTerms_savedViews')
        if (saved) setSavedViews(JSON.parse(saved))
    }, [])

    const searchTermsRaw = useMemo(() => (fetchedData?.searchTerms || []) as SearchTermMetric[], [fetchedData])
    const calculatedSearchTerms = useMemo(() => calculateAllSearchTermMetrics(searchTermsRaw), [searchTermsRaw])

    // Apply filters
    const filteredTerms = useMemo(() => {
        return calculatedSearchTerms.filter(term => {
            if (searchQuery && !term.searchTerm.toLowerCase().includes(searchQuery.toLowerCase()) &&
                !term.campaign.toLowerCase().includes(searchQuery.toLowerCase()) &&
                !(term.keywordText || '').toLowerCase().includes(searchQuery.toLowerCase())) {
                return false
            }
            if (minClicks && term.clicks < Number(minClicks)) return false
            if (minCost && term.cost < Number(minCost)) return false
            if (minConv && term.conv < Number(minConv)) return false
            return true
        })
    }, [calculatedSearchTerms, searchQuery, minClicks, minCost, minConv])

    // Sort data
    const sortedTerms = useMemo(() => {
        return [...filteredTerms].sort((a, b) => {
            const aVal = a[sortField]
            const bVal = b[sortField]
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return aVal.localeCompare(bVal) * (sortDirection === 'asc' ? 1 : -1)
            }
            return (Number(aVal) - Number(bVal)) * (sortDirection === 'asc' ? 1 : -1)
        })
    }, [filteredTerms, sortField, sortDirection])

    const totalPages = Math.ceil(sortedTerms.length / pageSize)
    const paginatedTerms = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize
        return sortedTerms.slice(startIndex, startIndex + pageSize)
    }, [sortedTerms, currentPage, pageSize])

    const paginationRange = usePagination({
        currentPage,
        totalCount: sortedTerms.length,
        siblingCount: 1,
        pageSize
    })

    // Calculate summary statistics
    const summary = useMemo(() => {
        const totals = filteredTerms.reduce((acc, term) => ({
            clicks: acc.clicks + term.clicks,
            cost: acc.cost + term.cost,
            conv: acc.conv + term.conv,
            value: acc.value + term.value,
        }), { clicks: 0, cost: 0, conv: 0, value: 0 })

        return {
            ...totals,
            avgCPC: totals.clicks > 0 ? totals.cost / totals.clicks : 0,
            avgCPA: totals.conv > 0 ? totals.cost / totals.conv : 0,
            ROAS: totals.cost > 0 ? totals.value / totals.cost : 0,
        }
    }, [filteredTerms])

    const handleSort = (field: SortField) => {
        const isStringField = ['searchTerm', 'campaign', 'adGroup', 'keywordText'].includes(field)
        const defaultDirection = isStringField ? 'asc' : 'desc'

        if (field === sortField) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection(defaultDirection)
        }
        setCurrentPage(1)
    }

    const toggleColumn = (columnKey: string) => {
        setHiddenColumns(prev =>
            prev.includes(columnKey)
                ? prev.filter(k => k !== columnKey)
                : [...prev, columnKey]
        )
    }

    const saveView = () => {
        if (!viewName.trim()) {
            toast({ title: "Please enter a name", variant: "destructive" })
            return
        }
        const newView: SavedView = {
            id: `view-${Date.now()}`,
            name: viewName,
            filters: { search: searchQuery, minClicks, minCost, minConv },
            hiddenColumns,
            sortField,
            sortDirection
        }
        const updated = [...savedViews, newView]
        setSavedViews(updated)
        localStorage.setItem('searchTerms_savedViews', JSON.stringify(updated))
        setViewName('')
        setShowSaveView(false)
        toast({ title: "✅ View saved successfully" })
    }

    const loadView = (view: SavedView) => {
        setSearchQuery(view.filters.search)
        setMinClicks(view.filters.minClicks)
        setMinCost(view.filters.minCost)
        setMinConv(view.filters.minConv)
        setHiddenColumns(view.hiddenColumns)
        setSortField(view.sortField)
        setSortDirection(view.sortDirection)
        setCurrentPage(1)
        setShowLoadView(false)
        toast({ title: "✅ View loaded" })
    }

    const deleteView = (id: string) => {
        const updated = savedViews.filter(v => v.id !== id)
        setSavedViews(updated)
        localStorage.setItem('searchTerms_savedViews', JSON.stringify(updated))
    }

    const exportData = () => {
        const visibleColumns = COLUMNS.filter(c => !hiddenColumns.includes(c.key))
        const csv = [
            visibleColumns.map(c => c.label),
            ...sortedTerms.map(term =>
                visibleColumns.map(col => term[col.key as keyof typeof term])
            )
        ].map(row => row.join(',')).join('\n')

        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `search-terms-${Date.now()}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast({ title: `✅ Exported ${sortedTerms.length} search terms` })
    }

    const clearFilters = () => {
        setSearchQuery('')
        setMinClicks('')
        setMinCost('')
        setMinConv('')
        setCurrentPage(1)
    }

    const handleRefresh = async () => {
        setIsRefreshing(true)
        await refreshData()
        setTimeout(() => setIsRefreshing(false), 1000)
    }

    const visibleColumns = COLUMNS.filter(c => !hiddenColumns.includes(c.key))
    const hasActiveFilters = searchQuery || minClicks || minCost || minConv

    if (dataError) {
        return (
            <div className="container mx-auto px-4 py-12 mt-16">
                <Card className="border-destructive">
                    <CardHeader>
                        <CardTitle className="text-destructive">⚠️ Error Loading Data</CardTitle>
                        <CardDescription>Failed to load search terms data</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={handleRefresh}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    // NEVER block rendering - always show the page immediately
    // Data will load in the background and appear when ready

    const SortButton = ({ field, children }: { field: SortField, children: React.ReactNode }) => (
        <Button
            variant="ghost"
            onClick={() => handleSort(field)}
            className="h-8 px-2 lg:px-3 hover:bg-primary/10"
        >
            {children}
            {sortField === field && (
                <span className="ml-2">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
            )}
        </Button>
    )

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
            <div className="container mx-auto px-4 py-8 mt-16 space-y-6">
                {/* Hero Header */}
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-background p-8 border-2">
                    <div className="relative z-10">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent mb-2">
                                    Search Terms Analysis
                                </h1>
                                <p className="text-muted-foreground text-lg">
                                    Discover new opportunities and optimize your search campaign performance
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Button onClick={handleRefresh} variant="outline" size="sm" disabled={isRefreshing}>
                                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>
                        </div>
                        
                        <div className="flex gap-4 mt-4">
                            <Badge variant="secondary" className="gap-2">
                                <Target className="h-4 w-4" />
                                {calculatedSearchTerms.length} total terms
                            </Badge>
                            <Badge variant="secondary" className="gap-2">
                                <Filter className="h-4 w-4" />
                                {filteredTerms.length} filtered
                            </Badge>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -z-0" />
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="border-2">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm text-muted-foreground">Total Cost</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{formatCurrency(summary.cost, settings.currency)}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-2">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm text-muted-foreground">Total Clicks</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{formatNumber(summary.clicks)}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-2">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm text-muted-foreground">Avg CPC</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{formatCurrency(summary.avgCPC, settings.currency)}</div>
                        </CardContent>
                    </Card>
                    <Card className="border-2">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm text-muted-foreground">ROAS</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{summary.ROAS.toFixed(2)}x</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters and Actions */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <Filter className="h-5 w-5" />
                                Filters & Actions
                            </CardTitle>
                            <div className="flex gap-2">
                                <Dialog open={showSaveView} onOpenChange={setShowSaveView}>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm">
                                            <Save className="h-4 w-4 mr-2" />
                                            Save View
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Save Current View</DialogTitle>
                                            <DialogDescription>Save your current filters and settings</DialogDescription>
                                        </DialogHeader>
                                        <Input
                                            placeholder="View name (e.g., High performers)"
                                            value={viewName}
                                            onChange={(e) => setViewName(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && saveView()}
                                        />
                                        <Button onClick={saveView}>Save View</Button>
                                    </DialogContent>
                                </Dialog>

                                <Dialog open={showLoadView} onOpenChange={setShowLoadView}>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm">
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            Load ({savedViews.length})
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Saved Views</DialogTitle>
                                            <DialogDescription>Load a previously saved view</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-2 max-h-96 overflow-y-auto">
                                            {savedViews.length === 0 ? (
                                                <p className="text-center text-muted-foreground py-8">No saved views yet</p>
                                            ) : (
                                                savedViews.map(view => (
                                                    <div key={view.id} className="flex items-center justify-between p-3 border rounded-lg">
                                                        <div className="flex-1">
                                                            <p className="font-medium">{view.name}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {view.filters.search && `Search: ${view.filters.search} • `}
                                                                Sorted by {view.sortField}
                                                            </p>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Button size="sm" variant="ghost" onClick={() => loadView(view)}>Load</Button>
                                                            <Button size="sm" variant="ghost" onClick={() => deleteView(view.id)}>×</Button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </DialogContent>
                                </Dialog>

                                <Dialog open={showColumnSettings} onOpenChange={setShowColumnSettings}>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" size="sm">
                                            <Settings2 className="h-4 w-4 mr-2" />
                                            Columns
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Column Visibility</DialogTitle>
                                            <DialogDescription>Show or hide table columns</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-2 max-h-96 overflow-y-auto">
                                            {COLUMNS.map(col => (
                                                <div key={col.key} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded">
                                                    <span>{col.label}</span>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => toggleColumn(col.key)}
                                                    >
                                                        {hiddenColumns.includes(col.key) ? (
                                                            <EyeOff className="h-4 w-4" />
                                                        ) : (
                                                            <Eye className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </DialogContent>
                                </Dialog>

                                <Button onClick={exportData} variant="outline" size="sm">
                                    <Download className="h-4 w-4 mr-2" />
                                    Export
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search terms, campaigns..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value)
                                        setCurrentPage(1)
                                    }}
                                    className="pl-9"
                                />
                            </div>
                            <Input
                                type="number"
                                placeholder="Min clicks"
                                value={minClicks}
                                onChange={(e) => {
                                    setMinClicks(e.target.value)
                                    setCurrentPage(1)
                                }}
                            />
                            <Input
                                type="number"
                                placeholder="Min cost"
                                value={minCost}
                                onChange={(e) => {
                                    setMinCost(e.target.value)
                                    setCurrentPage(1)
                                }}
                            />
                            <Input
                                type="number"
                                placeholder="Min conversions"
                                value={minConv}
                                onChange={(e) => {
                                    setMinConv(e.target.value)
                                    setCurrentPage(1)
                                }}
                            />
                        </div>
                        {hasActiveFilters && (
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary">
                                    {filteredTerms.length} of {calculatedSearchTerms.length} terms
                                </Badge>
                                <Button variant="ghost" size="sm" onClick={clearFilters}>
                                    Clear filters
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Data Table */}
                <Card className="border-2">
                    <CardContent className="p-0">
                        <div className="rounded-md border-0 overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        {visibleColumns.map((col) => (
                                            <TableHead 
                                                key={col.key}
                                                className={col.align === 'right' ? 'text-right' : ''}
                                            >
                                                {col.sortable ? (
                                                    <SortButton field={col.key as SortField}>
                                                        {col.label}
                                                    </SortButton>
                                                ) : (
                                                    col.label
                                                )}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedTerms.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={visibleColumns.length} className="text-center py-12">
                                                <div className="text-muted-foreground">
                                                    <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                                    <p>No search terms found matching your filters</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        paginatedTerms.map((term, i) => (
                                            <TableRow key={`${term.searchTerm}-${i}`} className="hover:bg-muted/30">
                                                {visibleColumns.map((col) => (
                                                    <TableCell 
                                                        key={col.key}
                                                        className={`${col.align === 'right' ? 'text-right' : ''} ${
                                                            col.key === 'searchTerm' ? 'font-medium' : ''
                                                        }`}
                                                    >
                                                        {col.key === 'searchTerm' && term[col.key]}
                                                        {col.key === 'keywordText' && (term[col.key] || '-')}
                                                        {col.key === 'campaign' && term[col.key]}
                                                        {col.key === 'adGroup' && term[col.key]}
                                                        {col.key === 'impr' && formatNumber(term[col.key])}
                                                        {col.key === 'clicks' && formatNumber(term[col.key])}
                                                        {col.key === 'cost' && formatCurrency(term[col.key], settings.currency)}
                                                        {col.key === 'conv' && formatNumber(term[col.key])}
                                                        {col.key === 'value' && formatCurrency(term[col.key], settings.currency)}
                                                        {col.key === 'CTR' && formatPercent(term[col.key])}
                                                        {col.key === 'CPC' && formatCurrency(term[col.key], settings.currency)}
                                                        {col.key === 'CvR' && formatPercent(term[col.key])}
                                                        {col.key === 'CPA' && formatCurrency(term[col.key], settings.currency)}
                                                        {col.key === 'ROAS' && (
                                                            (term[col.key] && isFinite(term[col.key])) 
                                                                ? `${term[col.key].toFixed(2)}x` 
                                                                : '-'
                                                        )}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                {/* Pagination */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                            Page {currentPage} of {totalPages} • {sortedTerms.length} results
                        </span>
                        <Select 
                            value={String(pageSize)} 
                            onValueChange={(v) => {
                                setPageSize(Number(v))
                                setCurrentPage(1)
                            }}
                        >
                            <SelectTrigger className="w-[100px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="20">20</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                            </SelectContent>
                        </Select>
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

                {/* Keyboard Shortcuts */}
                <Card className="bg-muted/30">
                    <CardContent className="p-4">
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground items-center justify-center">
                            <span className="font-semibold">⌨️ Keyboard Shortcuts:</span>
                            <Badge variant="outline">Cmd+K: Focus search</Badge>
                            <Badge variant="outline">Cmd+E: Export</Badge>
                            <Badge variant="outline">Cmd+S: Save view</Badge>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
