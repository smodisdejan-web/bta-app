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
    pathname.startsWith('/images')

  const isUnlockRoute = pathname === '/unlock' || pathname.startsWith('/api/auth')

  if (isPublicAsset || isUnlockRoute) {
    return NextResponse.next()
  }

  const isAuthenticated = request.cookies.get(AUTH_COOKIE)?.value === '1'

  if (!isAuthenticated) {
    const url = request.nextUrl.clone()
    url.pathname = '/unlock'
    url.searchParams.set('redirect', pathname || '/')
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next|favicon|branding).*)']
}


