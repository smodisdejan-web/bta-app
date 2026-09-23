// src/lib/cro-tower-ai.ts
//
// The two AI features of the Web Funnel CRO page: "Ask the funnel" (POST /api/cro-tower/ask)
// and "AI funnel review" (GET /api/cro-tower/review). Both read ONLY the CroTowerResponse of
// the requested period (lib/cro-tower.ts), trimmed to what a reader sees on the page, plus the
// Goolets knowledge base (which includes funnel-glossary.md).
//
// Model and thinking settings are the funnel-ask ones (Sonnet 5, adaptive thinking, medium
// effort). Turkey is NOT filtered here: turkeyluxurygulet.com is one of the four domains Tadej
// asked for.

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic } from './ai'
import { getGooletsKnowledge } from './knowledge'
import type { CroTowerResponse } from './cro-tower'

export const CRO_MODEL = process.env.CRO_TOWER_MODEL || 'claude-sonnet-5'
const THINKING_EFFORT = 'medium' as const

/** Same scrub as /api/insights/funnel-ask: the model writes em dashes whatever the rules say. */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*([,.;:!?])/g, '$1')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
}

// ─── Facts ──────────────────────────────────────────────────────────────────

/** The page's own numbers, minus plumbing (freshness internals, paid-block duplicates). */
export function trimCroFacts(r: CroTowerResponse) {
  return {
    period: r.meta.period,
    periodLabel: r.meta.range.label,
    range: { from: r.meta.range.from, to: r.meta.range.to },
    previousPeriod: r.meta.prevRange ? { label: r.meta.prevRange.label, from: r.meta.prevRange.from, to: r.meta.prevRange.to } : null,
    dataThrough: r.meta.yesterday,
    hero: {
      visitorToQlPct: r.hero.visitorToQlPct,
      visitors: r.hero.visitors,
      qualifiedLeads: r.hero.ql,
      qlToBookingPct: r.hero.qlToBookingPct,
      revenuePerVisitor: r.hero.revenuePerVisitor,
      revenuePerQl: r.hero.revenuePerQl,
      trend: { unit: r.hero.series.unit, points: r.hero.series.points.map((p) => ({ from: p.start, to: p.end, crPct: p.crPct })) },
    },
    paidPerformance: r.strip,
    funnel: {
      steps: r.funnel.steps.map((s) => ({
        step: s.label,
        source: s.source,
        value: s.metric,
        revenue: s.revenue ?? undefined,
        conversionToNextStepPct: s.cvrToNextPct,
        note: s.note,
      })),
      unattributedBookings: r.funnel.unattributedBookings,
    },
    domains: r.domains.rows.map((d) => ({
      domain: d.label,
      kind: d.kind,
      visitors: d.visitors,
      engaged: d.engaged,
      inquiries: d.inquiries,
      qualifiedLeads: d.ql,
      visitorToQlPct: d.crPct,
      bookings: d.bookings,
      revenue: d.revenue,
      formStarts: d.formStarts,
      formSubmits: d.formSubmits,
      flags: d.flags,
    })),
    shipMicroSites: r.domains.ships.slice(0, 12),
    mainDomainsTotal: r.domains.mainTotal,
    channels: r.channels.rows.slice(0, 12).map((c) => ({
      channel: c.label,
      visitors: c.visitors,
      inquiries: c.inquiries,
      qualifiedLeads: c.ql,
      visitorToQlPct: c.crPct,
      spend: c.spend,
      bookings: c.bookings,
      revenue: c.revenue,
      revenuePerInquiry: c.revenuePerInquiry,
      roas: c.roas,
    })),
    channelsTotal: r.channels.total,
    landingPages: r.pages.rows.slice(0, 8),
    landingPagesNote: r.pages.note,
    inquiryFormsExcluded: r.meta.inquiryExclusions,
    matchRates: r.meta.matchRates,
    definitions: r.meta.definitions,
    notes: r.meta.flags,
  }
}

// ─── Rules ──────────────────────────────────────────────────────────────────

const SHARED_RULES = `# THE DATA

You work on the Goolets WEB FUNNEL (CRO tower): Visitors → Engaged → Inquiries → Qualified Leads →
Bookings, by domain, acquisition channel and landing page, for ONE period. The facts JSON in the
user message is everything that is loaded. The glossary above explains Goolets terms; the facts'
"definitions" and "notes" explain how THIS dashboard counts and override the glossary where they
differ (for example: visitors are GA4 sessions on the 4 main domains; inquiries are website form
submissions; qualified leads are CRM leads with AI score of at least 50, ASSET excluded; bookings
here are PAID bookings only, counted in the month they closed).

Each metric is {value, prev, deltaPct}: value is this period, prev the previous period,
deltaPct the % change. null means "no data", never zero.

# RULES

1. LANGUAGE. Answer in the language of the question (Slovenian → Slovenian, English → English).
   Keep domain names, landing page paths and channel names exactly as in the facts.
2. CITE NUMBERS AND THE PERIOD. Every point quotes the concrete numbers it rests on and names the
   row (domain, channel or landing page). Name the period (periodLabel) at least once.
3. RANK EXPLICITLY. Say by which metric you rank ("best visitor to QL rate", "most qualified
   leads"). Ignore rows with fewer than 200 visitors when ranking by a rate, and say so.
4. NULLS. Write "n/a" and say what is missing. Never replace null with 0, never estimate, never
   spread a total over rows. You may divide two facts to get a rate, nothing more.
5. OUTSIDE THE DATA. If the question needs something that is not in the facts (ads, creatives,
   campaigns, costs per page, another period, forecasts, causes), say plainly that there is no
   data for it in the loaded funnel. Do not guess and do not answer from general knowledge.
6. PLAIN LANGUAGE. Never write a JSON field name (visitorToQlPct, deltaPct, crPct, kind,
   no_web_entry, formStarts …) or a raw enum. Say "visitor to qualified lead rate", "change vs
   the previous period", "form starts". The rows "No website entry" and "Unmatched" are qualified
   leads that could not be placed on a website: call them that.
7. STYLE. No em dashes or en dashes, ever: use a comma or a new sentence. € for money. Digits for
   numbers. No emoji. No speculation about causes the facts cannot support. A domain flag like
   "check tagging" may be repeated as a flag, not as a cause.
8. BOOKINGS. Bookings and revenue are paid-channel bookings only; non-paid channels show n/a
   because that data is not loaded, not because they booked nothing. On a week they are n/a.`

export const ASK_RULES = `${SHARED_RULES}

# FORMAT (Ask the funnel)
Bullet points only, 2 to 6 bullets, no intro sentence, no closing summary, no headings, no tables.
Use **double asterisks** around the key numbers.`

export const REVIEW_RULES = `${SHARED_RULES}

# FORMAT (AI funnel review)
Write a short review of this period for a CRO lead. Review ONLY steps and rows whose values are
not null; skip anything null silently. Return ONLY a JSON object, no prose around it, no code
fence:

{"items":[{"type":"best"|"weak"|"leak"|"econ"|"do","label":"<2-4 word heading>","text":"<1-3 sentences>","list":["<optional, only for type do>"]}]}

- 4 to 6 items, in this order where the data allows: best, weak, leak, econ, do.
- best = the strongest domain / channel / landing page by visitor to qualified lead rate (with a
  volume floor); weak = the weakest sizeable one; leak = the funnel step whose conversion lost the
  most, or fell most vs the previous period; econ = paid spend, ROAS, cost per qualified lead
  (skip if null); do = 2 concrete next steps as "list", each tied to a number in the facts.
- Put **double asterisks** around key numbers. Name the period once.`

// ─── Model call ─────────────────────────────────────────────────────────────

export async function callCroModel(system: string, user: string, maxTokens = 4000) {
  const response = await getAnthropic().messages.create({
    model: CRO_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: THINKING_EFFORT },
    system: [
      {
        type: 'text',
        text: `# GOOLETS KNOWLEDGE BASE\n\n${getGooletsKnowledge()}\n\n---\n\n${system}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: user }],
  } as any)
  const text = (response.content as any[])
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text || response.stop_reason === 'max_tokens') {
    console.warn('[cro-tower-ai] stop_reason=%s usage=%s', response.stop_reason, JSON.stringify(response.usage))
  }
  return { text, model: response.model || CRO_MODEL, usage: response.usage }
}

// ─── Review ─────────────────────────────────────────────────────────────────

export type ReviewItem = { type: 'best' | 'weak' | 'leak' | 'econ' | 'do'; label: string; text: string; list?: string[] }
const REVIEW_TYPES = new Set(['best', 'weak', 'leak', 'econ', 'do'])

export function parseReview(text: string): ReviewItem[] {
  const s = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('review: model returned no JSON')
  const parsed = JSON.parse(s.slice(a, b + 1))
  const items: ReviewItem[] = []
  for (const it of Array.isArray(parsed?.items) ? parsed.items : []) {
    const type = String(it?.type ?? '').toLowerCase()
    if (!REVIEW_TYPES.has(type)) continue
    items.push({
      type: type as ReviewItem['type'],
      label: stripEmDashes(String(it?.label ?? '')).slice(0, 60),
      text: stripEmDashes(String(it?.text ?? '')),
      list: Array.isArray(it?.list) ? it.list.map((x: any) => stripEmDashes(String(x))).slice(0, 4) : undefined,
    })
  }
  if (!items.length) throw new Error('review: no usable items')
  return items.slice(0, 6)
}

// ─── Rate limit (per instance, same numbers as funnel-ask) ──────────────────

type Bucket = { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number; warmDayStart: number; warmDayCount: number }
const buckets = new Map<string, Bucket>()
export const PER_MINUTE = 5
export const PER_DAY = 60
export const WARM_PER_DAY = 60
const MINUTE = 60_000
const DAY = 86_400_000

export function rateLimit(ip: string, warm: boolean): { ok: true } | { ok: false; scope: 'minute' | 'day'; retryAfter: number } {
  const now = Date.now()
  let b = buckets.get(ip)
  if (!b) {
    b = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0, warmDayStart: now, warmDayCount: 0 }
    buckets.set(ip, b)
  }
  if (now - b.minuteStart >= MINUTE) { b.minuteStart = now; b.minuteCount = 0 }
  if (now - b.dayStart >= DAY) { b.dayStart = now; b.dayCount = 0 }
  if (now - b.warmDayStart >= DAY) { b.warmDayStart = now; b.warmDayCount = 0 }
  if (warm) {
    if (b.warmDayCount >= WARM_PER_DAY) return { ok: false, scope: 'day', retryAfter: Math.ceil((b.warmDayStart + DAY - now) / 1000) }
    b.warmDayCount++
    return { ok: true }
  }
  if (b.dayCount >= PER_DAY) return { ok: false, scope: 'day', retryAfter: Math.ceil((b.dayStart + DAY - now) / 1000) }
  if (b.minuteCount >= PER_MINUTE) return { ok: false, scope: 'minute', retryAfter: Math.ceil((b.minuteStart + MINUTE - now) / 1000) }
  b.minuteCount++
  b.dayCount++
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.dayStart >= DAY) buckets.delete(k)
  return { ok: true }
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return headers.get('x-real-ip') || 'unknown'
}
