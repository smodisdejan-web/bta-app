// GET /api/cro-tower/review?period=&anchor=[&nocache=1] — the "AI funnel review" panel.
//
// One Sonnet 5 call over the trimmed CroTowerResponse of that period, returning 4-6 items typed
// best / weak / leak / econ / do (the demo's review renderer). Reviews only non-null steps.
// Cached in-process for 6 h per period+anchor+data day (one model call per period per day per
// warm instance). Auth: the `cro_unlock` cookie (middleware + re-check here).
import { NextRequest, NextResponse } from 'next/server'
import { buildCroTower, CRO_PERIODS } from '@/lib/cro-tower'
import { REVIEW_RULES, callCroModel, parseReview, trimCroFacts, plainLabel, type ReviewItem } from '@/lib/cro-tower-ai'
import { CRO_COOKIE, isCroUnlocked } from '@/lib/cro-auth'
import { hasAnthropicKey } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 300

const TTL = 6 * 60 * 60 * 1000
type Out = { items: ReviewItem[]; period: string; range: unknown; model: string; generatedAt: string }
const memo = new Map<string, { at: number; data: Out }>()
const inflight = new Map<string, Promise<Out>>()
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })
  if (!(await isCroUnlocked(req.cookies.get(CRO_COOKIE)?.value))) return json({ error: 'Unauthorized' }, 401)

  const sp = new URL(req.url).searchParams
  const period = (sp.get('period') || 'month').toLowerCase()
  if (!CRO_PERIODS.includes(period as any)) return json({ error: `Unknown period "${period}"`, periods: CRO_PERIODS }, 400)
  const anchor = sp.get('anchor') || null
  const nocache = sp.get('nocache') === '1'
  if (!hasAnthropicKey()) return json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }, 503)

  try {
    const data = await buildCroTower({ period, anchor })
    const key = `${period}|${anchor || ''}|${data.meta.yesterday}`
    const hit = memo.get(key)
    if (!nocache && hit && Date.now() - hit.at < TTL) return json({ ...hit.data, cached: true })
    let p = inflight.get(key)
    if (!p) {
      p = (async () => {
        const facts = trimCroFacts(data)
        const user = `FACTS (Goolets web funnel, period "${plainLabel(data.meta.range.label)}", ${data.meta.range.from} to ${data.meta.range.to}):\n\n${JSON.stringify(facts)}\n\nWrite the review now. JSON only.`
        let out = await callCroModel(REVIEW_RULES, user, 6000)
        let items: ReviewItem[]
        try {
          items = parseReview(out.text)
        } catch (e) {
          // One retry: the model occasionally emits a stray double quote inside a string.
          console.warn('[cro-tower/review] unparseable review, retrying once:', (e as Error).message)
          out = await callCroModel(REVIEW_RULES, `${user}\n\nYour previous answer was not valid JSON (${(e as Error).message}). Return valid JSON only, with no double quotes inside string values.`, 6000)
          items = parseReview(out.text)
        }
        return { items, period, range: data.meta.range, model: out.model, generatedAt: new Date().toISOString() }
      })()
      inflight.set(key, p)
    }
    try {
      const out = await p
      memo.set(key, { at: Date.now(), data: out })
      return json({ ...out, cached: false })
    } finally {
      inflight.delete(key)
    }
  } catch (err) {
    console.error('[cro-tower/review] failed', err)
    return json({ error: (err as Error).message || 'Review failed' }, 500)
  }
}
