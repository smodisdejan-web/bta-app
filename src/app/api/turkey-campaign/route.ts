import { NextResponse } from 'next/server'
import { loadTurkeyCampaign, type TurkeyCampaignResult } from '@/lib/turkey-campaign'

export const dynamic = 'force-dynamic'

// In-memory cache (per warm serverless instance). The underlying tabs only change ~daily via the
// /gm syncs, so a short TTL turns repeat loads instant for the team. `?fresh=1` bypasses it
// (the Refresh button). On error we serve stale cache rather than failing.
const TTL_MS = 10 * 60 * 1000
let cache: { at: number; data: TurkeyCampaignResult } | null = null

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  try {
    if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json(cache.data)
    }
    const data = await loadTurkeyCampaign()
    // A result with 0 leads means an upstream sheet fetch (streak_sync) came back empty this
    // compute — it's NOT real data. Never cache or serve it as-is: poisoning the 10-min cache
    // with zeros is what made the whole dashboard show empty. Serve last-good instead.
    if ((data?.funnel?.leads ?? 0) <= 0 || (data?.columns?.red1?.fbSpend ?? 0) <= 0) {
      console.warn('[turkey-campaign] partial compute (0 leads or 0 FB spend) — serving last-good, not caching')
      if (cache) return NextResponse.json(cache.data)
      return NextResponse.json(data) // nothing cached yet; return without caching
    }
    cache = { at: Date.now(), data }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[turkey-campaign] failed', err)
    if (cache) return NextResponse.json(cache.data) // serve last good data instead of erroring
    return NextResponse.json({ error: 'Failed to load Turkey campaign data' }, { status: 500 })
  }
}
