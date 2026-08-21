import { NextResponse } from 'next/server'
import { loadAiTraffic } from '@/lib/ai-traffic'

// Od 21. 8. 2026 bere namenski `ga4_ai_sessions` (~2.000 vrstic) namesto 27 MB
// `ga4_landing_pages` — hladen klic je sekunde, ne minute. maxDuration ostaja visok,
// ker gre za en sam Apps Script fetch in strop nič ne stane.
export const maxDuration = 300
export const fetchCache = 'default-no-store'

// GET /api/ai-traffic?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Promet in leadi iz AI asistentov. Štirje koraki (Sessions → Leads → SQL+ → Opportunity+)
// plus AEO snapshot. Koraki so KUMULATIVNI: HubSpot lifecyclestage pove najdlje doseženo
// fazo, zato "SQL +" šteje SQL, opportunity in customer skupaj. Brez tega bi zaporedni
// prikaz surovih števil izgledal kot rastoč funnel.
//
// Seje in kontakti pokrivajo iste tri domene (goolets.net, croatialuxurygulet.com,
// turkeyluxurygulet.com). `scopeMismatch` je zato null; polje ostaja za primer razhoda.

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 's-maxage=900, stale-while-revalidate',
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') || daysAgo(180)
  const end = searchParams.get('end') || daysAgo(1)

  if (!ISO.test(start) || !ISO.test(end)) {
    return NextResponse.json(
      { error: 'start and end must be YYYY-MM-DD' },
      { status: 400, headers }
    )
  }
  if (start > end) {
    return NextResponse.json({ error: 'start must be <= end' }, { status: 400, headers })
  }

  try {
    const data = await loadAiTraffic({ start, end })
    return NextResponse.json(data, { headers })
  } catch (err) {
    console.error('[ai-traffic] failed', err)
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to build AI traffic' },
      { status: 500, headers }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...headers, 'Access-Control-Allow-Headers': 'Content-Type' },
  })
}
