// src/app/api/insights/summary/route.ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getOverviewMetrics, getDateRange, isDateInRange } from '@/lib/overview-data'
import { OverviewFilters } from '@/lib/overview-types'
import { fetchFbEnriched, fetchSheet, totalsFb } from '@/lib/sheetsData'

export const runtime = 'nodejs'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }) : null

export async function POST(req: NextRequest) {
  try {
    const { filters, sheetUrl } = await req.json()
    
    if (!filters) {
      return NextResponse.json({ error: 'Missing filters' }, { status: 400 })
    }
    
    // Get metrics
    const metrics = await getOverviewMetrics(filters as OverviewFilters, sheetUrl)
    
    // Get enriched FB totals for context
    const enrichedRows = await fetchFbEnriched(fetchSheet, sheetUrl)
    const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
    const prevStart = new Date(start)
    const prevEnd = new Date(end)
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    prevStart.setDate(prevStart.getDate() - daysDiff)
    prevEnd.setDate(prevEnd.getDate() - daysDiff)
    
    const currentEnriched = enrichedRows.filter(row => {
      const dateStr = row.date_iso || row.date_start
      return isDateInRange(dateStr, start, end)
    })
    const prevEnriched = filters.comparePrevious ? enrichedRows.filter(row => {
      const dateStr = row.date_iso || row.date_start
      return isDateInRange(dateStr, prevStart, prevEnd)
    }) : []
    
    const fb = totalsFb(currentEnriched)
    const prevFb = totalsFb(prevEnriched)
    
    // Build context for AI
    const context = `
Marketing Performance Metrics (${filters.dateRange}):

Business Metrics:
- Revenue Won: €${metrics.revenueWon.value.toFixed(2)} ${metrics.revenueWon.deltaPct !== null ? `(${metrics.revenueWon.deltaPct > 0 ? '+' : ''}${metrics.revenueWon.deltaPct.toFixed(1)}% vs previous)` : ''}
- Won Deals: ${metrics.wonDeals.value} ${metrics.wonDeals.deltaPct !== null ? `(${metrics.wonDeals.deltaPct > 0 ? '+' : ''}${metrics.wonDeals.deltaPct.toFixed(1)}% vs previous)` : ''}
- Win Rate: ${metrics.winRate.value.toFixed(1)}% ${metrics.winRate.deltaPct !== null ? `(${metrics.winRate.deltaPct > 0 ? '+' : ''}${metrics.winRate.deltaPct.toFixed(1)}pp vs previous)` : ''}
- Avg Deal Size: €${metrics.avgDealSize.value.toFixed(2)} ${metrics.avgDealSize.deltaPct !== null ? `(${metrics.avgDealSize.deltaPct > 0 ? '+' : ''}${metrics.avgDealSize.deltaPct.toFixed(1)}% vs previous)` : ''}

Acquisition Metrics:
- Spend: €${metrics.spend.value.toFixed(2)} ${metrics.spend.deltaPct !== null ? `(${metrics.spend.deltaPct > 0 ? '+' : ''}${metrics.spend.deltaPct.toFixed(1)}% vs previous)` : ''}
- Leads: ${metrics.leads.value} ${metrics.leads.deltaPct !== null ? `(${metrics.leads.deltaPct > 0 ? '+' : ''}${metrics.leads.deltaPct.toFixed(1)}% vs previous)` : ''}
- CAC: €${metrics.cac.value.toFixed(2)} ${metrics.cac.deltaPct !== null ? `(${metrics.cac.deltaPct > 0 ? '+' : ''}${metrics.cac.deltaPct.toFixed(1)}% vs previous)` : ''}
- ROAS: ${metrics.roas.toFixed(2)}x ${metrics.roas.deltaPct !== null ? `(${metrics.roas.deltaPct > 0 ? '+' : ''}${metrics.roas.deltaPct.toFixed(1)}% vs previous)` : ''}

Facebook summary context: spend: €${fb.spend.toFixed(2)}, clicks: ${fb.clicks}, LP views: ${fb.lp_views}, FB form leads: ${fb.fb_form_leads}, landing leads: ${fb.landing_leads}. ${prevFb.spend > 0 ? `Previous period: spend: €${prevFb.spend.toFixed(2)}, clicks: ${prevFb.clicks}, LP views: ${prevFb.lp_views}, FB form leads: ${prevFb.fb_form_leads}, landing leads: ${prevFb.landing_leads}.` : ''} Compare to previous period deltas if available. Call out notable changes ≥ ±10%.

Funnel:
- LP Views: ${metrics.lpViews.toLocaleString()}
- Leads: ${metrics.leadsCount.toLocaleString()} (${metrics.lpToLeadRate.toFixed(1)}% conversion)
- SQL: ${metrics.sqlCount.toLocaleString()} (${metrics.leadToSqlRate.toFixed(1)}% conversion)
- Deals: ${metrics.dealsCount.toLocaleString()} (${metrics.sqlToDealRate.toFixed(1)}% conversion)
- Revenue: €${metrics.revenueTotal.toFixed(2)}
`
    
    // Generate summary using AI or fallback to rule-based
    if (openai) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: 'You are a marketing analyst. Generate exactly 5 concise bullet points highlighting the most important changes and insights from the marketing performance data. Focus on notable increases/decreases, trends, and actionable insights. Each bullet should be one sentence. Ensure at least one bullet mentions Landing Leads vs FB Form Leads, LP→Lead conversion, or spend efficiency.'
            },
            {
              role: 'user',
              content: `Analyze this marketing performance data and provide 5 key insights:\n\n${context}`
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
        // Fall through to rule-based
      }
    }
    
    // Rule-based fallback
    const bullets: string[] = []
    
    if (metrics.revenueWon.deltaPct !== null && Math.abs(metrics.revenueWon.deltaPct) > 5) {
      bullets.push(
        `Revenue ${metrics.revenueWon.deltaPct > 0 ? 'increased' : 'decreased'} by ${Math.abs(metrics.revenueWon.deltaPct).toFixed(1)}% to €${metrics.revenueWon.value.toFixed(2)}`
      )
    }
    
    if (metrics.cac.deltaPct !== null && Math.abs(metrics.cac.deltaPct) > 10) {
      bullets.push(
        `CAC ${metrics.cac.deltaPct > 0 ? 'increased' : 'decreased'} by ${Math.abs(metrics.cac.deltaPct).toFixed(1)}% to €${metrics.cac.value.toFixed(2)}`
      )
    }
    
    if (metrics.roas.deltaPct !== null && Math.abs(metrics.roas.deltaPct) > 10) {
      bullets.push(
        `ROAS ${metrics.roas.deltaPct > 0 ? 'improved' : 'declined'} by ${Math.abs(metrics.roas.deltaPct).toFixed(1)}% to ${metrics.roas.value.toFixed(2)}x`
      )
    }
    
    if (metrics.winRate.deltaPct !== null && Math.abs(metrics.winRate.deltaPct) > 2) {
      bullets.push(
        `Win Rate ${metrics.winRate.deltaPct > 0 ? 'improved' : 'declined'} by ${Math.abs(metrics.winRate.deltaPct).toFixed(1)} percentage points to ${metrics.winRate.value.toFixed(1)}%`
      )
    }
    
    if (metrics.spend.deltaPct !== null && Math.abs(metrics.spend.deltaPct) > 10) {
      bullets.push(
        `Spend ${metrics.spend.deltaPct > 0 ? 'increased' : 'decreased'} by ${Math.abs(metrics.spend.deltaPct).toFixed(1)}% to €${metrics.spend.value.toFixed(2)}`
      )
    }
    
    // Fill remaining slots with general insights
    while (bullets.length < 5) {
      if (bullets.length === 0) {
        bullets.push(`Total revenue: €${metrics.revenueWon.value.toFixed(2)} from ${metrics.wonDeals.value} won deals`)
      } else if (bullets.length === 1) {
        bullets.push(`Generated ${metrics.leads.value} leads with a CAC of €${metrics.cac.value.toFixed(2)}`)
      } else if (bullets.length === 2) {
        bullets.push(`ROAS of ${metrics.roas.toFixed(2)}x indicates ${metrics.roas > 3 ? 'strong' : metrics.roas > 2 ? 'moderate' : 'weak'} return on ad spend`)
      } else if (bullets.length === 3) {
        bullets.push(`Funnel conversion: ${metrics.lpToLeadRate.toFixed(1)}% LP→Lead, ${metrics.leadToSqlRate.toFixed(1)}% Lead→SQL`)
      } else {
        bullets.push(`Average deal size: €${metrics.avgDealSize.value.toFixed(2)}`)
        break
      }
    }
    
    return NextResponse.json({ bullets: bullets.slice(0, 5) })
  } catch (err: any) {
    console.error('[insights/summary] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate summary.' },
      { status: 500 }
    )
  }
}



