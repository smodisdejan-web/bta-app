// src/app/api/insights/summary/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasAnthropicKey } from '@/lib/ai'
import { getGooletsKnowledge } from '@/lib/knowledge'
import { getDateRangeSync as getDateRange } from '@/lib/overview-data'
import { OverviewFilters } from '@/lib/overview-types'
import {
  fetchFbEnriched,
  fetchSheet,
  totalsFb,
  fetchBookings,
  calculateBookingMetrics,
  fetchStreakSync
} from '@/lib/sheetsData'
import { loadFbDashboard } from '@/lib/loaders/fb-dashboard'
import { loadGoogleTraffic } from '@/lib/sheetsData'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { filters, sheetUrl, metrics: clientMetrics } = await req.json()

    if (!filters) {
      return NextResponse.json({ error: 'Missing filters' }, { status: 400 })
    }

    const days = filters.dateRange === '7d' ? 7 : filters.dateRange === '30d' ? 30 : filters.dateRange === '60d' ? 60 : 90

    // Fast path: client passed the exact metrics shown on the page. Use them
    // verbatim so the AI summary can never contradict the KPI cards.
    if (clientMetrics && typeof clientMetrics === 'object') {
      return runAiSummary({ ...clientMetrics, dateRange: `${days} days` })
    }

    // Legacy path: no client metrics — recompute from sheets (kept for
    // backwards compatibility with any external caller).
    const { start, end } = getDateRange(filters.dateRange, filters.customStart, filters.customEnd)
    const sheets = sheetUrl || process.env.NEXT_PUBLIC_SHEETS_URL || ''

    // Bookings & revenue
    const bookings = await fetchBookings(fetchSheet, sheets)
    const startISO = start.toISOString().slice(0, 10)
    const endISO = end.toISOString().slice(0, 10)
    const bookingMetrics = calculateBookingMetrics(bookings, startISO, endISO, 'all')
    const fbBookingMetrics = calculateBookingMetrics(bookings, startISO, endISO, 'fb')
    const googleBookingMetrics = calculateBookingMetrics(bookings, startISO, endISO, 'google')

    // Streak leads (fb + google)
    const streakAll = (await fetchStreakSync(fetchSheet, sheets)) || []
    const streakFb = (streakAll || []).filter((l) => (l as any).platform === 'facebook')
    const streakGoogle = (streakAll || []).filter((l) => (l as any).platform === 'google')
    const allLeads = streakAll.filter((l) => {
      if (!l.inquiry_date) return false
      const d = new Date(l.inquiry_date)
      return d >= start && d <= end
    })
    const fbLeadsFiltered = streakFb.filter((l) => {
      if (!l.inquiry_date) return false
      const d = new Date(l.inquiry_date)
      return d >= start && d <= end
    })
    const googleLeadsFiltered = streakGoogle.filter((l) => {
      if (!l.inquiry_date) return false
      const d = new Date(l.inquiry_date)
      return d >= start && d <= end
    })
    const totalLeads = allLeads.length
    const qualityLeads = allLeads.filter((l) => l.ai_score >= 50).length
    const avgAiScore =
      allLeads.length > 0
        ? Math.round(
            (allLeads.reduce((sum, l) => sum + (l.ai_score || 0), 0) / allLeads.length) * 10
          ) / 10
        : 0
    const fbQualityLeads = fbLeadsFiltered.filter((l) => l.ai_score >= 50).length
    const googleQualityLeads = googleLeadsFiltered.filter((l) => l.ai_score >= 50).length

    // FB / Google spend & leads
    const fbDashboard = await loadFbDashboard().catch(() => null)
    const fbSpend = fbDashboard?.spend ?? 0
    const fbLeadsSummary = fbDashboard?.leads ?? 0
    const googleTraffic = await loadGoogleTraffic(sheets)
    const gaSpend = Object.entries(googleTraffic.gaSpendByDate || {}).reduce((sum, [k, v]) => {
      return k >= startISO && k <= endISO ? sum + (v || 0) : sum
    }, 0)
    const gaLeads = Object.entries(googleTraffic.gaConvByDate || {}).reduce((sum, [k, v]) => {
      return k >= startISO && k <= endISO ? sum + (v || 0) : sum
    }, 0)

    // Top markets by close rate
    const normalizeCountry = (country: string | null | undefined) => {
      if (!country) return 'Unknown'
      const normalized = country.toString().trim().toUpperCase()
      const countryMap: Record<string, string> = {
        'US': 'USA',
        'UNITED STATES': 'USA',
        'AMERICA': 'USA',
        'U.S.': 'USA',
        'U.S.A.': 'USA',
        'GB': 'UK',
        'UNITED KINGDOM': 'UK',
        'GREAT BRITAIN': 'UK',
        'ENGLAND': 'UK',
        'BR': 'BRAZIL',
        'BRASIL': 'BRAZIL',
        'CA': 'CANADA',
        'AU': 'AUSTRALIA',
        'ES': 'SPAIN',
        'ESPAÑA': 'SPAIN',
        'FR': 'FRANCE',
        'MX': 'MEXICO',
        'MÉXICO': 'MEXICO',
        'DE': 'GERMANY',
        'DEUTSCHLAND': 'GERMANY',
        'AR': 'ARGENTINA',
        'PT': 'PORTUGAL',
        'ANTIQUA': 'ANTIGUA'
      }
      return countryMap[normalized] || normalized
    }

    const leadsByCountry: Record<string, { leads: number; ql: number }> = {}
    allLeads.forEach((l) => {
      const c = normalizeCountry((l as any).country)
      if (c === 'Unknown') return
      if (!leadsByCountry[c]) leadsByCountry[c] = { leads: 0, ql: 0 }
      leadsByCountry[c].leads += 1
      if ((l as any).ai_score >= 50) leadsByCountry[c].ql += 1
    })
    const bookingsByCountry: Record<string, { bookings: number; revenue: number }> = {}
    bookings.forEach((b) => {
      const c = normalizeCountry((b as any).client_country)
      if (c === 'Unknown') return
      if (!bookingsByCountry[c]) bookingsByCountry[c] = { bookings: 0, revenue: 0 }
      bookingsByCountry[c].bookings += 1
      bookingsByCountry[c].revenue += b.rvc || 0
    })
    const topMarkets = Array.from(
      new Set([...Object.keys(leadsByCountry), ...Object.keys(bookingsByCountry)])
    )
      .map((c) => {
        const leads = leadsByCountry[c]?.leads || 0
        const ql = leadsByCountry[c]?.ql || 0
        const bookingsCount = bookingsByCountry[c]?.bookings || 0
        const revenue = bookingsByCountry[c]?.revenue || 0
        const closeRate = ql > 0 ? (bookingsCount / ql) * 100 : 0
        return { country: c, leads, ql, bookings: bookingsCount, revenue, closeRate }
      })
      .filter((c) => c.country !== 'Unknown')
      .sort((a, b) => b.closeRate - a.closeRate)
      .slice(0, 6)

    // Weekly trend (last 4-13 weeks depending on range)
    const isDaily = days === 7
    const startOfWeek = (d: Date) => {
      const copy = new Date(d)
      const day = copy.getDay()
      const diff = (day + 6) % 7
      copy.setDate(copy.getDate() - diff)
      copy.setHours(0, 0, 0, 0)
      return copy
    }
    const labelForDate = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const buckets = new Map<
      string,
      { total: number; ql: number; aiSum: number; aiCount: number; start: Date }
    >()
    if (isDaily) {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = labelForDate(d)
        buckets.set(key, { total: 0, ql: 0, aiSum: 0, aiCount: 0, start: new Date(d) })
      }
    } else {
      for (let d = startOfWeek(start); d <= end; d.setDate(d.getDate() + 7)) {
        const key = labelForDate(d)
        buckets.set(key, { total: 0, ql: 0, aiSum: 0, aiCount: 0, start: new Date(d) })
      }
    }
    allLeads.forEach((l) => {
      if (!l.inquiry_date) return
      const d = new Date(l.inquiry_date)
      if (d < start || d > end) return
      const bucketDate = isDaily ? d : startOfWeek(d)
      const key = labelForDate(bucketDate)
      if (!buckets.has(key)) {
        buckets.set(key, { total: 0, ql: 0, aiSum: 0, aiCount: 0, start: bucketDate })
      }
      const b = buckets.get(key)!
      b.total += 1
      if (l.ai_score >= 50) b.ql += 1
      if (l.ai_score > 0) {
        b.aiSum += l.ai_score
        b.aiCount += 1
      }
    })
    const weeklyTrend = Array.from(buckets.values())
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((b) => ({
        week: labelForDate(b.start),
        totalLeads: b.total,
        qlRate: b.total > 0 ? Math.round(((b.ql / b.total) * 100) * 10) / 10 : 0,
        avgAiScore: b.aiCount > 0 ? Math.round((b.aiSum / b.aiCount) * 10) / 10 : 0
      }))

    const aiContext = {
      dateRange: `${days} days`,
      totalSpend: fbSpend + gaSpend,
      totalRevenue: bookingMetrics.totalRevenue,
      totalBookings: bookingMetrics.bookingCount,
      avgDealValue: bookingMetrics.avgDealValue,
      overallROAS: (fbSpend + gaSpend) > 0 ? bookingMetrics.totalRevenue / (fbSpend + gaSpend) : 0,
      facebook: {
        spend: fbSpend,
        leads: fbLeadsSummary || fbLeadsFiltered.length,
        qualityLeads: fbQualityLeads,
        qlRate: fbLeadsFiltered.length > 0 ? (fbQualityLeads / fbLeadsFiltered.length) * 100 : 0,
        bookings: fbBookingMetrics.bookingCount,
        revenue: fbBookingMetrics.totalRevenue,
        roas: fbSpend > 0 ? fbBookingMetrics.totalRevenue / fbSpend : 0,
        cpql: fbQualityLeads > 0 ? fbSpend / fbQualityLeads : 0
      },
      google: {
        spend: gaSpend,
        leads: gaLeads,
        qualityLeads: googleQualityLeads,
        qlRate: gaLeads > 0 ? (googleQualityLeads / gaLeads) * 100 : 0,
        bookings: googleBookingMetrics.bookingCount,
        revenue: googleBookingMetrics.totalRevenue,
        roas: gaSpend > 0 ? googleBookingMetrics.totalRevenue / gaSpend : 0,
        cpql: googleQualityLeads > 0 ? gaSpend / googleQualityLeads : 0
      },
      weeklyTrend,
      topMarkets
    }

    return runAiSummary(aiContext)
  } catch (err: any) {
    console.error('[insights/summary] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate summary.' },
      { status: 500 }
    )
  }
}

async function runAiSummary(aiContext: Record<string, any>) {
  const knowledge = getGooletsKnowledge()
  const systemPrompt = `You are a senior marketing analyst for Goolets, a luxury yacht charter company.
Analyze the marketing performance data and provide 3-5 bullet point insights.

Focus on:
1. Revenue and booking performance - what's working, what's not
2. Channel efficiency - Facebook vs Google, where to invest more
3. Lead quality trends - is quality improving or declining
4. Market opportunities - which countries show best potential
5. Cost efficiency - CAC/CPQL changes, budget optimization

CRITICAL — data integrity rules (violating these destroys user trust):
- Use ONLY the metrics present in the USER payload. Do NOT invent, round, or extrapolate numbers.
- Every number you cite MUST appear in the payload. If a figure (spend, leads, revenue, close rate, ROAS) is not in the payload, do not mention it.
- Do NOT reference a country, campaign, or channel unless it is present in the payload (topMarkets[].country, revenueBySource[].name, or the facebook/google blocks).
- The knowledge base describes strategic priorities (e.g. Australia target market) but does NOT constitute current performance data. Never claim a country is "winning" or "losing" unless the payload's topMarkets entry for that country proves it.
- If the payload shows facebook.spend = 0 and facebook.bookings > 0, that is a DATA GAP, not a campaign insight — flag it as "verify tracking" not as performance.
- When referencing a country, use the exact spelling and capitalization from topMarkets[].country.

Style rules:
- Be specific with numbers (e.g., "3.23x vs 1.64x" not "significantly higher")
- Be actionable — use the CPQL Zone Framework (SCALE/MAINTAIN/OPTIMIZE/CUT) and Campaign Priorities from the knowledge base
- Prioritize insights by business impact (revenue first, then efficiency, then quality trends)
- Keep each bullet to 1-2 sentences
- Use € for currency
- This is a luxury business with 3-6 month sales cycles - context matters

# GOOLETS KNOWLEDGE BASE

${knowledge}`

  const userPrompt = `Here is the marketing data for the last ${aiContext.dateRange}. These numbers are the ground truth — they are the SAME numbers displayed on the user's dashboard right now. Do not contradict them.

${JSON.stringify(aiContext, null, 2)}

Return 3-5 key insights as bullet points — ONE per line, NO preamble, NO header, NO closing remarks. Start each bullet with an emoji that matches the sentiment (📈 positive, 📉 negative, 💡 opportunity, ⚠️ warning) followed by a short bold label, then the insight. Output ONLY the bullets, nothing else.`

  if (!hasAnthropicKey()) {
    return NextResponse.json({
      bullets: [
        'AI insights require ANTHROPIC_API_KEY to be configured.',
        'Please set ANTHROPIC_API_KEY in your environment variables.',
        'Alternatively, review spend, ROAS, and quality lead trends manually.'
      ]
    })
  }

  try {
    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content: userPrompt }]
    })
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
    const bullets = text
      .split('\n')
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 0 && /^[📈📉💡⚠️]/.test(line))
      .slice(0, 5)
    return NextResponse.json({ bullets, context: aiContext })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('[insights/summary] rate limited', err)
      return NextResponse.json({
        bullets: ['Rate limited by Anthropic API. Please try again in a moment.']
      })
    }
    console.error('[insights/summary] AI call failed', err)
    return NextResponse.json({
      bullets: [
        'Unable to generate insights. Please try again.',
        'If the issue persists, verify ANTHROPIC_API_KEY and network access.'
      ]
    })
  }
}



