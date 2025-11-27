// src/components/overview/TopBar.tsx
'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OverviewFilters, DateRange, Channel } from '@/lib/overview-types'
import { Calendar, RefreshCw } from 'lucide-react'
import { useState } from 'react'

interface TopBarProps {
  filters: OverviewFilters
  onFiltersChange: (filters: OverviewFilters) => void
  onRegenerateSummary?: () => void
  isRegenerating?: boolean
}

export function TopBar({ filters, onFiltersChange, onRegenerateSummary, isRegenerating }: TopBarProps) {
  const [customStart, setCustomStart] = useState(filters.customStart || '')
  const [customEnd, setCustomEnd] = useState(filters.customEnd || '')
  const [campaignSearch, setCampaignSearch] = useState(filters.campaign || '')
  
  const handleDateRangeChange = (range: DateRange) => {
    onFiltersChange({
      ...filters,
      dateRange: range,
      customStart: range === 'custom' ? customStart : undefined,
      customEnd: range === 'custom' ? customEnd : undefined
    })
  }
  
  const handleCustomDates = () => {
    if (customStart && customEnd) {
      onFiltersChange({
        ...filters,
        customStart,
        customEnd
      })
    }
  }
  
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Date Range */}
        <Select value={filters.dateRange} onValueChange={(v) => handleDateRangeChange(v as DateRange)}>
          <SelectTrigger className="w-[140px]">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="60d">Last 60 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        
        {/* Custom Date Inputs */}
        {filters.dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-[140px]"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-[140px]"
            />
            <Button size="sm" onClick={handleCustomDates}>Apply</Button>
          </div>
        )}
        
        {/* Compare Toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="compare"
            checked={filters.comparePrevious}
            onChange={(e) => onFiltersChange({ ...filters, comparePrevious: e.target.checked })}
            className="rounded border-gray-300"
          />
          <label htmlFor="compare" className="text-sm text-muted-foreground">
            Compare to previous period
          </label>
        </div>
        
        {/* Channel Filter */}
        <Select value={filters.channel} onValueChange={(v) => onFiltersChange({ ...filters, channel: v as Channel })}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="google">Google Ads</SelectItem>
            <SelectItem value="facebook">Facebook Ads</SelectItem>
          </SelectContent>
        </Select>
        
        {/* Campaign Search */}
        <Input
          placeholder="Search campaigns..."
          value={campaignSearch}
          onChange={(e) => {
            setCampaignSearch(e.target.value)
            onFiltersChange({ ...filters, campaign: e.target.value })
          }}
          className="w-[200px]"
        />
        
        {/* Regenerate Summary */}
        {onRegenerateSummary && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerateSummary}
            disabled={isRegenerating}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
            Regenerate Summary
          </Button>
        )}
      </div>
    </div>
  )
}



