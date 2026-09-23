import { NextResponse, type NextRequest } from 'next/server'

const AUTH_COOKIE = 'ai_unlock'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allowlist: public assets and the unlock/auth endpoints
  const isPublicAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/branding') ||
    pathname.startsWith('/icons') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/fonts')

  const PUBLIC_PATHS = [
    '/unlock',
    '/api/auth',
    '/api/health',
    '/api/openai-health',
    '/api/sheets-probe',
    '/api/insights', // <= required
    '/api/models',
    '/api/diag',
    '/api/turkey-kpis', // CEO scoreboard for Goolets Content Portal (different origin, no auth cookie)
    '/api/early-booking-kpis', // CEO scoreboard — Early Booking Croatia 2027 (same, cross-origin)
    '/api/dalmatincki-kpis', // CEO scoreboard — Last Minute Dalmatinčki funnel (same, cross-origin)
    '/api/live-ads', // Content Bank "Live in ads" badge — flat delivered-ads list (cross-origin)
    '/api/funnel', // Business Health Funnel — master + 6 campaign drill-downs (cross-origin)
    '/api/cache', // POST /api/cache/clear — gated by the X-Admin-Token header, called by refresh-mtd.sh
    '/favicon.ico',
    '/branding',
    '/fonts'
  ]

  const isPublicPath = PUBLIC_PATHS.some(path => 
    pathname === path || pathname.startsWith(path + '/')
  )

  // Routes that own their Cache-Control. Stamping `no-store` over an `s-maxage` here is not a
  // detail: it silently deletes the edge cache those routes exist for. /api/overview-data joined
  // the list on 2026-09-23 — one shared 10-minute build per window is the entire point of it.
  const ownsCacheControl =
    pathname.startsWith('/api/funnel') ||
    pathname.startsWith('/api/overview-data') ||
    pathname.startsWith('/api/sheet-tabs')

  if (isPublicAsset || isPublicPath) {
    const res = NextResponse.next()
    // /api/funnel sets its own s-maxage so the CDN can absorb the portal's 7 calls per view.
    if (!ownsCacheControl) res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const isAuthenticated = request.cookies.get(AUTH_COOKIE)?.value === '1'

  if (!isAuthenticated) {
    const url = request.nextUrl.clone()
    url.pathname = '/unlock'
    url.searchParams.set('redirect', pathname || '/')
    const res = NextResponse.redirect(url)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const res = NextResponse.next()
  if (!ownsCacheControl) res.headers.set('Cache-Control', 'no-store')
  return res
}

export const config = {
  matcher: ['/((?!_next|favicon|branding).*)']
}


