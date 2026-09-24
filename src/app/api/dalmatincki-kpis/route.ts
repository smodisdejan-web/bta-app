import { NextResponse } from 'next/server'
import { loadCampaignFunnel } from '@/lib/campaign-funnel'

export const dynamic = 'force-dynamic'

// CEO scoreboard — Last Minute Dalmatinčki funnel (all Dalmatinčki campaigns).
// Streak leads matched by SOURCE PLACEMENT containing 'dalmatin' (dalmatincki*/dalmatinčki/
// *dalmatino); bookings by campaign containing 'dalmatin'. FB data from fb_dalmatincki (YTD).

const TTL_MS = 10 * 60 * 1000
let cache: { at: number; data: unknown } | null = null
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

const CONFIG = {
  title: 'Last Minute Dalmatinčki',
  window: 'YTD 2026',
  fbTab: 'fb_dalmatincki',
  sourcePlacementMatch: (sp: string) => /dalmatin/i.test(sp),
  bookingMatch: (c: string) => /dalmatin/i.test(c),
  bookingDateFrom: '2026', // campaign active in 2026 — exclude pre-2026 (stale 2025-season bookings)
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  try {
    if (!fresh && cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data, { headers })
    const data = await loadCampaignFunnel(CONFIG)
    cache = { at: Date.now(), data }
    return NextResponse.json(data, { headers })
  } catch (err) {
    console.error('[dalmatincki-kpis] failed', err)
    if (cache) return NextResponse.json(cache.data, { headers })
    return NextResponse.json({ error: 'Failed to load Dalmatinčki KPI summary' }, { status: 500, headers })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': 'Content-Type' } })
}
