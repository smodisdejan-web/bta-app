// src/hooks/use-data-insights.ts
import { useState, useMemo, useCallback } from 'react'
import type {
  DataSourceType,
  ColumnDefinition,
  DataFilter,
  FilterOperator,
  DataSummary,
  LLMProvider,
  LLMResponse,
  ColumnDataType
} from '@/lib/types'
import { generateInsightsWithProvider } from '@/lib/api-router'

interface UseDataInsightsProps {
  rawData: Record<DataSourceType, any[]>
  currency: string
}

export function useDataInsights({ rawData, currency }: UseDataInsightsProps) {
  const [dataSource, setDataSource] = useState<DataSourceType>('searchTerms')
  const [filters, setFilters] = useState<DataFilter[]>([])
  const [sortColumn, setSortColumn] = useState<string>('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [previewRowCount, setPreviewRowCount] = useState(10)
  const [aiPrompt, setAiPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState<LLMProvider>('gemini-pro')
  const [aiInsights, setAiInsights] = useState<LLMResponse | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  // Derive column definitions from selected data source
  const columns = useMemo((): ColumnDefinition[] => {
    const sourceData = rawData[dataSource]
    if (!sourceData || sourceData.length === 0) return []

    const firstRow = sourceData[0]
    const cols: ColumnDefinition[] = []

    Object.keys(firstRow).forEach(key => {
      const value = firstRow[key]
      let type: ColumnDataType = 'dimension'

      // Determine column type based on key name and value
      if (key.match(/^(impr|clicks|cost|conv|value|cpc|ctr|convRate|cpa|roas)$/i)) {
        type = 'metric'
      } else if (key.match(/date/i)) {
        type = 'date'
      } else if (typeof value === 'number') {
        type = 'metric'
      }

      // User-friendly name
      let name = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim()

      cols.push({ name, key, type })
    })

    return cols
  }, [dataSource, rawData])

  // Apply filters to data
  const filteredData = useMemo(() => {
    let data = rawData[dataSource] || []

    filters.forEach(filter => {
      if (!filter.column || !filter.value) return

      data = data.filter(row => {
        const cellValue = row[filter.column]
        const filterValue = filter.value.toLowerCase()
        const cellStr = String(cellValue).toLowerCase()

        switch (filter.operator) {
          case 'contains':
            return cellStr.includes(filterValue)
          case 'not-contains':
            return !cellStr.includes(filterValue)
          case 'equals':
            return cellStr === filterValue
          case 'not-equals':
            return cellStr !== filterValue
          case 'starts-with':
            return cellStr.startsWith(filterValue)
          case 'ends-with':
            return cellStr.endsWith(filterValue)
          case 'gt':
            return Number(cellValue) > Number(filter.value)
          case 'lt':
            return Number(cellValue) < Number(filter.value)
          case 'gte':
            return Number(cellValue) >= Number(filter.value)
          case 'lte':
            return Number(cellValue) <= Number(filter.value)
          case 'after':
            return new Date(cellValue) > new Date(filter.value)
          case 'before':
            return new Date(cellValue) < new Date(filter.value)
          case 'on-or-after':
            return new Date(cellValue) >= new Date(filter.value)
          case 'on-or-before':
            return new Date(cellValue) <= new Date(filter.value)
          default:
            return true
        }
      })
    })

    return data
  }, [dataSource, rawData, filters])

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData

    const sorted = [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn]
      const bVal = b[sortColumn]

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      const aStr = String(aVal)
      const bStr = String(bVal)
      return sortDirection === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr)
    })

    return sorted
  }, [filteredData, sortColumn, sortDirection])

  // Preview data (limited rows)
  const previewData = useMemo(() => {
    return sortedData.slice(0, previewRowCount)
  }, [sortedData, previewRowCount])

  // Calculate data summary
  const dataSummary = useMemo((): DataSummary => {
    const summary: DataSummary = {
      totalRows: sortedData.length,
      metrics: {},
      dimensions: {}
    }

    if (sortedData.length === 0) return summary

    // Calculate metrics statistics
    columns.forEach(col => {
      if (col.type === 'metric') {
        const values = sortedData
          .map(row => Number(row[col.key]))
          .filter(v => !isNaN(v))

        if (values.length > 0) {
          summary.metrics[col.key] = {
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            sum: values.reduce((a, b) => a + b, 0)
          }
        }
      } else if (col.type === 'dimension') {
        const valueMap = new Map<string, number>()
        sortedData.forEach(row => {
          const val = String(row[col.key])
          valueMap.set(val, (valueMap.get(val) || 0) + 1)
        })

        const topValues = Array.from(valueMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([value, count]) => ({ value, count }))

        summary.dimensions[col.key] = {
          uniqueCount: valueMap.size,
          topValues
        }
      }
    })

    return summary
  }, [sortedData, columns])

  // Add filter
  const addFilter = useCallback(() => {
    const newFilter: DataFilter = {
      id: `filter-${Date.now()}`,
      column: columns[0]?.key || '',
      operator: 'contains',
      value: ''
    }
    setFilters(prev => [...prev, newFilter])
  }, [columns])

  // Remove filter
  const removeFilter = useCallback((filterId: string) => {
    setFilters(prev => prev.filter(f => f.id !== filterId))
  }, [])

  // Update filter
  const updateFilter = useCallback((filterId: string, updates: Partial<DataFilter>) => {
    setFilters(prev => prev.map(f => 
      f.id === filterId ? { ...f, ...updates } : f
    ))
  }, [])

  // Toggle sort
  const toggleSort = useCallback((columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(columnKey)
      setSortDirection('asc')
    }
  }, [sortColumn])

  // Change data source
  const changeDataSource = useCallback((newSource: DataSourceType) => {
    setDataSource(newSource)
    setFilters([])
    setSortColumn('')
    setSortDirection('asc')
    setAiInsights(null)
  }, [])

  // Generate AI insights
  const generateInsights = useCallback(async () => {
    if (!aiPrompt.trim() || sortedData.length === 0) return

    setIsGenerating(true)
    try {
      const result = await generateInsightsWithProvider({
        prompt: aiPrompt,
        provider: selectedModel,
        dataSource,
        data: sortedData,
        filters,
        totalRowsOriginal: rawData[dataSource]?.length || 0,
        totalRowsFiltered: sortedData.length,
        currency
      })
      setAiInsights(result)
    } catch (error) {
      console.error('Error generating insights:', error)
      setAiInsights({
        text: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setIsGenerating(false)
    }
  }, [aiPrompt, sortedData, selectedModel, dataSource, filters, rawData, currency])

  // Get operators for column type
  const getOperatorsForColumn = useCallback((columnKey: string): FilterOperator[] => {
    const column = columns.find(c => c.key === columnKey)
    if (!column) return []

    switch (column.type) {
      case 'metric':
        return ['equals', 'not-equals', 'gt', 'lt', 'gte', 'lte']
      case 'date':
        return ['equals', 'not-equals', 'after', 'before', 'on-or-after', 'on-or-before']
      case 'dimension':
      default:
        return ['contains', 'not-contains', 'equals', 'not-equals', 'starts-with', 'ends-with']
    }
  }, [columns])

  return {
    dataSource,
    changeDataSource,
    columns,
    filters,
    addFilter,
    removeFilter,
    updateFilter,
    getOperatorsForColumn,
    previewData,
    previewRowCount,
    setPreviewRowCount,
    sortColumn,
    sortDirection,
    toggleSort,
    dataSummary,
    aiPrompt,
    setAiPrompt,
    selectedModel,
    setSelectedModel,
    aiInsights,
    isGenerating,
    generateInsights,
    totalRowsOriginal: rawData[dataSource]?.length || 0,
    totalRowsFiltered: sortedData.length
  }
}


