/**
 * Fact sheet and prompt for the per-landing-page report.
 *
 * Lives in lib (not in the route) so the fact sheet can be inspected and tested
 * without spending a model call — the numbers in it are the whole ballgame, and a
 * report built on a wrong fact sheet is worse than no report.
 *
 * The report has four sections, per Tadej's spec: (1) purpose + measurable goal,
 * (2) what works, (3) what does not, (4) improvements. He asked for an overview,
 * not a stats dump — "tukaj naj ne bo nek hardcore stats" — so the prose stays
 * short and the numbers stay in the dashboard around it.
 */

import { getClarityForLanding, getClaritySiteLevel, MIN_RELIABLE_SESSIONS } from '@/lib/clarity'
import { getLpPurpose } from '@/lib/lp-purpose'

export interface IncomingMetrics {
  sessions?: number
  users?: number
  leads?: number
  cvr?: number
  ql?: number
  matched?: number
  ql_rate?: number
  avg_ai_score?: number
  bookings?: number
  revenue?: number
  booking_rate?: number
  top_channel?: string
  top_campaign?: string
  top_form?: string
  channel_breakdown?: Record<string, number>
  /** Site-wide comparison figures, so "good" is relative to this account. */
  site_cvr?: number
  site_ql_rate?: number
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  return typeof v === 'number' ? `${v.toFixed(digits)}%` : 'n/a'
}

function fmtNum(v: number | null | undefined): string {
  return typeof v === 'number' ? v.toLocaleString('en-US') : 'n/a'
}

function fmtEur(v: number | null | undefined): string {
  return typeof v === 'number' ? `€${Math.round(v).toLocaleString('en-US')}` : 'n/a'
}

/** Resolve a goal/guardrail metric to its measured value, or null if unmeasured. */
function actualForMetric(
  metric: 'cvr' | 'ql_rate' | 'bookings' | 'revenue',
  m: IncomingMetrics
): number | null {
  const v =
    metric === 'cvr' ? m.cvr : metric === 'ql_rate' ? m.ql_rate : metric === 'bookings' ? m.bookings : m.revenue
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Everything the model is allowed to reason from, spelled out. Metrics that are
 * absent are labelled "n/a" rather than omitted, because a silently missing line
 * is what tempts a model into filling the gap itself.
 */
export function buildFactSheet(
  path: string,
  from: string,
  to: string,
  m: IncomingMetrics,
  clarity: ReturnType<typeof getClarityForLanding>,
  site: ReturnType<typeof getClaritySiteLevel>
): string {
  const purpose = getLpPurpose(path)

  const lines: string[] = []
  lines.push(`LANDING PAGE: ${path}`)
  lines.push(`DATE RANGE: ${from.slice(0, 10)} to ${to.slice(0, 10)}`)
  lines.push('')

  lines.push('## DECLARED PURPOSE AND GOAL')
  if (purpose) {
    lines.push(`Purpose: ${purpose.purpose}`)
    lines.push(
      `Primary goal: ${purpose.goal.metric.toUpperCase()} target ${purpose.goal.target}${
        purpose.goal.metric === 'cvr' || purpose.goal.metric === 'ql_rate' ? '%' : ''
      }`
    )
    lines.push(`Basis for that target: ${purpose.goal.basis}`)

    // The pass/fail verdict is decided here, in code, and handed over as a fact.
    // Asked to judge it itself the model got it backwards — it called 2.64%
    // against a 3.0% target "meeting the goal" in section 1 and then contradicted
    // itself in section 3. Comparisons are cheap to compute and expensive to get
    // wrong, so they do not go to the model as a question.
    const actual = actualForMetric(purpose.goal.metric, m)
    if (actual === null) {
      lines.push(
        `GOAL STATUS: CANNOT BE ASSESSED — ${purpose.goal.metric.toUpperCase()} is not measured for this range. Say so; do not guess whether the goal was met.`
      )
    } else {
      const met = actual >= purpose.goal.target
      const isPct = purpose.goal.metric === 'cvr' || purpose.goal.metric === 'ql_rate'
      const unit = isPct ? '%' : ''
      // The gap is supplied rather than left to be derived: the model subtracted
      // it anyway despite being told not to, so handing it over removes the last
      // reason to do arithmetic at all.
      const gap = Math.abs(actual - purpose.goal.target)
      const gapText = isPct
        ? `${gap.toFixed(2)} percentage points`
        : `${gap.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      lines.push(
        `GOAL STATUS: ${met ? 'MET' : 'NOT MET'} — actual ${actual.toFixed(2)}${unit} against target ${purpose.goal.target}${unit}, ` +
          `a gap of ${gapText} ${met ? 'above' : 'below'} target. ` +
          `This verdict and this gap are authoritative: quote them as given, never recompute them, and never contradict them later in the report.`
      )
    }

    for (const g of purpose.guardrails ?? []) {
      const gActual = actualForMetric(g.metric, m)
      const status =
        gActual === null ? 'CANNOT BE ASSESSED' : gActual >= g.min ? 'HELD' : 'BREACHED'
      lines.push(
        `Guardrail: keep ${g.metric.toUpperCase()} at or above ${g.min}% — ${status}` +
          (gActual !== null ? ` (actual ${gActual.toFixed(2)}%)` : '') +
          (g.note ? ` — ${g.note}` : '')
      )
    }
    if (purpose.intendedTraffic) lines.push(`Intended traffic mix: ${purpose.intendedTraffic}`)
    if (purpose.notes) lines.push(`Context: ${purpose.notes}`)
  } else {
    lines.push(
      'NOT DEFINED. No purpose or goal has been declared for this page. You must say so explicitly in section 1 and must NOT invent one.'
    )
  }
  lines.push('')

  lines.push('## FUNNEL PERFORMANCE (GA4 sessions + HubSpot/Streak leads + bookings)')
  lines.push(`Sessions: ${fmtNum(m.sessions)}   Users: ${fmtNum(m.users)}`)
  lines.push(`Leads: ${fmtNum(m.leads)}   CVR (leads/sessions): ${fmtPct(m.cvr)}`)
  lines.push(
    `Site-wide CVR for comparison: ${fmtPct(m.site_cvr)} — use this to judge whether this page is strong or weak for this account.`
  )
  lines.push(
    `Qualified leads (AI score >= 50): ${fmtNum(m.ql)} of ${fmtNum(m.matched)} matched in Streak = QL rate ${fmtPct(m.ql_rate, 1)}`
  )
  lines.push(`Site-wide QL rate for comparison: ${fmtPct(m.site_ql_rate, 1)}`)
  lines.push(`Average AI lead score: ${typeof m.avg_ai_score === 'number' ? m.avg_ai_score.toFixed(1) : 'n/a'}`)
  lines.push(
    `Bookings: ${fmtNum(m.bookings)}   Revenue: ${fmtEur(m.revenue)}   Booking rate (bookings/leads): ${fmtPct(m.booking_rate, 2)}`
  )
  lines.push(`Top channel: ${m.top_channel ?? 'n/a'}   Top campaign: ${m.top_campaign ?? 'n/a'}`)
  if (m.channel_breakdown && Object.keys(m.channel_breakdown).length) {
    const mix = Object.entries(m.channel_breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
    lines.push(`Lead channel mix: ${mix}`)
  }
  lines.push(`Form: ${m.top_form ?? 'n/a'}`)
  lines.push('')

  lines.push('## ON-PAGE BEHAVIOUR (Microsoft Clarity)')
  if (clarity.empty) {
    lines.push(
      'No Clarity data for this page in this date range. Say so plainly in section 3 if behaviour matters; do not speculate about scroll or click behaviour.'
    )
  } else {
    lines.push(
      `IMPORTANT SAMPLING CAVEAT: these figures come from a sample covering roughly ${
        clarity.coveragePct ?? '?'
      }% of sessions (${fmtNum(clarity.totalSampledSessions)} sampled sessions over ${clarity.daysCovered} day(s) of snapshots).`
    )
    lines.push(
      'The sample is dominated by paid clicks, so RATES AND AVERAGES below are fair directional signal, but never present them as exact.'
    )
    lines.push(
      'All click figures below are INCIDENCE — the percentage of sessions in which the behaviour occurred at least once — for both this page and the site-wide benchmark, so the two are directly comparable as written. Compare like with like and do not convert between units.'
    )
    for (const d of clarity.devices) {
      const label = d.device === 'PC' ? 'Desktop' : d.device
      const base = `${label}: ${fmtNum(d.sampledSessions)} sampled sessions · avg scroll depth ${
        d.scrollDepth !== null ? `${d.scrollDepth}%` : 'n/a'
      } · avg active time ${d.engagementTime !== null ? `${Math.round(d.engagementTime)}s` : 'n/a'}`

      if (!d.reliable) {
        // Withheld rather than shown-and-caveated: a number in the fact sheet
        // gets quoted no matter what warning sits beside it.
        lines.push(
          `${base} · click-behaviour rates WITHHELD because the sample is under ${MIN_RELIABLE_SESSIONS} sessions and would be noise. Do not comment on dead clicks, rage clicks or quick-backs for ${label}.`
        )
        continue
      }

      // Same unit as the site-level block below (% of sessions), so the model can
      // compare the two without converting anything.
      lines.push(
        `${base} · dead clicks in ${fmtPct(d.deadClicksPct, 2)} of sessions · rage clicks ${fmtPct(
          d.rageClicksPct,
          2
        )} · quick-backs ${fmtPct(d.quickbacksPct, 2)} · script errors ${fmtPct(d.scriptErrorsPct, 2)}`
      )
    }
    if (site.devices.length) {
      lines.push('Site-wide behaviour for comparison (complete data, not sampled):')
      for (const d of site.devices) {
        const label = d.device === 'PC' ? 'Desktop' : d.device
        lines.push(
          `${label}: avg scroll depth ${d.scrollDepth !== null ? `${d.scrollDepth}%` : 'n/a'} · avg active time ${
            d.engagementTime !== null ? `${Math.round(d.engagementTime)}s` : 'n/a'
          } · dead clicks in ${fmtPct(d.deadClicksPct, 2)} of sessions · rage clicks ${fmtPct(
            d.rageClicksPct,
            2
          )} · quick-backs ${fmtPct(d.quickbacksPct, 2)} · script errors ${fmtPct(d.scriptErrorsPct, 2)}`
        )
      }
    }
    lines.push(
      'Clarity does not expose first clicks, attention heatmaps or recording analysis through its API, so you have no data on those. Do not comment on them.'
    )
  }

  return lines.join('\n')
}

export const SYSTEM_PROMPT = `You write short landing page reports for Goolets, a luxury yacht charter company, for an internal marketing team.

Write EXACTLY four sections, using these headings verbatim:

## 1. Purpose and goal
State what the page is for and its measurable goal, then whether the current data meets that goal. Quote the actual number against the target. If no purpose has been declared, say "No purpose or goal has been declared for this page" and state what the data shows instead — never invent a purpose or a target.

## 2. What works
Two to four bullets. Each bullet must cite a number from the fact sheet and compare it to the site-wide figure or the stated target so the reader knows why it counts as good.

## 3. What does not work
Two to four bullets, same rule. If a weakness is only visible in the sampled Clarity data, say the word "sample" in that bullet.

## 4. Improvements and suggestions
Two to four concrete, testable actions, ordered by expected impact. Each names what to change and which metric should move. No generic advice such as "improve the copy" or "optimise the funnel" — if you cannot tie an action to a number in the fact sheet, leave it out.

HARD RULES
- Use ONLY numbers that appear verbatim in the fact sheet. Quote them as written.
- DO NO ARITHMETIC. Do not add, subtract, multiply, divide, scale, convert, project or annualise anything. Do not compute a gap between two figures, do not translate a percentage into a count ("X leads per 1,000 sessions"), and do not restate a number at different precision. If the sentence you want needs a number the fact sheet does not contain, write a different sentence. Stating that one figure is above or below another is fine — quantifying the difference is not.
- Never estimate, extrapolate or invent a figure. Two adjacent numbers in the fact sheet are easy to confuse: check each number you write against the line it came from before you use it.
- Targets you suggest must come from the fact sheet. Do not name a target number of your own.
- No multiplier or proportion language: never write "doubles", "triples", "halves", "twice", "X times", "a third of" or similar. Those are arithmetic. Say "above", "below", "well above" and quote both figures instead.
- Compare only like with like. Never set a currency amount against a percentage, a count against a rate, or a scroll depth against a conversion rate. If two figures are not the same kind of quantity, do not put them in the same comparison.
- A figure that is level with its benchmark is not a weakness. Section 3 takes only figures that are actually worse than the benchmark or the target; if a metric is in line, leave it out rather than reading friction into it.
- Claim no trend, trajectory or change over time: the fact sheet covers a single date range and holds no history. Avoid "persistent", "declining", "improving", "increasingly", "still" and the like.
- When a GOAL STATUS line is present it is the verdict. Open section 1 with it, and do not soften, reverse or re-argue it anywhere in the report.
- Keep it an overview, not a statistics dump: no tables, at most one number per clause.
- Say "sample" whenever you lean on Clarity per-page figures, and never quote Clarity raw event counts as totals.
- If a metric is "n/a", either omit it or say it is not measured. Do not guess it.
- Total length under 350 words. Plain markdown, no preamble, no closing summary.
- Write in English (this dashboard is English throughout).`

