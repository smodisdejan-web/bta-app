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

import { NextResponse } from 'next/server'
import { clearSheetCache } from '@/lib/sheetsData'
import { clearFunnelCache } from '@/lib/business-funnel'

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
  console.log('[cache] cleared sheet + funnel caches')

  return NextResponse.json(
    { ok: true, cleared: ['sheetCache', 'funnelCache'], at: new Date().toISOString() },
    { headers: NO_STORE }
  )
}
