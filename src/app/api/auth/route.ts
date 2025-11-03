import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'ai_unlock';            // keep consistent with middleware

export async function POST(request: Request) {
  try {
    const { password, remember } = await request.json();

    // simple password check; keep or switch to env
    const ok =
      password === process.env.UNLOCK_PASSWORD ||
      password === 'GooletsAIagent';

    if (!ok) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 400 });
    }

    // set cookie on the response (supported way)
    const maxAge = remember ? 60 * 60 * 24 * 7 : undefined; // 7 days or session
    const res = NextResponse.json({ ok: true });
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set(AUTH_COOKIE, '1', {
      path: '/',
      httpOnly: false,          // set true if client-side read is not needed
      sameSite: 'lax',
      maxAge, // undefined => session cookie
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}


