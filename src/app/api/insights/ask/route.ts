// src/app/api/insights/ask/route.ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getOverviewMetrics, getCampaignPerformance, getDateRange, isDateInRange } from '@/lib/overview-data'
import { OverviewFilters } from '@/lib/overview-types'
import { fetchFbEnriched, fetchSheet, totalsFb } from '@/lib/sheetsData'

export const runtime = 'nodejs'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }) : null

export async function POST(req: NextRequest) {
  try {
    const { prompt, filters, sheetUrl } = await req.json()
    
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    }
    
    if (!filters) {
      return NextResponse.json({ error: 'Missing filters' }, { status: 400 })
    }
    
    // Get metrics and campaign data
    const [metrics, campaigns] = await Promise.all([
      getOverviewMetrics(filters as OverviewFilters, sheetUrl),
      getCampaignPerformance(filters as OverviewFilters, sheetUrl)
    ])
    
    // Get enriched FB totals for context
    const enrichedRows = await fetchFbEnriched(fetchSheet, sheetUrl)
    const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
    
    const currentEnriched = enrichedRows.filter(row => {
      const dateStr = row.date_iso || row.date_start
      return isDateInRange(dateStr, start, end)
    })
    
    const fb = totalsFb(currentEnriched)
    
    // Build context
    const context = `
Marketing Performance Data (${filters.dateRange}):

Key Metrics:
- Revenue: €${metrics.revenueWon.value.toFixed(2)}
- Won Deals: ${metrics.wonDeals.value}
- Win Rate: ${metrics.winRate.value.toFixed(1)}%
- Spend: €${metrics.spend.value.toFixed(2)}
- Leads: ${metrics.leads.value}
- CAC: €${metrics.cac.value.toFixed(2)}
- ROAS: ${metrics.roas.toFixed(2)}x

Facebook enriched data: spend: €${fb.spend.toFixed(2)}, clicks: ${fb.clicks}, LP views: ${fb.lp_views}, FB form leads: ${fb.fb_form_leads}, landing leads: ${fb.landing_leads}. You can answer questions about the difference between landing leads and FB form leads, LP→Lead conversion rates, and spend efficiency.

Top Campaigns by Revenue:
${campaigns.slice(0, 10).map(c => `- ${c.campaign} (${c.channel}): €${c.revenue.toFixed(2)} revenue, €${c.spend.toFixed(2)} spend, ${c.leads} leads`).join('\n')}
`
    
    // Generate answer using AI or fallback
    if (openai) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: 'You are a marketing analyst. Answer questions about marketing performance data with concise, actionable insights. Provide up to 5 bullet points. You have access to Facebook enriched data including landing leads vs FB form leads, LP views, clicks, and spend. Use this data to answer questions about lead sources, conversion rates, and spend efficiency.'
            },
            {
              role: 'user',
              content: `Context:\n${context}\n\nQuestion: ${prompt}\n\nProvide a concise answer with up to 5 bullet points.`
            }
          ]
        })
        
        const text = completion.choices?.[0]?.message?.content?.trim() || ''
        const bullets = text
          .split('\n')
          .map(line => line.replace(/^[-•*]\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 5)
        
        return NextResponse.json({ bullets })
      } catch (aiError) {
        console.error('AI generation failed, using fallback:', aiError)
        // Fall through to fallback
      }
    }
    
    // Fallback response
    return NextResponse.json({
      bullets: [
        'AI insights require OPENAI_API_KEY to be configured.',
        'Please set OPENAI_API_KEY in your environment variables.',
        'Alternatively, check the metrics above for manual analysis.'
      ]
    })
  } catch (err: any) {
    console.error('[insights/ask] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate insights.' },
      { status: 500 }
    )
  }
}



