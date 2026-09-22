// src/app/api/insights/funnel-ask/route.ts
//
// POST /api/insights/funnel-ask
//
// Free-text Q&A over the Business Health Funnel, scoped to exactly the window / umbrella /
// channel the Goolets Content Portal is looking at. Same facts the portal renders, same
// nulls, answered in the language the question was asked in.
//
// Body:   { question, start, end, campaign?='master', channel?='all' }
// Auth:   X-Portal-Token must equal env PORTAL_ASK_TOKEN, and Origin must be the portal
//         (or localhost in dev). This route is under /api/insights, which middleware.ts
//         allowlists as public — the token IS the protection.
// Answer: { answer, facts_used, coverage, model }

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasAnthropicKey } from '@/lib/ai'
import { getGooletsKnowledge } from '@/lib/knowledge'
import { buildFunnelFacts } from '@/lib/funnel-facts'
import { CAMPAIGNS, UMBRELLA_ORDER, type Channel } from '@/lib/business-funnel'

export const runtime = 'nodejs'
// GA4 (32 MB) + fb_ads_raw + HubSpot + Streak on a cold lambda, then a model call on top.
export const maxDuration = 300

const PORTAL_ORIGIN = 'https://goolets-content-portal.vercel.app'
const LOCALHOST = /^http:\/\/localhost(:\d+)?$/
const ISO = /^\d{4}-\d{2}-\d{2}$/
const CHANNELS: Channel[] = ['all', 'meta', 'google', 'bing', 'chatgpt']

const DEFAULT_MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 4000
// claude-sonnet-5 has no thinking BUDGET any more: `{type:'enabled', budget_tokens:N}` is
// rejected with a 400 ("use thinking.type.adaptive and output_config.effort"). Adaptive
// thinking at medium effort is the supported equivalent of "think, but not for ever".
const THINKING_EFFORT = 'medium' as const
const MAX_QUESTION = 400

// ─── CORS ───────────────────────────────────────────────────────────────────

/** Echo the Origin back ONLY when it is allowed; otherwise send no ACAO at all. */
function allowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  if (origin === PORTAL_ORIGIN) return origin
  if (LOCALHOST.test(origin)) return origin
  return null
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Portal-Token',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
  if (origin) h['Access-Control-Allow-Origin'] = origin
  return h
}

// ─── Rate limit ─────────────────────────────────────────────────────────────
// Module-level, so it is PER LAMBDA INSTANCE, not global. On Vercel several warm instances
// can each hold their own counter, so the real ceiling is (instances × limit). Good enough to
// stop a runaway tab or a copy-pasted token; it is not a billing guarantee.

type Bucket = { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number }
const buckets = new Map<string, Bucket>()
const PER_MINUTE = 5
const PER_DAY = 60
const MINUTE = 60_000
const DAY = 86_400_000

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

function rateLimit(ip: string): { ok: true } | { ok: false; scope: 'minute' | 'day'; retryAfter: number } {
  const now = Date.now()
  let b = buckets.get(ip)
  if (!b) {
    b = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 }
    buckets.set(ip, b)
  }
  if (now - b.minuteStart >= MINUTE) {
    b.minuteStart = now
    b.minuteCount = 0
  }
  if (now - b.dayStart >= DAY) {
    b.dayStart = now
    b.dayCount = 0
  }
  if (b.dayCount >= PER_DAY) {
    return { ok: false, scope: 'day', retryAfter: Math.ceil((b.dayStart + DAY - now) / 1000) }
  }
  if (b.minuteCount >= PER_MINUTE) {
    return { ok: false, scope: 'minute', retryAfter: Math.ceil((b.minuteStart + MINUTE - now) / 1000) }
  }
  b.minuteCount += 1
  b.dayCount += 1
  // Keep the map from growing without bound on a long-lived instance.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.dayStart >= DAY) buckets.delete(k)
  }
  return { ok: true }
}

// ─── Answer rules ───────────────────────────────────────────────────────────

const ANSWER_RULES = `# HOW TO ANSWER

You are the analyst behind the Goolets Business Health Funnel. You answer ONE question about
ONE window, umbrella and channel, using ONLY the facts JSON in the user message. The glossary
above (funnel-glossary.md) defines every term; follow it over any industry default.

1. LANGUAGE. Answer in the language the question was written in. Slovenian question, Slovenian
   answer. English question, English answer. Do not translate the data labels (LP paths, ad
   names, campaign names) — keep them exactly as they appear in the facts.
2. FORMAT. Bullet points only. No intro sentence, no closing summary, no headings, no tables.
   Aim for 3 to 6 bullets.
3. CITE THE NUMBERS. Every bullet quotes the concrete numbers it rests on — spend, leads, QL,
   CPQL, bookings, revenue, whichever the claim depends on — and names the row it is talking
   about: the LP path, the ad name, or the campaign / umbrella name. A bullet with no number
   and no row name does not belong in the answer.
4. RANK EXPLICITLY. When you rank or call something best / worst, say by WHICH metric you are
   ranking ("best by CPQL", "most leads", "highest revenue"). If two metrics disagree, say so.
   Platform campaign names live in funnel.campaignSummary[].campaigns on a master view and in
   funnel.campaignMembership.members on an umbrella view — take row names from there.
5. NULLS. Write "n/a" where a value is null and say what is missing. Never replace a null with
   0, never estimate it, never spread a total across rows to fill a gap. Numbers come from the
   facts exactly as given; you may divide two facts to get a rate, nothing more.
6. ADS. Ad metrics are MONTH-granular, so a range that clips a month is answered with the
   whole month. If the question is about ads, creatives or hooks:
   - append coverage.ads.note as the final bullet, in the answer's language, whenever
     coverage.ads.partialMonths, incompleteMonths, missingMonths or uncoveredDays is non-empty;
   - CPQL RANKING IS BLOCKED when coverage.ads.missingMonths is non-empty OR
     coverage.ads.uncoveredDays is greater than 0. That means the ad spend and the leads cover
     different stretches of time, so every CPQL in the facts is arithmetic on mismatched
     periods. In that case your FIRST bullet says CPQL cannot be ranked and names the gap, and
     you rank by spend, CPL, CTR, hook rate or quality rate instead. Check those two fields
     before you write anything about CPQL;
   - when CPQL ranking is not blocked, use only ads with ql of at least 5 and SAY that you
     applied that floor;
   - quote coverage.adQlJoin.matchedShare whenever you cite per-ad QL, because per-ad QL only
     covers that share of the window's Meta leads;
   - the leads in coverage.adQlJoin.unmatchedBySource belong to no single ad. Never spread them
     across ads. When the unmatched pile is material, name its top SOURCE PLACEMENT values as
     the ad-naming worklist.
7. ATTRIBUTION. Mention the LP-table vs funnel attribution difference ONLY if the totals you
   are actually citing differ. Otherwise say nothing about it.
8. TURKEY. Unless the question itself asks about Turkey, treat every Turkey row as if it were
   not in the facts: the "turkey" umbrella, any campaign, ad set, ad, landing page or vessel
   whose name contains Turkey, Turkish, Tosca, Belgin, Esma or La Bella Vita. Do not name them,
   do not rank them, do not use them as a best / worst example, and do not refer to them
   obliquely. Pick the next eligible row instead. This rule outranks "the data says it is the
   best performer".
9. STYLE. No em dashes. Use € for money. Digits for numbers. No emoji. No speculation about
   causes that the facts cannot support.
10. If the facts do not contain what is needed to answer, say that in one bullet and name the
    field that is missing. Do not guess.`

// ─── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const origin = allowedOrigin(req)
  const headers = corsHeaders(origin)
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })

  // 1. Origin
  const rawOrigin = req.headers.get('origin')
  if (rawOrigin && !origin) {
    return json({ error: `Origin "${rawOrigin}" is not allowed` }, 403)
  }

  // 2. Token
  const expected = process.env.PORTAL_ASK_TOKEN
  if (!expected) {
    return json(
      {
        error:
          'PORTAL_ASK_TOKEN is not configured on the server. Set it in the environment before calling /api/insights/funnel-ask.',
      },
      503
    )
  }
  if (req.headers.get('x-portal-token') !== expected) {
    return json({ error: 'Invalid or missing X-Portal-Token' }, 401)
  }

  // 3. Rate limit
  const limit = rateLimit(clientIp(req))
  if (!limit.ok) {
    return NextResponse.json(
      {
        error:
          limit.scope === 'minute'
            ? `Rate limit: ${PER_MINUTE} questions per minute`
            : `Rate limit: ${PER_DAY} questions per day`,
        retryAfterSeconds: limit.retryAfter,
      },
      { status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfter) } }
    )
  }

  // 4. Body
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (question.length < 1 || question.length > MAX_QUESTION) {
    return json({ error: `question is required and must be 1-${MAX_QUESTION} characters` }, 400)
  }

  const start = String(body?.start ?? '').trim()
  const end = String(body?.end ?? '').trim()
  if (!ISO.test(start) || !ISO.test(end)) {
    return json({ error: 'start and end are required, format YYYY-MM-DD' }, 400)
  }
  if (start > end) {
    return json({ error: 'start must be <= end' }, 400)
  }

  const campaign = String(body?.campaign ?? 'master').trim().toLowerCase() || 'master'
  if (campaign !== 'master' && !CAMPAIGNS.some((c) => c.slug === campaign)) {
    return json({ error: `Unknown campaign "${campaign}"`, campaigns: [...UMBRELLA_ORDER] }, 400)
  }

  const channel = (String(body?.channel ?? 'all').trim().toLowerCase() || 'all') as Channel
  if (!CHANNELS.includes(channel)) {
    return json({ error: `Unknown channel "${channel}"`, channels: CHANNELS }, 400)
  }

  if (!hasAnthropicKey()) {
    return json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }, 503)
  }

  // 5. Facts
  let facts
  try {
    facts = await buildFunnelFacts({ start, end, campaign, channel })
  } catch (err) {
    console.error('[insights/funnel-ask] facts failed', err)
    return json({ error: (err as Error)?.message || 'Failed to build funnel facts' }, 500)
  }

  const factsUsed = {
    funnelSteps: facts.funnel.steps.length,
    lpRows: facts.lps.length,
    adRows: facts.ads.length,
    campaignsListed: facts.funnel.campaignSummary
      ? facts.funnel.campaignSummary.reduce((n, u) => n + u.campaigns.length, 0)
      : 0,
  }

  // 6. Model
  // getGooletsKnowledge() already includes funnel-glossary.md (registered in lib/knowledge.ts),
  // so the glossary ships inside the same cached system block as the rest of the knowledge.
  const model = process.env.FUNNEL_ASK_MODEL || DEFAULT_MODEL
  const systemPrompt = `# GOOLETS KNOWLEDGE BASE

${getGooletsKnowledge()}

---

${ANSWER_RULES}`

  const userPrompt = `FACTS (window ${start} to ${end}, umbrella "${facts.coverage.window.campaignName}" [${campaign}], channel "${channel}"):

${JSON.stringify(facts, null, 2)}

QUESTION: ${question}`

  try {
    const response = await getAnthropic().messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // Disabling thinking made answers self-correct mid-bullet ("above the benchmark...
      // actually below it slightly"), because the ranking work was happening in the visible
      // text. Adaptive thinking moves it out of the answer; max_tokens 4000 leaves the answer
      // room so neither has to borrow from the other.
      thinking: { type: 'adaptive' },
      output_config: { effort: THINKING_EFFORT },
      system: [
        {
          type: 'text',
          text: systemPrompt,
          // The system block is identical across every question, so it caches cleanly.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    // A truncated or empty answer is a silent lie to the portal, so it gets logged loudly.
    if (!answer || response.stop_reason === 'max_tokens') {
      console.warn(
        '[insights/funnel-ask] answer stop_reason=%s blocks=%s usage=%s',
        response.stop_reason,
        JSON.stringify(response.content.map((b) => b.type)),
        JSON.stringify(response.usage)
      )
    }

    return json({
      answer,
      facts_used: factsUsed,
      coverage: facts.coverage,
      model: response.model || model,
      usage: {
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        cache_creation_input_tokens: (response.usage as any)?.cache_creation_input_tokens ?? null,
        cache_read_input_tokens: (response.usage as any)?.cache_read_input_tokens ?? null,
      },
    })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[insights/funnel-ask] rate limited by Anthropic', err)
      return json({ error: 'Rate limited by the Anthropic API', details: `${err}` }, 429)
    }
    console.error('[insights/funnel-ask] model call failed', err)
    return json({ error: 'Failed to answer the question', details: `${err}` }, 500)
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowedOrigin(req)) })
}
