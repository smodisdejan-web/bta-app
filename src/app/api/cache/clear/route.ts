// src/app/api/cache/clear/route.ts
//
// POST /api/cache/clear  —  drop the server-side sheet caches.
//
// WHY. /api/overview-data and /api/funnel sit on in-memory tab caches (10 min in
// lib/sheetsData.ts, 15 min in lib/business-funnel.ts) plus a 10-minute edge cache. That is
// exactly right for readers and exactly wrong for the moment /gm has just rewritten the sheets:
// the freshly synced numbers would wait out the TTL. This route is the "the data just changed"
// signal, called at the end of code/goolets/refresh-mtd.sh.
//
// AUTH. Header `X-Admin-Token` must equal env CACHE_ADMIN_TOKEN. No env set = 503 (the route is
// off, not open); wrong token = 401. It is in the middleware allowlist because a shell script has
// no unlock cookie — the token is the whole gate, so never set it to a guessable value.
//
// It only forgets things. It cannot change a number, and the next read goes to Apps Script.
//
// SHARED DATA CACHE (2026-09-24). The CRO tower's and /api/funnel's shared entries are NOT
// deleted here — they are marked stale (served as-is, rebuilt in the background) — and the
// server-side warm chain (/api/cron/warm) is started right after the response, so readers keep
// getting the last good build while Vercel rebuilds each period one at a time. Deleting them was
// what made the first visitor of the day wait through a 40-80 s cold build (Tadej, 24.9. 07:46).

import { NextResponse, after } from 'next/server'
import { clearSheetCache } from '@/lib/sheetsData'
import { clearFunnelCache } from '@/lib/business-funnel'
import { clearCroTowerCache } from '@/lib/cro-tower'
import { markCroStale } from '@/lib/cro-tower-cache'
import { markFunnelStale } from '@/lib/funnel-cache'

export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const expected = process.env.CACHE_ADMIN_TOKEN
  if (!expected) {
    return NextResponse.json(
      { error: 'CACHE_ADMIN_TOKEN is not set — cache clearing is disabled' },
      { status: 503, headers: NO_STORE }
    )
  }
  if (request.headers.get('x-admin-token') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  clearSheetCache()
  clearFunnelCache()
  clearCroTowerCache()
  // Shared Data Cache (all instances): stale, not gone. The warm chain below overwrites it.
  markCroStale()
  markFunnelStale()
  console.log('[cache] cleared sheet + funnel + cro-tower caches; shared entries marked stale')

  // Start the sequential warm chain on Vercel (one build per invocation, see api/cron/warm).
  const skipWarm = new URL(request.url).searchParams.get('warm') === '0'
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(request.url).origin
  if (!skipWarm) {
    after(async () => {
      try {
        const r = await fetch(`${origin}/api/cron/warm?i=0`, { headers: { 'x-admin-token': expected }, cache: 'no-store' })
        console.log(`[cache] warm chain started: HTTP ${r.status}`)
      } catch (err) {
        console.error('[cache] could not start the warm chain', err)
      }
    })
  }

  return NextResponse.json(
    {
      ok: true,
      cleared: ['sheetCache', 'funnelCache', 'croTowerCache'],
      staled: ['croTowerDataCache', 'funnelDataCache'],
      warm: skipWarm ? 'skipped' : 'started (/api/cron/warm chain, ~5-10 min)',
      at: new Date().toISOString(),
    },
    { headers: NO_STORE }
  )
}
