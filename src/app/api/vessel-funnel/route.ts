import { NextResponse } from 'next/server'
import { loadVesselFunnel } from '@/lib/vessel-funnel'
import { VESSEL_PROFILES } from '@/lib/vessel-profiles'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const vesselId = searchParams.get('vesselId') || VESSEL_PROFILES[0].id
  const days = Number(searchParams.get('days') || 30)

  try {
    const data = await loadVesselFunnel(vesselId, Number.isFinite(days) ? days : 30)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[vessel-funnel] failed', err)
    return NextResponse.json({ error: 'Failed to load vessel funnel' }, { status: 500 })
  }
}
