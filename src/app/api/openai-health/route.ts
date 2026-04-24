import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Legacy endpoint name — still checks the active AI provider (now Anthropic)
export async function GET() {
  const raw = process.env.ANTHROPIC_API_KEY || '';
  const masked = raw ? raw.slice(0,8) + '...' + raw.slice(-4) : '(missing)';
  return NextResponse.json({
    ok: !!raw,
    keyMasked: masked,
    provider: 'anthropic',
    note: "Never expose secrets to the client. This endpoint only returns a masked value."
  });
}
