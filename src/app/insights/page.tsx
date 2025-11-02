/* eslint-disable react/no-unescaped-entities */
/* eslint-disable react-hooks/exhaustive-deps */
'use client'

import { useEffect, useState } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { useDataInsights } from '@/hooks/use-data-insights'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { DataSourceType, LLMProvider, FilterOperator, DataFilter } from '@/lib/types'
import { 
  Loader2, Plus, X, ArrowUp, ArrowDown, Sparkles, Download, Save, 
  FolderOpen, History, TrendingUp, Zap, Copy, Check, Lightbulb,
  BarChart3, FileJson
} from 'lucide-react'
import { DataInsightsChart } from '@/components/DataInsightsChart'
import { useToast } from '@/hooks/use-toast'

interface SavedFilter {
  id: string
  name: string
  filters: DataFilter[]
  dataSource: DataSourceType
}

interface InsightHistory {
  id: string
  prompt: string
  response: string
  model: LLMProvider
  timestamp: number
  dataSource: DataSourceType
}

const SAMPLE_PROMPTS = [
  {
    title: "Top Performers",
    prompt: "What are the top 5 performing items in this dataset? Explain why they stand out.",
    icon: "🏆"
  },
  {
    title: "Optimization Tips",
    prompt: "Analyze this data and provide 3-5 specific optimization recommendations.",
    icon: "🎯"
  },
  {
    title: "Trends & Patterns",
    prompt: "What patterns or trends do you notice in this data? Are there any anomalies?",
    icon: "📈"
  },
  {
    title: "Budget Allocation",
    prompt: "Based on performance, how should I reallocate my budget for maximum ROI?",
    icon: "💰"
  },
  {
    title: "Underperformers",
    prompt: "Identify underperforming items and explain what might be causing poor results.",
    icon: "⚠️"
  },
  {
    title: "Quick Summary",
    prompt: "Give me a concise summary of the key insights from this data in 3 bullet points.",
    icon: "📝"
  }
]

export default function DataInsightsPage() {
  const { fetchedData, settings, isDataLoading, dataError } = useSettings()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [filterName, setFilterName] = useState('')
  const [insightHistory, setInsightHistory] = useState<InsightHistory[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)
  const [showFiltersDialog, setShowFiltersDialog] = useState(false)
  const [loadingTimeout, setLoadingTimeout] = useState(false)

  const insights = useDataInsights({
    rawData: {
      searchTerms: fetchedData?.searchTerms || [],
      adGroups: fetchedData?.adGroups || [],
      daily: fetchedData?.daily || []
    },
    currency: settings.currency
  })

  // Load saved data from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dataInsights_savedFilters')
      if (saved) setSavedFilters(JSON.parse(saved))
      
      const history = localStorage.getItem('dataInsights_history')
      if (history) setInsightHistory(JSON.parse(history))
    }
  }, [])

  // Timeout for loading state - if loading takes more than 15 seconds, show error
  useEffect(() => {
    if (isDataLoading) {
      const timeout = setTimeout(() => {
        setLoadingTimeout(true)
      }, 15000) // 15 seconds
      
      return () => clearTimeout(timeout)
    } else {
      setLoadingTimeout(false)
    }
  }, [isDataLoading])

  // Save insight to history
  useEffect(() => {
    if (insights.aiInsights && insights.aiInsights.text && !insights.isGenerating) {
      const newHistory: InsightHistory = {
        id: `history-${Date.now()}`,
        prompt: insights.aiPrompt,
        response: insights.aiInsights.text,
        model: insights.selectedModel,
        timestamp: Date.now(),
        dataSource: insights.dataSource
      }
      setInsightHistory(prevHistory => {
        const updated = [newHistory, ...prevHistory].slice(0, 20) // Keep last 20
        if (typeof window !== 'undefined') {
          localStorage.setItem('dataInsights_history', JSON.stringify(updated))
        }
        return updated
      })
    }
  }, [insights.aiInsights?.text, insights.aiPrompt, insights.selectedModel, insights.dataSource, insights.isGenerating])

  const exportData = (format: 'csv' | 'json') => {
    if (!insights.filteredData || insights.filteredData.length === 0) {
      toast({ title: "No data to export", variant: "destructive" })
      return
    }

    const filename = `insights-${insights.dataSource}-${format}-${new Date().toISOString().split('T')[0]}.${format}`
    
    if (format === 'csv') {
      const headers = Object.keys(insights.filteredData[0])
      const csvContent = [
        headers.join(','),
        ...insights.filteredData.map(row => 
          headers.map(header => {
            const value = row[header]
            return typeof value === 'string' && value.includes(',') 
              ? `"${value.replace(/"/g, '""')}"` 
              : value
          }).join(',')
        )
      ].join('\n')
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
    } else {
      const jsonContent = JSON.stringify(insights.filteredData, null, 2)
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
    }
    
    toast({ title: `Exported ${insights.filteredData.length} rows as ${format.toUpperCase()}` })
  }

  // Keyboard shortcuts
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch(e.key) {
          case 'k':
            e.preventDefault()
            document.getElementById('prompt')?.focus()
            break
          case 'Enter':
            if (document.activeElement?.id === 'prompt') {
              e.preventDefault()
              insights.generateInsights()
            }
            break
          case 's':
            e.preventDefault()
            setShowSaveDialog(true)
            break
          case 'e':
            e.preventDefault()
            exportData('csv')
            break
        }
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [insights.generateInsights, exportData])

  const saveCurrentFilters = () => {
    if (!filterName.trim()) {
      toast({ title: "Please enter a name", variant: "destructive" })
      return
    }
    const newFilter: SavedFilter = {
      id: `filter-${Date.now()}`,
      name: filterName,
      filters: insights.filters,
      dataSource: insights.dataSource
    }
    const updated = [...savedFilters, newFilter]
    setSavedFilters(updated)
    if (typeof window !== 'undefined') {
      localStorage.setItem('dataInsights_savedFilters', JSON.stringify(updated))
    }
    setFilterName('')
    setShowSaveDialog(false)
    toast({ title: "✅ Filters saved successfully" })
  }

  const loadFilters = (saved: SavedFilter) => {
    insights.changeDataSource(saved.dataSource)
    setTimeout(() => {
      saved.filters.forEach(f => {
        insights.addFilter()
        setTimeout(() => {
          insights.updateFilter(f.id, f)
        }, 100)
      })
    }, 200)
    setShowFiltersDialog(false)
    toast({ title: "✅ Filters loaded" })
  }

  const deleteFilterPreset = (id: string) => {
    const updated = savedFilters.filter(f => f.id !== id)
    setSavedFilters(updated)
    if (typeof window !== 'undefined') {
      localStorage.setItem('dataInsights_savedFilters', JSON.stringify(updated))
    }
  }


  const copyInsight = () => {
    if (insights.aiInsights?.text) {
      navigator.clipboard.writeText(insights.aiInsights.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({ title: "✅ Copied to clipboard" })
    }
  }

  if (isDataLoading && !loadingTimeout) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading your data...</p>
        <p className="text-xs text-muted-foreground mt-2">This is taking longer than usual...</p>
      </div>
    )
  }

  // If loading is taking too long, show timeout error
  if (isDataLoading && loadingTimeout) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-6">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">⏱️</div>
            <h1 className="text-3xl font-bold mb-2">Loading Timeout</h1>
            <p className="text-muted-foreground text-lg">
              Your data is taking unusually long to load
            </p>
          </div>
          
          <div className="bg-amber-500/10 border-2 border-amber-500 rounded-lg p-6 mb-6">
            <p className="font-semibold mb-2">⚠️ Possible Issues:</p>
            <ul className="space-y-2 text-sm">
              <li>• Your Google Sheets URL might be incorrect or inaccessible</li>
              <li>• The Google Apps Script might not be responding</li>
              <li>• Your internet connection might be slow</li>
              <li>• The sheet might contain too much data</li>
            </ul>
          </div>

          <div className="bg-muted/50 rounded-lg p-6 space-y-4 mb-6">
            <h3 className="font-semibold text-lg">💡 Quick Fixes:</h3>
            <ol className="space-y-3 list-decimal list-inside text-sm">
              <li>
                <strong>Verify your Sheet URL in Settings</strong>
                <p className="ml-6 text-muted-foreground">Make sure it's the Apps Script web app URL</p>
              </li>
              <li>
                <strong>Test the URL directly</strong>
                <p className="ml-6 text-muted-foreground">Try opening the URL in a new browser tab</p>
              </li>
              <li>
                <strong>Check your network</strong>
                <p className="ml-6 text-muted-foreground">Ensure you have a stable internet connection</p>
              </li>
              <li>
                <strong>Try refreshing the page</strong>
                <p className="ml-6 text-muted-foreground">Sometimes a simple refresh fixes the issue</p>
              </li>
            </ol>
          </div>

          <div className="flex gap-3 justify-center">
            <Button 
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/settings'
                }
              }}
              className="gap-2"
            >
              <span>⚙️</span>
              Check Settings
            </Button>
            <Button 
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload()
                }
              }}
              variant="outline"
              className="gap-2"
            >
              <span>🔄</span>
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (dataError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-6">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-3xl font-bold mb-2">Unable to Load Data</h1>
            <p className="text-muted-foreground text-lg">
              There was an error fetching your advertising data
            </p>
          </div>
          
          <div className="bg-destructive/10 border-2 border-destructive rounded-lg p-6 mb-6">
            <p className="font-semibold mb-2">Error Details:</p>
            <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(dataError, null, 2)}</pre>
          </div>

          <div className="bg-muted/50 rounded-lg p-6 space-y-4">
            <h3 className="font-semibold text-lg">💡 How to Fix This:</h3>
            <ol className="space-y-3 list-decimal list-inside">
              <li>
                <strong>Check your Sheet URL</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Go to Settings and verify your Google Sheets URL is correct
                </p>
              </li>
              <li>
                <strong>Verify Sheet Permissions</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Make sure your Google Sheet is published and accessible via the Apps Script URL
                </p>
              </li>
              <li>
                <strong>Check Sheet Tabs</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Ensure your sheet has tabs named: "searchTerms", "adGroups", and "daily"
                </p>
              </li>
              <li>
                <strong>Test the URL</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Try opening your sheet URL in a browser to see if it returns data
                </p>
              </li>
            </ol>
          </div>

          <div className="flex gap-3 mt-6 justify-center">
            <Button 
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/settings'
                }
              }}
              className="gap-2"
            >
              Go to Settings
            </Button>
            <Button 
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload()
                }
              }}
              variant="outline"
              className="gap-2"
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Check if we have no data at all
  const hasNoData = !fetchedData || (
    (!fetchedData.searchTerms || fetchedData.searchTerms.length === 0) &&
    (!fetchedData.adGroups || fetchedData.adGroups.length === 0) &&
    (!fetchedData.daily || fetchedData.daily.length === 0)
  )

  if (hasNoData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-6">
        <div className="max-w-2xl w-full text-center">
          <div className="text-6xl mb-6">📊</div>
          <h1 className="text-3xl font-bold mb-4">No Data Available</h1>
          <p className="text-muted-foreground text-lg mb-8">
            Your Google Sheets appears to be empty or not properly configured
          </p>
          
          <div className="bg-muted/50 rounded-lg p-6 text-left space-y-4 mb-6">
            <h3 className="font-semibold text-lg">🚀 Getting Started:</h3>
            <ol className="space-y-3 list-decimal list-inside">
              <li>
                <strong>Configure your Google Sheets URL</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Go to Settings and add your Google Apps Script web app URL
                </p>
              </li>
              <li>
                <strong>Run your Google Ads script</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Make sure your script has populated the sheets with data
                </p>
              </li>
              <li>
                <strong>Verify data tabs exist</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Your sheet should have: searchTerms, adGroups, and daily tabs
                </p>
              </li>
              <li>
                <strong>Check for data</strong>
                <p className="ml-6 text-sm text-muted-foreground">
                  Each tab should contain at least some rows of campaign data
                </p>
              </li>
            </ol>
          </div>

          <Button 
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/settings'
              }
            }}
            size="lg"
            className="gap-2"
          >
            <span>⚙️</span>
            Configure Settings
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6 pb-20">
      {/* Header with gradient */}
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary/10 via-primary/5 to-background p-8 border">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Data Insights
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Explore, analyze, and generate AI-powered insights from your advertising data
          </p>
          <div className="flex gap-2 mt-4 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" />
              AI-Powered
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <BarChart3 className="h-3 w-3" />
              Real-time Analysis
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <TrendingUp className="h-3 w-3" />
              Smart Insights
            </Badge>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-0" />
      </div>

      {/* Quick Actions Bar */}
      <div className="flex gap-2 flex-wrap">
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Save className="h-4 w-4" />
              Save Filters
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Current Filters</DialogTitle>
              <DialogDescription>Give your filter preset a name to save it for later</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Input
                placeholder="e.g., High performing campaigns"
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && saveCurrentFilters()}
              />
              <Button onClick={saveCurrentFilters} className="w-full">
                <Save className="h-4 w-4 mr-2" />
                Save Filter Preset
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showFiltersDialog} onOpenChange={setShowFiltersDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <FolderOpen className="h-4 w-4" />
              Load Filters ({savedFilters.length})
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Saved Filter Presets</DialogTitle>
              <DialogDescription>Load a previously saved filter configuration</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {savedFilters.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No saved filters yet</p>
              ) : (
                savedFilters.map(filter => (
                  <div key={filter.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                    <div className="flex-1">
                      <p className="font-medium">{filter.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {filter.filters.length} filters • {filter.dataSource}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => loadFilters(filter)}>
                        Load
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteFilterPreset(filter.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <History className="h-4 w-4" />
              History ({insightHistory.length})
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Insight History</DialogTitle>
              <DialogDescription>Your recent AI-generated insights</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {insightHistory.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No insights generated yet</p>
              ) : (
                insightHistory.map(item => (
                  <div key={item.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{item.prompt}</p>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">{item.model}</Badge>
                          <Badge variant="secondary" className="text-xs">{item.dataSource}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          insights.setAiPrompt(item.prompt)
                          setShowHistoryDialog(false)
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-3">{item.response}</p>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportData('csv')}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportData('json')}>
          <FileJson className="h-4 w-4" />
          Export JSON
        </Button>
      </div>

      {/* Data Source Selection */}
      <Card className="border-2 hover:border-primary/50 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">🗂️</span>
            Data Source
          </CardTitle>
          <CardDescription>Select the dataset you want to analyze</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={insights.dataSource}
            onValueChange={(value) => insights.changeDataSource(value as DataSourceType)}
          >
            <SelectTrigger className="w-[300px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="searchTerms">🔍 Search Terms</SelectItem>
              <SelectItem value="adGroups">📊 Ad Groups</SelectItem>
              <SelectItem value="daily">📅 Daily Performance</SelectItem>
            </SelectContent>
          </Select>
          <div className="mt-4 flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{insights.totalRowsOriginal.toLocaleString()}</Badge>
              <span className="text-muted-foreground">Total rows</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default">{insights.totalRowsFiltered.toLocaleString()}</Badge>
              <span className="text-muted-foreground">After filters</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters Section */}
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">🔧</span>
            Filters
          </CardTitle>
          <CardDescription>Apply filters to narrow down your analysis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {insights.filters.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
              <Lightbulb className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">No filters applied. Add filters to refine your data.</p>
              <Button onClick={insights.addFilter} variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Filter
              </Button>
            </div>
          ) : (
            <>
              {insights.filters.map((filter, idx) => (
                <div key={filter.id} className="flex gap-2 items-start p-4 bg-muted/30 rounded-lg border">
                  <Badge variant="secondary" className="mt-2">{idx + 1}</Badge>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <Select
                      value={filter.column}
                      onValueChange={(value) => {
                        insights.updateFilter(filter.id, {
                          column: value,
                          operator: insights.getOperatorsForColumn(value)[0],
                          value: ''
                        })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {insights.columns.map((col) => (
                          <SelectItem key={col.key} value={col.key}>
                            {col.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={filter.operator}
                      onValueChange={(value) =>
                        insights.updateFilter(filter.id, { operator: value as FilterOperator })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Operator" />
                      </SelectTrigger>
                      <SelectContent>
                        {insights.getOperatorsForColumn(filter.column).map((op) => (
                          <SelectItem key={op} value={op}>
                            {formatOperator(op)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      placeholder="Value"
                      value={filter.value}
                      onChange={(e) => insights.updateFilter(filter.id, { value: e.target.value })}
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => insights.removeFilter(filter.id)}
                    className="hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <Button onClick={insights.addFilter} variant="outline" size="sm" className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Another Filter
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Data Visualization Chart */}
      {insights.previewData.length > 0 && (
        <DataInsightsChart 
          data={insights.previewData}
          columns={insights.columns}
          currency={settings.currency}
        />
      )}

      {/* Data Preview Table */}
      <Card className="border-2">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">📋</span>
                Data Preview
              </CardTitle>
              <CardDescription>
                Showing {insights.previewData.length} of {insights.totalRowsFiltered.toLocaleString()} rows
              </CardDescription>
            </div>
            <Select
              value={String(insights.previewRowCount)}
              onValueChange={(value) => insights.setPreviewRowCount(Number(value))}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 rows</SelectItem>
                <SelectItem value="10">10 rows</SelectItem>
                <SelectItem value="30">30 rows</SelectItem>
                <SelectItem value="50">50 rows</SelectItem>
                <SelectItem value="100">100 rows</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {insights.previewData.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <div className="text-6xl mb-4">🔍</div>
              <p className="text-lg font-medium mb-2">No data matches your current filters</p>
              <p className="text-muted-foreground mb-4">Try adjusting or removing some filters</p>
              <Button variant="outline" onClick={() => insights.filters.forEach(f => insights.removeFilter(f.id))}>
                Clear All Filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {insights.columns.map((col) => (
                      <TableHead
                        key={col.key}
                        className="cursor-pointer hover:bg-muted transition-colors font-semibold"
                        onClick={() => insights.toggleSort(col.key)}
                      >
                        <div className="flex items-center gap-2">
                          {col.name}
                          {insights.sortColumn === col.key && (
                            <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center">
                              {insights.sortDirection === 'asc' ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )}
                            </Badge>
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insights.previewData.map((row, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      {insights.columns.map((col) => (
                        <TableCell key={col.key}>
                          {formatCellValue(row[col.key], col.type, settings.currency)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Summary Section */}
      <Card className="border-2 bg-gradient-to-br from-background to-muted/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            Data Summary
          </CardTitle>
          <CardDescription>Statistical overview of filtered data</CardDescription>
        </CardHeader>
        <CardContent>
          {insights.dataSummary.totalRows === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No data to summarize</div>
          ) : (
            <div className="space-y-6">
              {/* Metrics Summary */}
              {Object.keys(insights.dataSummary.metrics).length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Metrics Analysis
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Object.entries(insights.dataSummary.metrics).map(([key, stats]) => {
                      const col = insights.columns.find(c => c.key === key)
                      return (
                        <Card key={key} className="border-2 hover:shadow-lg transition-shadow bg-gradient-to-br from-background to-primary/5">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center justify-between">
                              <span>{col?.name || key}</span>
                              <BarChart3 className="h-4 w-4 text-primary" />
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="text-xs space-y-2">
                            <div className="flex justify-between items-center p-2 bg-background/50 rounded">
                              <span className="text-muted-foreground">Min</span>
                              <span className="font-bold text-blue-600">
                                {formatMetricValue(stats.min, settings.currency)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-background/50 rounded">
                              <span className="text-muted-foreground">Max</span>
                              <span className="font-bold text-green-600">
                                {formatMetricValue(stats.max, settings.currency)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-background/50 rounded">
                              <span className="text-muted-foreground">Avg</span>
                              <span className="font-bold text-amber-600">
                                {formatMetricValue(stats.avg, settings.currency)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-primary/10 rounded">
                              <span className="text-muted-foreground font-semibold">Sum</span>
                              <span className="font-bold text-primary">
                                {formatMetricValue(stats.sum, settings.currency)}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Dimensions Summary */}
              {Object.keys(insights.dataSummary.dimensions).length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Dimensions Breakdown
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(insights.dataSummary.dimensions).map(([key, stats]) => {
                      const col = insights.columns.find(c => c.key === key)
                      return (
                        <Card key={key} className="border-2 hover:shadow-lg transition-shadow">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm">{col?.name || key}</CardTitle>
                            <CardDescription className="text-xs">
                              🎯 {stats.uniqueCount} unique values
                            </CardDescription>
                          </CardHeader>
                          {stats.topValues && stats.topValues.length > 0 && (
                            <CardContent className="text-xs space-y-2">
                              <div className="font-medium text-muted-foreground mb-2">Top 5 Values:</div>
                              {stats.topValues.map((tv, idx) => (
                                <div key={idx} className="flex justify-between items-center p-2 bg-muted/30 rounded hover:bg-muted/50 transition-colors">
                                  <span className="truncate max-w-[200px] font-medium">
                                    {idx + 1}. {tv.value}
                                  </span>
                                  <Badge variant="default" className="ml-2">{tv.count}</Badge>
                                </div>
                              ))}
                            </CardContent>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sample Prompts */}
      <Card className="border-2 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            Sample Prompts
          </CardTitle>
          <CardDescription>Click any prompt to get started quickly</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {SAMPLE_PROMPTS.map((sample, idx) => (
              <Button
                key={idx}
                variant="outline"
                className="h-auto p-4 flex flex-col items-start text-left hover:bg-primary/10 hover:border-primary transition-all"
                onClick={() => {
                  insights.setAiPrompt(sample.prompt)
                  if (typeof document !== 'undefined') {
                    document.getElementById('prompt')?.scrollIntoView({ behavior: 'smooth' })
                  }
                }}
              >
                <div className="text-2xl mb-2">{sample.icon}</div>
                <div className="font-semibold mb-1">{sample.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{sample.prompt}</div>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Insights Generation */}
      <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-7 w-7 text-primary animate-pulse" />
            AI Insights Generator
          </CardTitle>
          <CardDescription className="text-base">
            Generate qualitative insights using large language models • Cmd+K to focus
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Model Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model" className="text-base font-semibold">AI Model</Label>
              <Select
                value={insights.selectedModel}
                onValueChange={(value) => insights.setSelectedModel(value as LLMProvider)}
              >
                <SelectTrigger id="model" className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-pro">
                    <div className="flex items-center gap-2">
                      <span>🔷</span>
                      <div>
                        <div className="font-medium">Google Gemini Pro</div>
                        <div className="text-xs text-muted-foreground">Fast & Free tier available</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="gpt-4">
                    <div className="flex items-center gap-2">
                      <span>🟢</span>
                      <div>
                        <div className="font-medium">OpenAI GPT-4</div>
                        <div className="text-xs text-muted-foreground">Most capable</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="claude-3-sonnet">
                    <div className="flex items-center gap-2">
                      <span>🟣</span>
                      <div>
                        <div className="font-medium">Anthropic Claude 3 Sonnet</div>
                        <div className="text-xs text-muted-foreground">Balanced performance</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Prompt Input */}
          <div className="space-y-2">
            <Label htmlFor="prompt" className="text-base font-semibold">Your Question or Prompt</Label>
            <textarea
              id="prompt"
              className="w-full min-h-[120px] p-4 rounded-md border-2 border-input bg-background focus:border-primary transition-colors text-base"
              placeholder="E.g., What are the top performing search terms? What patterns do you see in the data? What recommendations would you make?"
              value={insights.aiPrompt}
              onChange={(e) => insights.setAiPrompt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              💡 Tip: Be specific about what you want to know. Cmd+Enter to generate
            </p>
          </div>

          {/* Generate Button */}
          <Button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              insights.generateInsights()
            }}
            disabled={!insights.aiPrompt.trim() || insights.totalRowsFiltered === 0 || insights.isGenerating}
            className="w-full h-14 text-lg font-semibold"
            size="lg"
          >
            {insights.isGenerating ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Generating Insights...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 mr-2" />
                Generate AI Insights
              </>
            )}
          </Button>

          {/* AI Response */}
          {insights.aiInsights && (
            <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {insights.aiInsights.error ? (
                <div className="p-6 bg-destructive/10 border-2 border-destructive rounded-lg text-destructive">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div className="flex-1">
                      <p className="font-semibold text-lg mb-2">Error Generating Insights</p>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{insights.aiInsights.error}</pre>
                      <div className="mt-4 p-3 bg-background/50 rounded text-xs">
                        <p className="font-semibold mb-1">💡 Quick Tip:</p>
                        <p>Switch to <strong>Gemini Pro</strong> in the dropdown above - it has a free tier and works great for testing!</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      Generated Insights
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyInsight}
                      className="gap-2"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="p-6 bg-gradient-to-br from-muted/50 to-background rounded-lg border-2 prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap leading-relaxed">{insights.aiInsights.text}</div>
                  </div>
                  {insights.aiInsights.tokenUsage && (
                    <div className="flex gap-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                      <span>📊 Token usage:</span>
                      <span><strong>{insights.aiInsights.tokenUsage.inputTokens.toLocaleString()}</strong> input</span>
                      <span><strong>{insights.aiInsights.tokenUsage.outputTokens.toLocaleString()}</strong> output</span>
                      <span><strong>{insights.aiInsights.tokenUsage.totalTokens.toLocaleString()}</strong> total</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts Help */}
      <Card className="border bg-muted/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground items-center justify-center">
            <span className="font-semibold">⌨️ Keyboard Shortcuts:</span>
            <Badge variant="outline">Cmd+K: Focus prompt</Badge>
            <Badge variant="outline">Cmd+Enter: Generate</Badge>
            <Badge variant="outline">Cmd+S: Save filters</Badge>
            <Badge variant="outline">Cmd+E: Export CSV</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Helper functions
function formatOperator(operator: FilterOperator): string {
  const operatorMap: Record<FilterOperator, string> = {
    'contains': 'Contains',
    'not-contains': 'Does not contain',
    'equals': 'Equals',
    'not-equals': 'Not equals',
    'starts-with': 'Starts with',
    'ends-with': 'Ends with',
    'gt': 'Greater than',
    'lt': 'Less than',
    'gte': 'Greater than or equals',
    'lte': 'Less than or equals',
    'after': 'After',
    'before': 'Before',
    'on-or-after': 'On or after',
    'on-or-before': 'On or before'
  }
  return operatorMap[operator] || operator
}

function formatCellValue(value: any, type: string, currency: string): string {
  if (value === null || value === undefined) return '-'

  if (type === 'metric') {
    if (typeof value === 'number') {
      if (value < 1 && value > 0 && String(value).includes('.')) {
        return `${(value * 100).toFixed(1)}%`
      }
      if (value % 1 !== 0 || String(value).includes('.')) {
        return `${currency}${value.toFixed(2)}`
      }
      return value.toLocaleString()
    }
  }

  if (type === 'date') {
    if (value instanceof Date) {
      return value.toLocaleDateString()
    }
    return String(value)
  }

  return String(value)
}

function formatMetricValue(value: number, currency: string): string {
  if (value < 1 && value > 0) {
    return `${(value * 100).toFixed(1)}%`
  }
  if (value % 1 !== 0) {
    return `${currency}${value.toFixed(2)}`
  }
  return value.toLocaleString()
}
