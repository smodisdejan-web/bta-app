// src/lib/api-router.ts
import type { LLMProvider, LLMResponse, InsightsPayload } from './types'

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
 * Call OpenAI API
 */
async function callOpenAI(prompt: string, context: string): Promise<LLMResponse> {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY
  
  if (!apiKey) {
    return {
      text: '',
      error: 'OpenAI API key not configured.\n\n📝 Setup Instructions:\n1. Get your API key: https://platform.openai.com/api-keys\n2. Add to .env.local: NEXT_PUBLIC_OPENAI_API_KEY=your_key_here\n3. Restart your dev server\n\n💰 Note: OpenAI charges per token. Consider trying Gemini Pro (free tier) first!'
    }
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a data analyst helping to analyze advertising campaign data. Provide clear, actionable insights.'
        },
        {
          role: 'user',
          content: `${context}\n\nUser request: ${prompt}`
        }
      ],
      temperature: 0.7
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ''
  
  const tokenUsage = data.usage ? {
    inputTokens: data.usage.prompt_tokens || 0,
    outputTokens: data.usage.completion_tokens || 0,
    totalTokens: data.usage.total_tokens || 0
  } : undefined

  return { text, tokenUsage }
}

/**
 * Call Anthropic Claude API
 */
async function callClaude(prompt: string, context: string): Promise<LLMResponse> {
  const apiKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY
  
  if (!apiKey) {
    return {
      text: '',
      error: 'Anthropic Claude API key not configured.\n\n📝 Setup Instructions:\n1. Get your API key: https://console.anthropic.com/\n2. Add to .env.local: NEXT_PUBLIC_ANTHROPIC_API_KEY=your_key_here\n3. Restart your dev server\n\n💡 Consider trying Gemini Pro (free tier) if you want to test without costs!'
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${context}\n\nUser request: ${prompt}`
      }]
    })
  })

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.statusText}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text || ''
  
  const tokenUsage = data.usage ? {
    inputTokens: data.usage.input_tokens || 0,
    outputTokens: data.usage.output_tokens || 0,
    totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
  } : undefined

  return { text, tokenUsage }
}

