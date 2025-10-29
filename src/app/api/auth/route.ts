import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'ai_unlock';            // keep consistent with middleware
const MAX_AGE = 60 * 60 * 24 * 7;           // 7 days

export async function POST(request: Request) {
  try {
    const { password, redirectTo } = await request.json();

    // simple password check; keep or switch to env
    const ok =
      password === process.env.UNLOCK_PASSWORD ||
      password === 'GooletsAIagent';

    if (!ok) {
      return NextResponse.json({ ok: false, error: 'Invalid password' }, { status: 401 });
    }

    // set cookie on the response (supported way)
    const res = NextResponse.json({ ok: true, redirectTo: redirectTo || '/' });
    res.cookies.set(AUTH_COOKIE, '1', {
      path: '/',
      httpOnly: false,          // set true if client-side read is not needed
      sameSite: 'lax',
      maxAge: MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
}


