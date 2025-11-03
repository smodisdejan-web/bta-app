'use client'

import { useState, useEffect, useMemo } from 'react'
import { Budget, BudgetPacingData, SpendEntry, BudgetSortKey, SortDirection, PacingStatus } from '@/lib/types'
import { 
  loadBudgets, 
  saveBudgets, 
  addBudget, 
  updateBudget, 
  deleteBudget,
  calculateBudgetPacing,
  exportBudgetsToCSV
} from '@/lib/budgetPacing'
import { BudgetEntryForm } from '@/components/BudgetEntryForm'
import { CSVUpload } from '@/components/CSVUpload'
import { BudgetCard } from '@/components/BudgetCard'
import { BudgetTable } from '@/components/BudgetTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { Check, ChevronsUpDown } from 'lucide-react'

type ViewMode = 'cards' | 'table'

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<BudgetSortKey>('pacing')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterPacingStatus, setFilterPacingStatus] = useState<string>('all')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { toast } = useToast()

  // Load budgets on mount
  useEffect(() => {
    const loaded = loadBudgets()
    setBudgets(loaded)
  }, [])

  // Calculate pacing data for all budgets
  const pacingData = useMemo(() => {
    return budgets.map(budget => calculateBudgetPacing(budget))
  }, [budgets])

  // Get unique campaign names for dropdown
  const campaignNames = useMemo(() => {
    const names = new Set<string>()
    budgets.forEach(budget => {
      names.add(budget.campaignName)
      if (budget.accountName) {
        names.add(budget.accountName)
      }
    })
    return Array.from(names).sort()
  }, [budgets])

  // Filter and sort pacing data
  const filteredAndSortedData = useMemo(() => {
    let filtered = pacingData

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(pd => 
        pd.budget.campaignName.toLowerCase().includes(query) ||
        pd.budget.accountName?.toLowerCase().includes(query)
      )
    }

    // Filter by pacing status
    if (filterPacingStatus !== 'all') {
      filtered = filtered.filter(pd => pd.pacingStatus === filterPacingStatus)
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'name':
          comparison = a.budget.campaignName.localeCompare(b.budget.campaignName)
          break
        case 'budget':
          comparison = a.budget.totalBudget - b.budget.totalBudget
          break
        case 'pacing':
          comparison = Math.abs(b.pacingDeviation) - Math.abs(a.pacingDeviation)
          break
        case 'overpacing':
          comparison = b.pacingDeviation - a.pacingDeviation
          break
        case 'underpacing':
          comparison = a.pacingDeviation - b.pacingDeviation
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return sorted
  }, [pacingData, searchQuery, filterPacingStatus, sortBy, sortDirection])

  const handleAddBudget = (budget: Budget) => {
    addBudget(budget)
    setBudgets(loadBudgets())
    toast({
      title: 'Budget added',
      description: `Budget for ${budget.campaignName} has been added`
    })
  }

  const handleBudgetsImported = (importedBudgets: Budget[]) => {
    importedBudgets.forEach(budget => addBudget(budget))
    setBudgets(loadBudgets())
    toast({
      title: 'Budgets imported',
      description: `${importedBudgets.length} budget(s) imported successfully`
    })
  }

  const handleSpendImported = (spendData: { campaignName: string; entries: SpendEntry[] }[]) => {
    const currentBudgets = loadBudgets()
    let updatedCount = 0

    spendData.forEach(({ campaignName, entries }) => {
      const budget = currentBudgets.find(b => 
        b.campaignName.toLowerCase() === campaignName.toLowerCase()
      )
      
      if (budget) {
        // Merge spend entries, avoiding duplicates by date
        const existingDates = new Set(budget.spendEntries.map(e => e.date))
        const newEntries = entries.filter(e => !existingDates.has(e.date))
        
        if (newEntries.length > 0) {
          updateBudget(budget.id, {
            spendEntries: [...budget.spendEntries, ...newEntries]
          })
          updatedCount++
        }
      }
    })

    setBudgets(loadBudgets())
    toast({
      title: 'Spend data imported',
      description: `Updated spend data for ${updatedCount} campaign(s)`
    })
  }

  const handleAddSpend = (budgetId: string, spendEntry: SpendEntry) => {
    const budget = budgets.find(b => b.id === budgetId)
    if (budget) {
      updateBudget(budgetId, {
        spendEntries: [...budget.spendEntries, spendEntry]
      })
      setBudgets(loadBudgets())
      toast({
        title: 'Spend added',
        description: `Spend entry added for ${budget.campaignName}`
      })
    }
  }

  const handleDeleteBudget = (budgetId: string) => {
    const budget = budgets.find(b => b.id === budgetId)
    if (budget && confirm(`Are you sure you want to delete the budget for "${budget.campaignName}"?`)) {
      deleteBudget(budgetId)
      setBudgets(loadBudgets())
      toast({
        title: 'Budget deleted',
        description: `Budget for ${budget.campaignName} has been deleted`
      })
    }
  }

  const handleExportCSV = () => {
    const csv = exportBudgetsToCSV(filteredAndSortedData)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `budget-pacing-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    toast({
      title: 'Export successful',
      description: 'Budget pacing data exported to CSV'
    })
  }

  // Summary statistics and pacing insights
  const stats = useMemo(() => {
    const totalBudget = pacingData.reduce((sum, pd) => sum + pd.budget.totalBudget, 0)
    const totalSpend = pacingData.reduce((sum, pd) => sum + pd.totalSpend, 0)
    const onTrack = pacingData.filter(pd => pd.pacingStatus === 'on-track').length
    const slightOff = pacingData.filter(pd => pd.pacingStatus === 'slight-off').length
    const moderateOff = pacingData.filter(pd => pd.pacingStatus === 'moderate-off').length
    const critical = pacingData.filter(pd => pd.pacingStatus === 'critical').length

    const avgDeviation = pacingData.length
      ? pacingData.reduce((s, pd) => s + Math.abs(pd.pacingDeviation), 0) / pacingData.length
      : 0
    const avgDailyNeeded = pacingData.length
      ? pacingData.reduce((s, pd) => s + pd.dailyBudgetNeeded, 0) / pacingData.length
      : 0
    const projectedEndSpend = pacingData.reduce((s, pd) => s + pd.projectedEndSpend, 0)

    const percentBudgetSpent = totalBudget > 0 ? (totalSpend / totalBudget) : 0

    return {
      totalBudget,
      totalSpend,
      onTrack,
      slightOff,
      moderateOff,
      critical,
      total: pacingData.length,
      avgDeviation,
      avgDailyNeeded,
      projectedEndSpend,
      percentBudgetSpent
    }
  }, [pacingData])

  const formatCurrency = (v: number) => `€${v.toFixed(2)}`
  const formatPercent = (v: number) => `${(v * 100).toFixed(1)}%`

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Budget Pacing Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Monitor and manage campaign budget pacing across your accounts
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Total Campaigns</p>
            <p className="text-2xl font-bold">{stats.total}</p>
            <div className="mt-2 text-xs text-muted-foreground">
              {stats.onTrack} on-track • {stats.critical} critical
            </div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Total Budget</p>
            <p className="text-2xl font-bold">{formatCurrency(stats.totalBudget)}</p>
            <div className="mt-3 h-2 bg-muted rounded">
              <div
                className="h-2 bg-primary rounded"
                style={{ width: formatPercent(stats.percentBudgetSpent) }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{formatPercent(stats.percentBudgetSpent)} spent</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Total Spend</p>
            <p className="text-2xl font-bold">{formatCurrency(stats.totalSpend)}</p>
            <div className="mt-2 text-xs text-muted-foreground">Projected end spend: {formatCurrency(stats.projectedEndSpend)}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Pacing Health</p>
            <p className="text-2xl font-bold">{stats.avgDeviation.toFixed(1)}%</p>
            <div className="mt-2 text-xs text-muted-foreground">Avg deviation • Daily needed {formatCurrency(stats.avgDailyNeeded)}</div>
          </div>
        </div>

        {/* Status Quick Filters */}
        {budgets.length > 0 && (
          <div className="bg-card border rounded-lg p-3 flex flex-wrap gap-2">
            {([
              { key: 'all', label: 'All', count: pacingData.length },
              { key: 'on-track', label: 'On Track', count: pacingData.filter(p => p.pacingStatus === 'on-track').length },
              { key: 'slight-off', label: 'Slight Off', count: pacingData.filter(p => p.pacingStatus === 'slight-off').length },
              { key: 'moderate-off', label: 'Moderate Off', count: pacingData.filter(p => p.pacingStatus === 'moderate-off').length },
              { key: 'critical', label: 'Critical', count: pacingData.filter(p => p.pacingStatus === 'critical').length }
            ] as Array<{ key: string; label: string; count: number }>).map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilterPacingStatus(tab.key)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                  filterPacingStatus === tab.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-muted'
                }`}
              >
                {tab.label} <span className="text-xs text-muted-foreground ml-1">{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between bg-card border rounded-lg p-4">
          <div className="flex flex-wrap gap-2">
            <BudgetEntryForm onSubmit={handleAddBudget} />
            <CSVUpload
              type="budget"
              onBudgetsImported={handleBudgetsImported}
            />
            <CSVUpload
              type="spend"
              onSpendImported={handleSpendImported}
              trigger={<Button variant="outline">Import Spend CSV</Button>}
            />
            <Button variant="outline" onClick={handleExportCSV}>
              Export CSV
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant={viewMode === 'cards' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('cards')}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Cards
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Table
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 bg-card border rounded-lg p-4">
          <div className="flex-1 relative">
            <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {searchQuery || 'Search campaigns or accounts...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <div className="p-2 border-b">
                  <Input
                    placeholder="Type to search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsSearchOpen(false)
                      }
                    }}
                  />
                </div>
                <div className="max-h-[200px] overflow-auto">
                  <div
                    className="px-2 py-1.5 text-sm hover:bg-accent cursor-pointer flex items-center"
                    onClick={() => {
                      setSearchQuery('')
                      setIsSearchOpen(false)
                    }}
                  >
                    <Check className={`mr-2 h-4 w-4 ${!searchQuery ? 'opacity-100' : 'opacity-0'}`} />
                    All Campaigns
                  </div>
                  {campaignNames.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No campaigns found</div>
                  ) : (
                    campaignNames
                      .filter(name => 
                        !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((name) => (
                        <div
                          key={name}
                          className="px-2 py-1.5 text-sm hover:bg-accent cursor-pointer flex items-center"
                          onClick={() => {
                            setSearchQuery(name)
                            setIsSearchOpen(false)
                          }}
                        >
                          <Check className={`mr-2 h-4 w-4 ${searchQuery === name ? 'opacity-100' : 'opacity-0'}`} />
                          {name}
                        </div>
                      ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          
          <Select value={filterPacingStatus} onValueChange={setFilterPacingStatus}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Pacing Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="on-track">On Track</SelectItem>
              <SelectItem value="slight-off">Slight Off</SelectItem>
              <SelectItem value="moderate-off">Moderate Off</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(value) => setSortBy(value as BudgetSortKey)}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pacing">Most Off Pace</SelectItem>
              <SelectItem value="overpacing">Most Overpacing</SelectItem>
              <SelectItem value="underpacing">Most Underpacing</SelectItem>
              <SelectItem value="budget">Budget Size</SelectItem>
              <SelectItem value="name">Campaign Name</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
            title={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </Button>
        </div>

        {/* Budget Display */}
        {budgets.length === 0 ? (
          <div className="bg-card border rounded-lg p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-4 text-lg font-semibold">No budgets yet</h3>
            <p className="mt-2 text-muted-foreground">
              Get started by adding a campaign budget or importing from CSV
            </p>
            <div className="mt-6 flex gap-2 justify-center">
              <BudgetEntryForm onSubmit={handleAddBudget} />
              <CSVUpload
                type="budget"
                onBudgetsImported={handleBudgetsImported}
              />
            </div>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedData.map((pd) => (
              <BudgetCard
                key={pd.budget.id}
                pacingData={pd}
                onAddSpend={handleAddSpend}
                onDelete={handleDeleteBudget}
              />
            ))}
          </div>
        ) : (
          <BudgetTable
            pacingData={filteredAndSortedData}
            onAddSpend={handleAddSpend}
            onDelete={handleDeleteBudget}
          />
        )}

        {filteredAndSortedData.length === 0 && budgets.length > 0 && (
          <div className="bg-card border rounded-lg p-8 text-center">
            <p className="text-muted-foreground">No budgets match your filters</p>
          </div>
        )}
      </div>
    </div>
  )
}

