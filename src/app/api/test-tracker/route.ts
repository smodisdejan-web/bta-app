import { NextResponse } from 'next/server'

import { fetchSheet, fetchTestTracker } from '@/lib/sheetsData'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const tests = await fetchTestTracker(fetchSheet)
    return NextResponse.json(tests)
  } catch (error) {
    console.error('[api/test-tracker] failed', error)
    return NextResponse.json({ error: 'Failed to load test tracker' }, { status: 500 })
  }
}
