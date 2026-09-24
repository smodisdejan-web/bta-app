import { NextResponse, type NextRequest } from 'next/server'
import { CRO_COOKIE, isCroUnlocked } from '@/lib/cro-auth'

const AUTH_COOKIE = 'ai_unlock'

// Clean alias for Tadej: on these hosts ONLY the CRO tower exists. /cro-tower*, /api/cro-tower*
// and the page icon pass through; every other path (/, /overview, /api/funnel …) is rewritten to
// /cro-tower, so no other BTA route is reachable there and nothing 404s. Redirects are built from
// request.nextUrl, so they stay on the alias host. The cro_unlock cookie has no Domain attribute,
// so it is simply scoped to whichever host set it.
const CRO_ALIAS_HOSTS = new Set(['goolets-cro.vercel.app'])

export async function middleware(request: NextRequest) {
  let { pathname } = request.nextUrl
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]
  let croRewrite = false
  if (CRO_ALIAS_HOSTS.has(host)) {
    if (pathname === '/icon.svg' || pathname === '/favicon.ico') return NextResponse.next()
    const croPath =
      pathname === '/cro-tower' || pathname.startsWith('/cro-tower/') ||
      pathname === '/api/cro-tower' || pathname.startsWith('/api/cro-tower/')
    if (!croPath) {
      pathname = '/cro-tower'
      croRewrite = true
    }
  }

  // ── Web Funnel CRO tower: its OWN gate (cookie cro_unlock ← CRO_TOWER_PASSWORD), checked
  // before everything else so the BTA ai_unlock gate never applies to it. The plain JSON
  // /api/cro-tower stays public (like /api/funnel); the page and the AI routes under
  // /api/cro-tower/* need the cookie. The unlock page + its POST are open.
  if (pathname === '/cro-tower/unlock' || pathname === '/api/cro-tower/unlock') {
    const res = NextResponse.next()
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
  const croPage = pathname === '/cro-tower' || pathname.startsWith('/cro-tower/')
  const croApi = pathname.startsWith('/api/cro-tower/')
  if (croPage || croApi) {
    if (!(await isCroUnlocked(request.cookies.get(CRO_COOKIE)?.value))) {
      if (croApi) {
        return NextResponse.json({ error: 'Unauthorized: unlock /cro-tower first' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/cro-tower/unlock'
      url.search = ''
      url.searchParams.set('next', pathname)
      const res = NextResponse.redirect(url)
      res.headers.set('Cache-Control', 'no-store')
      return res
    }
    let res: NextResponse
    if (croRewrite) {
      const url = request.nextUrl.clone()
      url.pathname = '/cro-tower'
      url.search = ''
      res = NextResponse.rewrite(url)
    } else {
      res = NextResponse.next()
    }
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

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
    '/api/cro-tower', // Web Funnel CRO tower for Tadej — portal "Web funnel · CRO" section (cross-origin)
    '/api/cache', // POST /api/cache/clear — gated by the X-Admin-Token header, called by refresh-mtd.sh
    '/api/cron', // GET /api/cron/warm — Vercel cron (Bearer CRON_SECRET) or X-Admin-Token; sequential cache warm-up
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
    pathname.startsWith('/api/cro-tower') ||
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


