// POST /api/cro-tower/unlock — checks CRO_TOWER_PASSWORD and sets the httpOnly `cro_unlock`
// cookie for 30 days. Accepts the unlock page's form post (→ 303 redirect) or JSON
// ({password} → {ok}). Separate from /api/auth (the BTA `ai_unlock` gate).
import { NextResponse } from 'next/server'
import { CRO_COOKIE, CRO_COOKIE_MAX_AGE, croCookieValue } from '@/lib/cro-auth'

export const runtime = 'nodejs'

// Per-instance brute-force brake: 10 attempts per IP per minute.
const tries = new Map<string, { at: number; n: number }>()

export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  const t = tries.get(ip)
  if (t && now - t.at < 60_000 && t.n >= 10) {
    return NextResponse.json({ error: 'Too many attempts, wait a minute' }, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }
  tries.set(ip, t && now - t.at < 60_000 ? { at: t.at, n: t.n + 1 } : { at: now, n: 1 })

  const ctype = request.headers.get('content-type') || ''
  const isJson = ctype.includes('application/json')
  let password = ''
  let next = '/cro-tower'
  try {
    if (isJson) {
      const b = await request.json()
      password = String(b?.password ?? '')
    } else {
      const f = await request.formData()
      password = String(f.get('password') ?? '')
      const n = String(f.get('next') ?? '')
      if (n.startsWith('/cro-tower')) next = n
    }
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const expected = process.env.CRO_TOWER_PASSWORD
  if (!expected) {
    return NextResponse.json({ error: 'CRO_TOWER_PASSWORD is not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const origin = new URL(request.url).origin
  if (password.trim() !== expected) {
    if (isJson) return NextResponse.json({ error: 'Invalid password' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.redirect(`${origin}/cro-tower/unlock?e=1&next=${encodeURIComponent(next)}`, 303)
  }

  const res = isJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(`${origin}${next === '/cro-tower/unlock' ? '/cro-tower' : next}`, 303)
  res.headers.set('Cache-Control', 'no-store')
  res.cookies.set(CRO_COOKIE, await croCookieValue(expected), {
    path: '/',
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    maxAge: CRO_COOKIE_MAX_AGE,
  })
  return res
}
