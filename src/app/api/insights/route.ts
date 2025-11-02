import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { prompt = '', model = 'openai:gpt-4o-mini' } = await req.json()

    // TODO: route to providers using OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
    // For now return a stub so the UI confirms wiring:
    return NextResponse.json({
      ok: true,
      provider: model.split(':')[0],
      model,
      answer: `Stubbed insight for: "${prompt.slice(0, 140)}"`,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Internal error', details: String(err?.message || err) },
      { status: 500 }
    )
  }
}

