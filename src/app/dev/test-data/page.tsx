'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetchDaily, fetchSearchTerms, fetchAdGroups } from '@/lib/sheetsData'
import { useSettings } from '@/lib/contexts/SettingsContext'
import type { AdMetric, SearchTermMetric, AdGroupRecord } from '@/lib/types'

type TabType = 'daily' | 'searchTerms' | 'adGroups'
type TabData = AdMetric[] | SearchTermMetric[] | AdGroupRecord[]

const TAB_OPTIONS: { value: TabType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'searchTerms', label: 'Search Terms' },
  { value: 'adGroups', label: 'Ad Groups' }
]

const FETCHERS = {
  daily: fetchDaily,
  searchTerms: fetchSearchTerms,
  adGroups: fetchAdGroups
}

export default function TestDataPage() {
  const { settings } = useSettings()
  const [selectedTab, setSelectedTab] = useState<TabType>('daily')

  const { data, error, isLoading } = useSWR<TabData>(
    settings.sheetUrl && selectedTab ? `test-${selectedTab}-${settings.sheetUrl}` : null,
    () => FETCHERS[selectedTab](settings.sheetUrl),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  )

  const renderTableHeaders = () => {
    switch (selectedTab) {
      case 'daily':
        return (
          <tr>
            <th>Campaign</th>
            <th>Campaign ID</th>
            <th>Date</th>
            <th>Impressions</th>
            <th>Clicks</th>
            <th>Cost</th>
            <th>Conversions</th>
            <th>Value</th>
          </tr>
        )
      case 'searchTerms':
        return (
          <tr>
            <th>Search Term</th>
            <th>Keyword Text</th>
            <th>Campaign</th>
            <th>Ad Group</th>
            <th>Impressions</th>
            <th>Clicks</th>
            <th>Cost</th>
            <th>Conversions</th>
            <th>Value</th>
          </tr>
        )
      case 'adGroups':
        return (
          <tr>
            <th>Campaign</th>
            <th>Campaign ID</th>
            <th>Ad Group</th>
            <th>Ad Group ID</th>
            <th>Date</th>
            <th>Impressions</th>
            <th>Clicks</th>
            <th>CTR</th>
            <th>Cost</th>
            <th>ROAS</th>
          </tr>
        )
      default:
        return null
    }
  }

  const renderTableRows = () => {
    if (!data || data.length === 0) return null

    const first10Rows = data.slice(0, 10)

    switch (selectedTab) {
      case 'daily':
        return (first10Rows as AdMetric[]).map((row, index) => (
          <tr key={`${row.campaignId}-${row.date}-${index}`}>
            <td>{row.campaign}</td>
            <td>{row.campaignId}</td>
            <td>{row.date}</td>
            <td>{row.impr.toLocaleString()}</td>
            <td>{row.clicks.toLocaleString()}</td>
            <td>${row.cost.toFixed(2)}</td>
            <td>{row.conv.toFixed(1)}</td>
            <td>${row.value.toFixed(2)}</td>
          </tr>
        ))
      case 'searchTerms':
        return (first10Rows as SearchTermMetric[]).map((row, index) => (
          <tr key={`${row.searchTerm}-${index}`}>
            <td>{row.searchTerm}</td>
            <td>{row.keywordText || ''}</td>
            <td>{row.campaign}</td>
            <td>{row.adGroup}</td>
            <td>{row.impr.toLocaleString()}</td>
            <td>{row.clicks.toLocaleString()}</td>
            <td>${row.cost.toFixed(2)}</td>
            <td>{row.conv.toFixed(1)}</td>
            <td>${row.value.toFixed(2)}</td>
          </tr>
        ))
      case 'adGroups':
        return (first10Rows as AdGroupRecord[]).map((row, index) => (
          <tr key={`${row.adGroupId}-${index}`}>
            <td>{row.campaign}</td>
            <td>{row.campaignId}</td>
            <td>{row.adGroup}</td>
            <td>{row.adGroupId}</td>
            <td>{row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date)}</td>
            <td>{row.impr.toLocaleString()}</td>
            <td>{row.clicks.toLocaleString()}</td>
            <td>{(row.ctr * 100).toFixed(1)}%</td>
            <td>€{row.cost.toFixed(2)}</td>
            <td>{row.roas.toFixed(2)}</td>
          </tr>
        ))
      default:
        return null
    }
  }

  const renderFirstRowDetails = () => {
    if (!data || data.length === 0) return null

    const firstRow = data[0]
    const entries = Object.entries(firstRow)

    return (
      <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}>
        <h3>First Row Details ({entries.length} fields):</h3>
        <pre style={{ fontSize: '12px', overflow: 'auto', maxHeight: '200px' }}>
          {entries.map(([key, value]) => {
            let displayValue = value
            if (value instanceof Date) {
              displayValue = value.toISOString()
            } else if (typeof value === 'number') {
              displayValue = value.toFixed(2)
            }
            return `${key}: ${displayValue}`
          }).join('\n')}
        </pre>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Sheet Data Test Page</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <label htmlFor="tab-select" style={{ marginRight: '10px' }}>
          Select Tab:
        </label>
        <select
          id="tab-select"
          value={selectedTab}
          onChange={(e) => setSelectedTab(e.target.value as TabType)}
          style={{ padding: '5px', fontSize: '14px' }}
        >
          {TAB_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div style={{ padding: '20px', backgroundColor: '#e3f2fd' }}>
          Loading {selectedTab} data...
        </div>
      )}

      {error && (
        <div style={{ padding: '20px', backgroundColor: '#ffebee', color: '#c62828' }}>
          <strong>Error:</strong> {error.message || 'Failed to fetch data'}
        </div>
      )}

      {data && (
        <>
          <div style={{ marginBottom: '10px' }}>
            <strong>Total Rows:</strong> {data.length.toLocaleString()}
            {data.length > 10 && <span> (showing first 10)</span>}
          </div>

          <div style={{ overflow: 'auto', maxHeight: '400px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
              <thead>
                {renderTableHeaders()}
              </thead>
              <tbody>
                {renderTableRows()}
              </tbody>
            </table>
          </div>

          {renderFirstRowDetails()}
        </>
      )}

      {data && data.length === 0 && (
        <div style={{ padding: '20px', backgroundColor: '#fff3e0' }}>
          No data found for {selectedTab} tab.
        </div>
      )}
    </div>
  )
}
