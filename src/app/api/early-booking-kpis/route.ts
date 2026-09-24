import { NextResponse } from 'next/server'
import { loadEarlyBookingKpis } from '@/lib/early-booking'

export const dynamic = 'force-dynamic'

// CEO-level summary for the Goolets Content Portal "Published" tab — Early Booking Croatia 2027.
// Mirrors /api/turkey-kpis (CORS + 10-min cache) but returns the campaign-scoreboard contract
// (layout:'campaign' → Spend · Leads · CPL · QL · CPQL · Bookings · RVC · ROI + per-ad table).

const TTL_MS = 10 * 60 * 1000
let cache: { at: number; data: unknown } | null = null

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  try {
    if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json(cache.data, { headers })
    }
    const data = await loadEarlyBookingKpis()
    cache = { at: Date.now(), data }
    return NextResponse.json(data, { headers })
  } catch (err) {
    console.error('[early-booking-kpis] failed', err)
    if (cache) return NextResponse.json(cache.data, { headers })
    return NextResponse.json({ error: 'Failed to load Early Booking KPI summary' }, { status: 500, headers })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...headers, 'Access-Control-Allow-Headers': 'Content-Type' },
  })
}
