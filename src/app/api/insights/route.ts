import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasAnthropicKey } from '@/lib/ai'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing "prompt" (string).' }, { status: 400 })
    }
    if (!hasAnthropicKey()) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured on server.' }, { status: 400 })
    }

    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: 'You are a PPC analyst. Return concise, actionable insights tied to Google Ads performance, in 3–6 bullet points.',
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim() || 'No insight generated.'

    return NextResponse.json({ text })
  } catch (err: any) {
    console.error('[insights] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate insights.' },
      { status: 500 }
    )
  }
}
