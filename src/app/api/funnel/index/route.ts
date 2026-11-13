import { NextResponse } from 'next/server'
import { getFunnelIndex } from '@/lib/funnel-cache'
import { resolveRange, RANGE_KEYS, type Channel } from '@/lib/business-funnel'

// GET /api/funnel/index?range=this_month|last_month|3m|ytd  or  ?start=YYYY-MM-DD&end=YYYY-MM-DD [&channel=]
// Lightweight search index for the portal: master, the 5 funnels + Outside, every campaign under
// each funnel (with its spend and leads for the range). The 16 umbrellas only with &umbrellas=1.
export const maxDuration = 300
const ISO = /^\d{4}-\d{2}-\d{2}$/
const base = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const nocache = sp.get('nocache') === '1'
  const headers = { ...base, 'Cache-Control': nocache ? 'no-store' : 'public, s-maxage=600, stale-while-revalidate=1800' }
  const rangeParam = (sp.get('range') || '').trim().toLowerCase()
  const start = sp.get('start') || '', end = sp.get('end') || ''
  if (rangeParam && !RANGE_KEYS.includes(rangeParam as any)) return NextResponse.json({ error: `Unknown range "${rangeParam}"` }, { status: 400, headers })
  if ((!rangeParam || rangeParam === 'custom') && (!ISO.test(start) || !ISO.test(end) || start > end))
    return NextResponse.json({ error: 'range= or start/end (YYYY-MM-DD) required' }, { status: 400, headers })
  const channel = ((sp.get('channel') || 'all').toLowerCase()) as Channel
  if (!['all', 'meta', 'google', 'bing', 'chatgpt'].includes(channel)) return NextResponse.json({ error: `Unknown channel "${channel}"` }, { status: 400, headers })
  try {
    const data = await getFunnelIndex({ range: resolveRange(rangeParam, start, end), channel, umbrellas: sp.get('umbrellas') === '1' }, nocache)
    return NextResponse.json(data, { headers })
  } catch (e) {
    console.error('[funnel/index] failed', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...base, 'Access-Control-Allow-Headers': 'Content-Type' } })
}
