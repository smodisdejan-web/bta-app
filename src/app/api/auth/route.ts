import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const AUTH_COOKIE = 'bta_auth'
const PASSWORD = 'GooletsAIagent'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { password?: string }
    const { password } = body

    if (password !== PASSWORD) {
      return NextResponse.json({ ok: false, error: 'Invalid password' }, { status: 401 })
    }

    // Set cookie for 7 days
    cookies().set(AUTH_COOKIE, '1', {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
      maxAge: 60 * 60 * 24 * 7
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'Unexpected error' }, { status: 500 })
  }
}


