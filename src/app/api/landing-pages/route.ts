import { NextResponse } from 'next/server'
import {
  fetchGA4LandingPages,
  calculateGA4Totals,
  filterByDateRange,
  getTopPerformers,
  getLeakyBuckets,
  aggregateBySource,
  aggregateByDevice,
  aggregateByLandingPage,
  isRelevantPage,
} from '@/lib/ga4-landing-pages'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30')

    console.log('[landing-pages API] Fetching data for', days, 'days')

    const allData = await fetchGA4LandingPages()
    console.log('[landing-pages API] Total rows fetched:', allData.length)

    const filtered = filterByDateRange(allData, days)
    console.log('[landing-pages API] Rows after date filter:', filtered.length)

    const totals = calculateGA4Totals(filtered)

    // Build simple time series by date
    const timeseriesMap = new Map<
      string,
      {
        sessions: number
        conversions: number
      }
    >()

    filtered.forEach((row) => {
      const key = row.date
      const current = timeseriesMap.get(key) || { sessions: 0, conversions: 0 }
      current.sessions += row.sessions
      current.conversions += row.conversions
      timeseriesMap.set(key, current)
    })

    const timeseries = Array.from(timeseriesMap.entries())
      .map(([date, v]) => ({
        date,
        sessions: v.sessions,
        conversions: v.conversions,
        conversionRate: v.sessions > 0 ? (v.conversions / v.sessions) * 100 : 0,
      }))
      .sort((a, b) => (a.date > b.date ? 1 : -1))
    const topPerformers = getTopPerformers(filtered, 5)
    const leakyBuckets = getLeakyBuckets(filtered, 5)
    const bySource = aggregateBySource(filtered)
    const byDevice = aggregateByDevice(filtered)
    const allPages = aggregateByLandingPage(filtered)
      .filter((d) => isRelevantPage(d.landingPage))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 100)

    return NextResponse.json({
      totals,
      topPerformers,
      leakyBuckets,
      bySource,
      byDevice,
      allPages,
      timeseries,
      meta: {
        days,
        totalRows: filtered.length,
        dateRange: {
          from: filtered.length > 0 ? filtered.reduce((min, d) => (d.date < min ? d.date : min), filtered[0].date) : null,
          to: filtered.length > 0 ? filtered.reduce((max, d) => (d.date > max ? d.date : max), filtered[0].date) : null,
        },
      },
    })
  } catch (error) {
    console.error('[landing-pages API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch landing pages data' }, { status: 500 })
  }
}

