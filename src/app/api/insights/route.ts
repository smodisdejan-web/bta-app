import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasAnthropicKey } from '@/lib/ai'
import { getGooletsKnowledge } from '@/lib/knowledge'

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

    const knowledge = getGooletsKnowledge()
    const systemPrompt = `You are a senior marketing analyst for Goolets, a luxury yacht charter company.
Return concise, actionable insights in 3-6 bullet points, grounded in the Goolets knowledge base below.
Use € for currency, reference the CPQL Zone Framework and campaign priorities when relevant.

# GOOLETS KNOWLEDGE BASE

${knowledge}`

    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
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
