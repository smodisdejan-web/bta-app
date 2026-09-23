// POST /api/cro-tower/ask — "Ask the funnel" on the Web Funnel CRO page.
//
// Body:  { question, period?='month', anchor? }        → { answer, period, range, model }
//        { warm: true, period?, anchor? }               → builds + caches the CroTowerResponse,
//                                                          no model call → { ok, ms, cached }
// Auth:  the httpOnly `cro_unlock` cookie (same-origin fetch from /cro-tower), enforced in
//        middleware.ts and re-checked here. No token in the HTML.
// Limits: 5 questions / minute and 60 / day per IP (per instance), warm-ups 60 / day.
// Facts: the CroTowerResponse of that period, trimmed (lib/cro-tower-ai.ts), Turkey NOT filtered.
import { NextRequest, NextResponse } from 'next/server'
import { buildCroTower, CRO_PERIODS } from '@/lib/cro-tower'
import { ASK_RULES, callCroModel, clientIp, rateLimit, stripEmDashes, trimCroFacts, plainLabel, PER_DAY, PER_MINUTE, WARM_PER_DAY } from '@/lib/cro-tower-ai'
import { CRO_COOKIE, isCroUnlocked } from '@/lib/cro-auth'
import { hasAnthropicKey } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_QUESTION = 400
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } })

  if (!(await isCroUnlocked(req.cookies.get(CRO_COOKIE)?.value))) return json({ error: 'Unauthorized' }, 401)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const warm = body?.warm === true
  const limit = rateLimit(clientIp(req.headers), warm)
  if (!limit.ok) {
    return json(
      { error: warm ? `Rate limit: ${WARM_PER_DAY} warm-ups per day` : limit.scope === 'minute' ? `Rate limit: ${PER_MINUTE} questions per minute` : `Rate limit: ${PER_DAY} questions per day`, retryAfterSeconds: limit.retryAfter },
      429,
      { 'Retry-After': String(limit.retryAfter) }
    )
  }

  const period = String(body?.period || 'month').toLowerCase()
  if (!CRO_PERIODS.includes(period as any)) return json({ error: `Unknown period "${period}"`, periods: CRO_PERIODS }, 400)
  const anchor = body?.anchor ? String(body.anchor) : null
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!warm && (question.length < 1 || question.length > MAX_QUESTION)) {
    return json({ error: `question is required and must be 1-${MAX_QUESTION} characters` }, 400)
  }

  const t0 = Date.now()
  let data
  try {
    data = await buildCroTower({ period, anchor })
  } catch (err) {
    console.error('[cro-tower/ask] facts failed', err)
    return json({ error: (err as Error).message || 'Failed to build the funnel' }, 500)
  }
  if (warm) return json({ ok: true, ms: Date.now() - t0, cached: data.meta.cached })

  if (!hasAnthropicKey()) return json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }, 503)

  const facts = trimCroFacts(data)
  const user = `FACTS (Goolets web funnel, period "${plainLabel(data.meta.range.label)}", ${data.meta.range.from} to ${data.meta.range.to}):\n\n${JSON.stringify(facts)}\n\nQUESTION: ${question}`
  try {
    const out = await callCroModel(ASK_RULES, user)
    return json({
      answer: stripEmDashes(out.text),
      period,
      range: data.meta.range,
      model: out.model,
      ms: Date.now() - t0,
      usage: out.usage,
    })
  } catch (err) {
    console.error('[cro-tower/ask] model call failed', err)
    return json({ error: 'Failed to answer the question', details: `${err}` }, 500)
  }
}
