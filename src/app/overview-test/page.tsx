'use client';

import { useState, useEffect } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { getOverviewData, getDateRange } from '@/lib/overview-data'
import DebugLogger from '@/components/DebugLogger'
import { formatCurrency } from '@/lib/utils'

export default function OverviewTestPage() {
  const { settings } = useSettings()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!settings.sheetUrl) {
        setError('No sheet URL configured')
        return
      }

      setLoading(true)
      setError(null)

      try {
        const { start, end } = getDateRange('30d')
        const from = start.toISOString().split('T')[0]
        const to = end.toISOString().split('T')[0]

        console.log('[Test] Fetching data...', { from, to })
        const result = await getOverviewData({ from, to, sheetUrl: settings.sheetUrl })
        console.log('[Test] Data received:', result)

        setData(result)
      } catch (err) {
        console.error('[Test] Error:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [settings.sheetUrl])

  const debug = data?.__debug ? {
    range: { from: '30d ago', to: 'today' },
    fb: data.__debug.fb,
    google: data.__debug.ga,
    contacts: data.__debug.contacts,
    deals: data.__debug.deals,
    env: data.__debug.env,
    error: data.__debug.error,
  } : null

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Overview Test Page</h1>
        
        {loading && <div className="p-4 bg-blue-50 rounded">Loading...</div>}
        {error && <div className="p-4 bg-red-50 rounded text-red-700">{error}</div>}
        
        {data && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded">
              <h2 className="font-bold mb-2">KPIs</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Revenue: {formatCurrency(data.kpis.revenue, '€')}</div>
                <div>Spend: {formatCurrency(data.kpis.spend, '€')}</div>
                <div>Leads: {data.kpis.leads}</div>
                <div>Won Deals: {data.kpis.wonDeals}</div>
                <div>ROAS: {data.kpis.roas.toFixed(2)}x</div>
                <div>Trend points: {data.trend.length}</div>
              </div>
            </div>

            {debug && (
              <>
                <DebugLogger {...debug} />
                <div className="p-4 bg-yellow-50 rounded text-xs">
                  <h3 className="font-bold mb-2">Debug Info (check console for full details)</h3>
                  <div>FB rows: {debug.fb?.rows || 0} | Spend: {debug.fb?.spendTotal || 0}</div>
                  <div>GA rows: {debug.google?.rows || 0} | Spend: {debug.google?.spendTotal || 0}</div>
                  <div>Contacts rows: {debug.contacts?.rows || 0}</div>
                  <div>Deals rows: {debug.deals?.rows || 0}</div>
                  {debug.error && <div className="text-red-600 font-semibold mt-2">Error: {debug.error}</div>}
                  {(debug.fb?.error || debug.google?.error || debug.contacts?.error || debug.deals?.error) && (
                    <div className="mt-2 space-y-1">
                      {debug.fb?.error && <div className="text-red-600">FB: {debug.fb.error}</div>}
                      {debug.google?.error && <div className="text-red-600">Google: {debug.google.error}</div>}
                      {debug.contacts?.error && <div className="text-red-600">Contacts: {debug.contacts.error}</div>}
                      {debug.deals?.error && <div className="text-red-600">Deals: {debug.deals.error}</div>}
                    </div>
                  )}
                  {/* Detailed column info */}
                  {(debug.contacts || debug.deals) && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      {debug.contacts && (
                        <div>
                          <div className="font-semibold">Contacts:</div>
                          {debug.contacts.minDate && <div>Min date: {debug.contacts.minDate}</div>}
                          {debug.contacts.maxDate && <div>Max date: {debug.contacts.maxDate}</div>}
                          {debug.contacts.foundColumns && (
                            <div className="mt-1">
                              <div>Found columns:</div>
                              <div className="pl-2">Date: {debug.contacts.foundColumns.date || '✗'}</div>
                              <div className="pl-2">Lifecycle: {debug.contacts.foundColumns.lifecycle || '✗'}</div>
                              <div className="pl-2">Lead Status: {debug.contacts.foundColumns.leadStatus || '✗'}</div>
                            </div>
                          )}
                          {debug.contacts.columns && debug.contacts.columns.length > 0 && (
                            <div className="mt-1 text-xs opacity-75">All: {debug.contacts.columns.slice(0, 10).join(', ')}{debug.contacts.columns.length > 10 ? '...' : ''}</div>
                          )}
                        </div>
                      )}
                      {debug.deals && (
                        <div>
                          <div className="font-semibold">Deals:</div>
                          {debug.deals.minDate && <div>Min date: {debug.deals.minDate}</div>}
                          {debug.deals.maxDate && <div>Max date: {debug.deals.maxDate}</div>}
                          {debug.deals.foundColumns && (
                            <div className="mt-1">
                              <div>Found columns:</div>
                              <div className="pl-2">Created: {debug.deals.foundColumns.created || '✗'}</div>
                              <div className="pl-2">Closed: {debug.deals.foundColumns.closed || '✗'}</div>
                              <div className="pl-2">Stage: {debug.deals.foundColumns.stage || '✗'}</div>
                              <div className="pl-2">Amount: {debug.deals.foundColumns.amount || '✗'}</div>
                            </div>
                          )}
                          {debug.deals.columns && debug.deals.columns.length > 0 && (
                            <div className="mt-1 text-xs opacity-75">All: {debug.deals.columns.slice(0, 10).join(', ')}{debug.deals.columns.length > 10 ? '...' : ''}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

