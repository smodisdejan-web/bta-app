/**
 * Per-landing-page report endpoint.
 *
 * The fact sheet and prompt live in src/lib/lp-report.ts; this route only wires
 * HTTP to them. See that file for what the model is and is not allowed to say.
 *
 *   POST /api/lp-report  { path, from, to, metrics: {...} }
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasAnthropicKey } from '@/lib/ai'
import { getClarityForLanding, getClaritySiteLevel } from '@/lib/clarity'
import { getLpPurpose } from '@/lib/lp-purpose'
import { buildFactSheet, SYSTEM_PROMPT, type IncomingMetrics } from '@/lib/lp-report'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { path, from, to, metrics } = body as {
      path?: string
      from?: string
      to?: string
      metrics?: IncomingMetrics
    }

    if (!path || !from || !to) {
      return NextResponse.json({ error: 'Missing "path", "from" or "to".' }, { status: 400 })
    }
    if (!hasAnthropicKey()) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured on server.' },
        { status: 400 }
      )
    }

    const clarity = getClarityForLanding(path, from, to)
    const site = getClaritySiteLevel(from, to)
    const factSheet = buildFactSheet(path, from, to, metrics ?? {}, clarity, site)

    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1400,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Write the report for this landing page.\n\n${factSheet}`,
        },
      ],
    })

    const text =
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim() || 'No report generated.'

    return NextResponse.json({
      text,
      // Returned so the UI can show what the report was actually based on —
      // a report with no declared purpose reads very differently from one with.
      basis: {
        hasPurpose: Boolean(getLpPurpose(path)),
        clarityEmpty: clarity.empty,
        clarityCoveragePct: clarity.coveragePct,
        claritySampledSessions: clarity.totalSampledSessions,
        clarityDaysCovered: clarity.daysCovered,
      },
    })
  } catch (err: any) {
    console.error('[lp-report] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate report.' },
      { status: 500 }
    )
  }
}
