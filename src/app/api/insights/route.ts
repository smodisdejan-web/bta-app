import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }) : null

export async function POST(req: NextRequest) {
  try {
    const { prompt, model } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing "prompt" (string).' }, { status: 400 })
    }
    if (!openai) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured on server.' }, { status: 400 })
    }

    // Extract model ID from provider:model format or use as-is
    let modelId = 'gpt-4o-mini'
    if (model && typeof model === 'string') {
      // Handle provider:model format (e.g., "openai:gpt-4o-mini")
      if (model.includes(':')) {
        modelId = model.split(':')[1]
      } else {
        modelId = model
      }
    }

    const completion = await openai.chat.completions.create({
      model: modelId,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are a PPC analyst. Return concise, actionable insights tied to Google Ads performance, in 3–6 bullet points.' },
        { role: 'user', content: prompt }
      ]
    })

    const text =
      completion.choices?.[0]?.message?.content?.trim() ||
      'No insight generated.'

    return NextResponse.json({ text })
  } catch (err: any) {
    console.error('[insights] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate insights.' },
      { status: 500 }
    )
  }
}

