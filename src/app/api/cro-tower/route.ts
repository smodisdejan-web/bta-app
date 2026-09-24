import { NextResponse } from 'next/server'
import { CRO_PERIODS } from '@/lib/cro-tower'
import { getCroTower, refreshCroTower } from '@/lib/cro-tower-cache'

// GET /api/cro-tower?period=week|month|m3|m6|ytd[&anchor=YYYY-MM | YYYY-MM-DD for week][&nocache=1]
//
// Web Funnel CRO tower (Tadej) — PHASE 1: data only. Definitions live in lib/cro-tower.ts, the
// channel mapping in lib/cro-channel-map.ts. Same contract as /api/funnel:
//   - CORS open (the Goolets Content Portal is a different origin), public in middleware.ts
//   - edge cache `public, s-maxage=600, stale-while-revalidate=1800`; ?nocache=1 → no-store and a
//     rebuild that skips the 15-minute in-process result cache
//   - fail loud: a dead feed is null + meta.flags, never 0; a build that cannot run at all is a 500
//
// NB: no `dynamic = 'force-dynamic'` (it would stamp max-age=0 over our Cache-Control).
export const maxDuration = 300
export const fetchCache = 'default-no-store'

const CACHE_HEADER = 'public, s-maxage=600, stale-while-revalidate=1800'
const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const nocache = searchParams.get('nocache') === '1'
  const headers = { ...baseHeaders, 'Cache-Control': nocache ? 'no-store' : CACHE_HEADER }
  const period = (searchParams.get('period') || 'month').trim().toLowerCase()
  const anchor = (searchParams.get('anchor') || '').trim() || null

  if (!CRO_PERIODS.includes(period as any)) {
    return NextResponse.json({ error: `Unknown period "${period}"`, periods: CRO_PERIODS }, { status: 400, headers })
  }
  if (anchor && !/^\d{4}-\d{2}(-\d{2})?$/.test(anchor)) {
    return NextResponse.json({ error: 'anchor must be YYYY-MM (or YYYY-MM-DD for period=week)' }, { status: 400, headers })
  }

  try {
    // ?nocache=1 (the Refresh button) rebuilds only when the cached build is older than an hour;
    // otherwise it hands the cached build back with meta.refresh = 'fresh' (2026-09-24: two
    // Refresh clicks at 07:45 = two parallel 40-80 s cold builds that overloaded Apps Script).
    const data = nocache ? await refreshCroTower({ period, anchor }) : await getCroTower({ period, anchor })
    return NextResponse.json(data, { headers })
  } catch (err) {
    const msg = (err as Error).message || 'Failed to build CRO tower'
    console.error('[cro-tower] failed', err)
    const status = /anchor|period|not complete|future/.test(msg) ? 400 : 500
    return NextResponse.json({ error: msg }, { status, headers })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...baseHeaders, 'Cache-Control': CACHE_HEADER, 'Access-Control-Allow-Headers': 'Content-Type' },
  })
}
