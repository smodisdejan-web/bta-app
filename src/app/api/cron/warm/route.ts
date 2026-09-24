// src/app/api/cron/warm/route.ts
//
// GET /api/cron/warm[?i=N][&only=1]  —  refill the shared Data Cache, one build per invocation.
//
// WHY (2026-09-24). The CRO tower and the portal funnel read ~64 MB of sheets through Apps Script
// per cold build (40-80 s). code/goolets/warm-cro-tower.sh was meant to pre-build them after the
// daily cache clear, but it only ran on Dejan's Mac and /gm never called it, so every morning the
// first visitor paid the cold build — and on 24.9. three parallel cold builds + the funnel tab hit
// Apps Script's 30-execution limit (HTTP 404, 300 s timeouts). This route runs on Vercel itself.
//
// PLAN. Step i builds ONE thing (a CRO period, a portal funnel range, or an AI review), returns,
// and — unless ?only=1 — schedules step i+1 with after() by calling itself. Sequential on purpose:
// parallel cold builds all read the same sheets and overload Apps Script. Each step stays well
// under the 300 s function limit; the chain as a whole takes 5-10 minutes.
//
// TRIGGERS.
//   - Vercel cron (vercel.json): 03:45 UTC daily = 05:45 CEST / 04:45 CET, after the 05:30
//     Streak sync. Vercel sends `Authorization: Bearer $CRON_SECRET`.
//   - POST /api/cache/clear (end of refresh-mtd.sh / /gm) kicks off step 0 with X-Admin-Token.
//   - By hand: curl -H "X-Admin-Token: …" https://gooletsaiagent.vercel.app/api/cron/warm
//
// AUTH. Bearer CRON_SECRET or X-Admin-Token = CACHE_ADMIN_TOKEN; neither set = 503 (off, not
// open); wrong = 401. Reviews are generated through /api/cro-tower/review with an unlock cookie
// minted from CRO_TOWER_PASSWORD (no password = review steps are skipped, data still warms).

import { NextResponse, after } from 'next/server'
import { getCroTower } from '@/lib/cro-tower-cache'
import { getFunnel, funnelOptsForRange } from '@/lib/funnel-cache'
import { CRO_COOKIE, croCookieValue } from '@/lib/cro-auth'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

type Step =
  | { kind: 'cro'; period: string }
  | { kind: 'funnel'; range: string }
  | { kind: 'review'; period: string }

// Data first (the portal + the tower are usable after ~9 steps), AI reviews last.
export const WARM_PLAN: Step[] = [
  { kind: 'cro', period: 'month' },
  { kind: 'funnel', range: '3m' },
  { kind: 'cro', period: 'week' },
  { kind: 'cro', period: 'm3' },
  { kind: 'cro', period: 'm6' },
  { kind: 'cro', period: 'ytd' },
  { kind: 'funnel', range: 'this_month' },
  { kind: 'funnel', range: 'last_month' },
  { kind: 'funnel', range: 'ytd' },
  { kind: 'review', period: 'month' },
  { kind: 'review', period: 'week' },
  { kind: 'review', period: 'm3' },
  { kind: 'review', period: 'm6' },
  { kind: 'review', period: 'ytd' },
]

const NO_STORE = { 'Cache-Control': 'no-store' }
const label = (s: Step) => (s.kind === 'funnel' ? `funnel ${s.range}` : `${s.kind} ${s.period}`)

function authorized(req: Request): { ok: boolean; status: number; reason?: string } {
  const cron = process.env.CRON_SECRET
  const admin = process.env.CACHE_ADMIN_TOKEN
  if (!cron && !admin) return { ok: false, status: 503, reason: 'CRON_SECRET / CACHE_ADMIN_TOKEN not set — warm-up is disabled' }
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (cron && bearer && bearer === cron) return { ok: true, status: 200 }
  const token = req.headers.get('x-admin-token')
  if (admin && token && token === admin) return { ok: true, status: 200 }
  return { ok: false, status: 401, reason: 'Unauthorized' }
}

function selfOrigin(req: Request): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return prod ? `https://${prod}` : new URL(req.url).origin
}

async function runStep(step: Step, origin: string): Promise<Record<string, unknown>> {
  if (step.kind === 'cro') {
    const d = await getCroTower({ period: step.period, nocache: true })
    return { generatedAt: d.meta.generatedAt }
  }
  if (step.kind === 'funnel') {
    const d = await getFunnel(funnelOptsForRange(step.range), true)
    return { generatedAt: (d as any)?.meta?.generatedAt, range: (d as any)?.meta?.range }
  }
  const pw = process.env.CRO_TOWER_PASSWORD
  if (!pw) return { skipped: 'CRO_TOWER_PASSWORD not set' }
  const cookie = `${CRO_COOKIE}=${await croCookieValue(pw)}`
  const res = await fetch(`${origin}/api/cro-tower/review?period=${encodeURIComponent(step.period)}&nocache=1`, {
    headers: { cookie },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`review ${step.period}: HTTP ${res.status} ${body?.error || ''}`)
  return { generatedAt: body?.generatedAt, items: Array.isArray(body?.items) ? body.items.length : null }
}

export async function GET(req: Request) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status, headers: NO_STORE })

  const sp = new URL(req.url).searchParams
  const i = Math.max(0, parseInt(sp.get('i') || '0', 10) || 0)
  const only = sp.get('only') === '1'
  if (i >= WARM_PLAN.length) return NextResponse.json({ ok: true, done: true, steps: WARM_PLAN.length }, { headers: NO_STORE })

  const step = WARM_PLAN[i]
  const origin = selfOrigin(req)
  const t0 = Date.now()
  let result: Record<string, unknown> = {}
  let error: string | null = null
  try {
    result = await runStep(step, origin)
  } catch (err) {
    error = (err as Error).message || String(err)
    console.error(`[cron/warm] step ${i} ${label(step)} failed`, err)
  }
  const ms = Date.now() - t0
  console.log(`[cron/warm] step ${i + 1}/${WARM_PLAN.length} ${label(step)} ${error ? 'FAILED' : 'ok'} in ${ms} ms`)

  // Next step after this response is sent — a failed step never stops the chain.
  const next = i + 1
  if (!only && next < WARM_PLAN.length) {
    const headers: Record<string, string> = {}
    const a = req.headers.get('authorization')
    const t = req.headers.get('x-admin-token')
    if (a) headers.authorization = a
    if (t) headers['x-admin-token'] = t
    after(async () => {
      try {
        await fetch(`${origin}/api/cron/warm?i=${next}`, { headers, cache: 'no-store' })
      } catch (err) {
        console.error(`[cron/warm] could not schedule step ${next}`, err)
      }
    })
  }

  return NextResponse.json(
    { ok: !error, step: i + 1, of: WARM_PLAN.length, what: label(step), ms, error, ...result, next: !only && next < WARM_PLAN.length ? next : null },
    { headers: NO_STORE }
  )
}
