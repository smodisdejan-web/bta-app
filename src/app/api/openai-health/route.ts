import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const raw = process.env.OPENAI_API_KEY || '';
  const masked = raw ? raw.slice(0,8) + '...' + raw.slice(-4) : '(missing)';
  return NextResponse.json({
    ok: !!raw,
    keyMasked: masked,
    note: "Never expose secrets to the client. This endpoint only returns a masked value."
  });
}

