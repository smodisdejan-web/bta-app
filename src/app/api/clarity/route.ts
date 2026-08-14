/**
 * Clarity behaviour data for a landing page (and the site-level benchmark).
 *
 * Reads the pre-built snapshot rollup — never the Clarity API, which allows only
 * 10 calls per project per day. See src/lib/clarity.ts for the coverage caveat
 * that governs how these numbers may be presented.
 *
 *   GET /api/clarity?path=/some-landing&from=2026-08-01&to=2026-08-14
 *   GET /api/clarity?site=1&from=...&to=...      (benchmark only)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getClarityForLanding,
  getClaritySiteLevel,
  clarityDataWindow,
} from '@/lib/clarity'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const path = searchParams.get('path')
    const siteOnly = searchParams.get('site') === '1'
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!from || !to) {
      return NextResponse.json({ error: 'Missing "from" and "to" (ISO dates).' }, { status: 400 })
    }
    if (!siteOnly && !path) {
      return NextResponse.json({ error: 'Missing "path" (or pass site=1).' }, { status: 400 })
    }

    const window = await clarityDataWindow()
    const site = await getClaritySiteLevel(from, to)
    const landing = siteOnly ? null : await getClarityForLanding(path as string, from, to)

    return NextResponse.json({
      // Snapshots only start the day collection began, so a 90-day range will
      // legitimately hold far less Clarity history than GA4 does. The UI needs
      // this to explain a thin result instead of looking broken.
      dataWindow: window,
      site,
      landing,
    })
  } catch (err: any) {
    console.error('[clarity] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to load Clarity data.' },
      { status: 500 }
    )
  }
}
