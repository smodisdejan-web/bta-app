// GET /cro-tower — the standalone Web Funnel CRO page for Tadej (NOT part of the portal).
//
// Served as a complete HTML document from a route handler, so it carries none of the BTA app
// layout / navigation: it is the approved demo (cro-control-tower-demo/index.html) 1:1, with its
// renderers fed by /api/cro-tower. Source: src/lib/cro-tower-page/*, built into html.ts by
// scripts/build-cro-tower-page.mjs. Gate: middleware.ts (cookie cro_unlock ← CRO_TOWER_PASSWORD).
import { CRO_TOWER_HTML } from '@/lib/cro-tower-page/html'

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(CRO_TOWER_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // no-store (+ legacy Pragma/Expires): after a password rotation a stale copy must never be
      // shown; every load goes through middleware, which checks the cookie.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
