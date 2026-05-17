import { NextResponse } from 'next/server'
import {
  fetchTab,
  fetchHubspotContacts,
  fetchStreakSync,
  fetchGA4LandingPages,
  fetchBookings,
} from '@/lib/sheetsData'
import {
  joinHubspotStreak,
  filterByDateRange,
  isAttributableLP,
  aggregateByLP,
  aggregateGA4ByLP,
  aggregateBookingsByEmail,
  computeTotals,
  getQualityWinners,
  getLeakyPages,
  aggregateByChannel,
  aggregateByForm,
} from '@/lib/lp-attribution'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    // Prefer explicit from/to (lets page send MTD, lastMonth bounds). Fall back to days.
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    const days = parseInt(searchParams.get('days') || '90')

    let fromISO: string
    let toISO: string
    if (fromParam && toParam) {
      fromISO = new Date(fromParam).toISOString()
      toISO = new Date(toParam).toISOString()
    } else {
      const to = new Date()
      const from = new Date()
      from.setDate(from.getDate() - days)
      fromISO = from.toISOString()
      toISO = to.toISOString()
    }

    const fetchSheetFn = async ({ sheetUrl, tab }: { sheetUrl: string; tab: string }) => {
      const res = await fetchTab(tab, sheetUrl)
      return [res.headers, ...res.rows]
    }

    const [hsContacts, streakLeads, ga4Rows, bookings] = await Promise.all([
      fetchHubspotContacts(fetchSheetFn),
      fetchStreakSync(fetchSheetFn),
      fetchGA4LandingPages(fetchSheetFn),
      fetchBookings(fetchSheetFn),
    ])

    // Join + filter
    const joined = joinHubspotStreak(hsContacts, streakLeads)

    const inRange = filterByDateRange(joined, fromISO, toISO)
    const attributable = inRange.filter(l => isAttributableLP(l.first_url_path))

    // Aggregate (GA4 + bookings maps joined per LP path / email)
    const ga4Map = aggregateGA4ByLP(ga4Rows, fromISO, toISO)
    const bookingMap = aggregateBookingsByEmail(bookings)
    const aggregates = aggregateByLP(attributable, ga4Map, bookingMap)
    const totals = computeTotals(attributable, aggregates, fromISO, toISO)
    const quality_winners = getQualityWinners(aggregates)
    const leaky_pages = getLeakyPages(aggregates)
    const by_channel = aggregateByChannel(attributable)
    const by_form = aggregateByForm(attributable)

    return NextResponse.json({
      totals,
      aggregates,
      quality_winners,
      leaky_pages,
      by_channel,
      by_form,
      meta: {
        hsContactsTotal: hsContacts.length,
        streakLeadsTotal: streakLeads.length,
        ga4RowsTotal: ga4Rows.length,
        ga4LpsInRange: ga4Map.size,
        bookingsTotal: bookings.length,
        afterDateFilter: inRange.length,
        afterLPFilter: attributable.length,
        fromISO,
        toISO,
      },
    })
  } catch (error: any) {
    console.error('[lp-funnel API] error:', error)
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
