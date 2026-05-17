import { NextResponse } from 'next/server'
import { fetchTab, fetchHubspotContacts, fetchStreakSync, fetchGA4LandingPages, fetchBookings } from '@/lib/sheetsData'
import { joinHubspotStreak, filterByDateRange, aggregateGA4ByLP, aggregateBookingsByEmail, type JoinedLead } from '@/lib/lp-attribution'

export const dynamic = 'force-dynamic'

function topNByCount<T>(items: T[], getKey: (x: T) => string, n = 10): { key: string; count: number; ql: number }[] {
  const map = new Map<string, { count: number; ql: number }>()
  for (const item of items) {
    const key = getKey(item)
    if (!key) continue
    if (!map.has(key)) map.set(key, { count: 0, ql: 0 })
    const s = map.get(key)!
    s.count++
    if ((item as any).is_ql) s.ql++
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, count: v.count, ql: v.ql }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')

    if (!path) {
      return NextResponse.json({ error: 'path query param required' }, { status: 400 })
    }

    let fromISO: string
    let toISO: string
    if (fromParam && toParam) {
      fromISO = new Date(fromParam).toISOString()
      toISO = new Date(toParam).toISOString()
    } else {
      const to = new Date()
      const from = new Date()
      from.setDate(from.getDate() - 90)
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

    const joined = joinHubspotStreak(hsContacts, streakLeads)
    const inRange = filterByDateRange(joined, fromISO, toISO)
    const lpLeads = inRange.filter(l => l.first_url_path === path)
    const ga4Map = aggregateGA4ByLP(ga4Rows, fromISO, toISO)
    const ga4Lp = ga4Map.get(path) || null
    const bookingMap = aggregateBookingsByEmail(bookings)

    // Bookings attributed to this LP (via lead email match)
    let totalBookings = 0
    let totalRevenue = 0
    const bookedLeadEmails = new Set<string>()
    for (const lead of lpLeads) {
      const b = bookingMap.get(lead.email)
      if (b) {
        totalBookings += b.count
        totalRevenue += b.revenue
        bookedLeadEmails.add(lead.email)
      }
    }

    if (lpLeads.length === 0) {
      return NextResponse.json({ error: 'No leads for this LP in selected range' }, { status: 404 })
    }

    // Totals
    const matched = lpLeads.filter(l => l.is_matched)
    const ql = lpLeads.filter(l => l.is_ql).length
    const aiScores = matched.map(l => l.ai_score || 0).filter(s => s > 0)
    const avg_ai_score = aiScores.length > 0 ? aiScores.reduce((a, b) => a + b, 0) / aiScores.length : 0

    // Breakdowns
    const by_channel = topNByCount(lpLeads, l => l.hs_analytics_source || 'UNKNOWN', 10)
    const by_campaign = topNByCount(lpLeads, l => l.utm_campaign, 10)
    const by_form = topNByCount(lpLeads, l => l.recent_conversion_event_name, 10)
    const by_country = topNByCount(lpLeads, l => (l.country || 'Unknown').trim(), 10)

    // AI score distribution
    const ai_buckets = [
      { range: '0-20',  min: 0,  max: 20,  count: 0 },
      { range: '20-40', min: 20, max: 40,  count: 0 },
      { range: '40-60', min: 40, max: 60,  count: 0 },
      { range: '60-80', min: 60, max: 80,  count: 0 },
      { range: '80-100', min: 80, max: 101, count: 0 },
    ]
    for (const score of aiScores) {
      const bucket = ai_buckets.find(b => score >= b.min && score < b.max)
      if (bucket) bucket.count++
    }

    // Recent 15 leads
    const recent = [...lpLeads]
      .sort((a, b) => (a.createdate < b.createdate ? 1 : -1))
      .slice(0, 15)
      .map(l => ({
        email: l.email,
        ai_score: l.ai_score,
        is_ql: l.is_ql,
        is_matched: l.is_matched,
        country: l.country,
        createdate: l.createdate,
        utm_campaign: l.utm_campaign,
        channel: l.hs_analytics_source,
        stage: l.streak_stage,
      }))

    return NextResponse.json({
      path,
      totals: {
        leads: lpLeads.length,
        matched: matched.length,
        ql,
        ql_rate: lpLeads.length > 0 ? (ql / lpLeads.length) * 100 : 0,
        avg_ai_score,
        sessions: ga4Lp?.sessions,
        users: ga4Lp?.users,
        cvr: ga4Lp && ga4Lp.sessions > 0 ? (lpLeads.length / ga4Lp.sessions) * 100 : undefined,
        bookings: totalBookings,
        revenue: totalRevenue,
        avg_deal: totalBookings > 0 ? totalRevenue / totalBookings : 0,
      },
      by_channel,
      by_campaign,
      by_form,
      by_country,
      ai_buckets,
      recent,
      meta: { fromISO, toISO },
    })
  } catch (error: any) {
    console.error('[lp-funnel/detail API] error:', error)
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 })
  }
}
