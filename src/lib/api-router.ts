// src/lib/api-router.ts
import type { LLMProvider, LLMResponse, InsightsPayload } from './types'
import { DEFAULT_WEB_APP_URL } from './config'

const MAX_RECOMMENDED_INSIGHT_ROWS = 100

/**
 * Generate insights using the specified LLM provider
 */
export async function generateInsightsWithProvider(
  payload: InsightsPayload
): Promise<LLMResponse> {
  try {
    // Limit data to prevent API overload
    const limitedData = payload.data.slice(0, MAX_RECOMMENDED_INSIGHT_ROWS)
    
    // Build context for the AI
    const context = buildInsightContext(payload, limitedData)
    
    // Route to appropriate provider
    switch (payload.provider) {
      case 'gemini-pro':
        return await callGemini(payload.prompt, context)
      case 'gpt-4':
        return await callOpenAI(payload.prompt, context)
      case 'claude-3-sonnet':
        return await callClaude(payload.prompt, context)
      default:
        throw new Error(`Unknown provider: ${payload.provider}`)
    }
  } catch (error) {
    console.error('Error generating insights:', error)
    return {
      text: '',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

/**
 * Build context string for AI analysis
 */
function buildInsightContext(payload: InsightsPayload, data: any[]): string {
  const filterDesc = payload.filters.length > 0
    ? `\nFilters applied: ${payload.filters.map(f => `${f.column} ${f.operator} ${f.value}`).join(', ')}`
    : '\nNo filters applied.'
  
  const dataDesc = `Data source: ${payload.dataSource}
Total rows in original dataset: ${payload.totalRowsOriginal}
Rows being analyzed: ${data.length}${filterDesc}
Currency: ${payload.currency}

Data sample (first ${Math.min(10, data.length)} rows):
${JSON.stringify(data.slice(0, 10), null, 2)}`

  return dataDesc
}

/**
 * Call Google Gemini API
 */
async function callGemini(prompt: string, context: string): Promise<LLMResponse> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
  
  if (!apiKey) {
    return {
      text: '',
      error: 'Gemini API key not configured.\n\n📝 Setup Instructions:\n1. Get a free API key: https://makersuite.google.com/app/apikey\n2. Add to .env.local: NEXT_PUBLIC_GEMINI_API_KEY=your_key_here\n3. Restart your dev server\n\n💡 Gemini offers a generous free tier - perfect for getting started!'
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${context}\n\nUser request: ${prompt}`
          }]
        }]
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  
  // Extract token usage if available
  const tokenUsage = data.usageMetadata ? {
    inputTokens: data.usageMetadata.promptTokenCount || 0,
    outputTokens: data.usageMetadata.candidatesTokenCount || 0,
    totalTokens: data.usageMetadata.totalTokenCount || 0
  } : undefined

  return { text, tokenUsage }
}

/**
 * Call OpenAI API — DEPRECATED: routes to Claude Haiku 4.5.
 * Kept for backwards compatibility with the UI's "gpt-4" provider option.
 */
async function callOpenAI(prompt: string, context: string): Promise<LLMResponse> {
  return callClaude(prompt, context)
}

/**
 * Call Anthropic Claude (Haiku 4.5)
 */
async function callClaude(prompt: string, context: string): Promise<LLMResponse> {
  const { getAnthropic, hasAnthropicKey } = await import('@/lib/ai')

  if (!hasAnthropicKey()) {
    return {
      text: '',
      error: 'Anthropic Claude API key not configured.\n\n📝 Setup Instructions:\n1. Get your API key: https://console.anthropic.com/\n2. Add to .env.local: ANTHROPIC_API_KEY=your_key_here\n3. Restart your dev server'
    }
  }

  try {
    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: 'You are a data analyst helping to analyze advertising campaign data. Provide clear, actionable insights.',
      messages: [{ role: 'user', content: `${context}\n\nUser request: ${prompt}` }]
    })

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    const tokenUsage = response.usage ? {
      inputTokens: response.usage.input_tokens || 0,
      outputTokens: response.usage.output_tokens || 0,
      totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
    } : undefined

    return { text, tokenUsage }
  } catch (error: any) {
    return {
      text: '',
      error: error?.message || 'Anthropic API error occurred'
    }
  }
}

// --- BEGIN getSheetData shim for landing-pages ---
export type SheetFetchOptions = {
  sort?: string;
  dir?: 'asc' | 'desc';
  limit?: number;
  search?: string;
};

export async function getSheetData(tab: string, opts: SheetFetchOptions = {}) {
  const params = new URLSearchParams({ tab });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.dir) params.set('dir', opts.dir);
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  if (opts.search) params.set('q', opts.search);

  const url = `${DEFAULT_WEB_APP_URL}?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 60 } as any });
  if (!res.ok) throw new Error(`getSheetData failed: ${res.status} ${res.statusText}`);
  return res.json();
}
// --- END getSheetData shim ---

