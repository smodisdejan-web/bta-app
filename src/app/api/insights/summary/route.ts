// src/app/api/insights/summary/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getOpenAI, hasOpenAIKey } from '@/lib/ai'
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
    const { filters, sheetUrl } = await req.json()
    
    if (!filters) {
      return NextResponse.json({ error: 'Missing filters' }, { status: 400 })
    }
    
    const days = filters.dateRange === '7d' ? 7 : filters.dateRange === '30d' ? 30 : filters.dateRange === '60d' ? 60 : 90
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

    const systemPrompt = `You are a senior marketing analyst for Goolets, a luxury yacht charter company. 
Analyze the marketing performance data and provide 3-5 bullet point insights.

Focus on:
1. Revenue and booking performance - what's working, what's not
2. Channel efficiency - Facebook vs Google, where to invest more
3. Lead quality trends - is quality improving or declining
4. Market opportunities - which countries show best potential
5. Cost efficiency - CAC/CPQL changes, budget optimization

Rules:
- Be specific with numbers (e.g., "3.23x vs 1.64x" not "significantly higher")
- Be actionable (e.g., "consider shifting 20% budget to Google" not "Google is performing well")
- Prioritize insights by business impact
- Keep each bullet to 1-2 sentences
- Use € for currency
- This is a luxury business with 3-6 month sales cycles - context matters`

    const userPrompt = `Here is the marketing data for the last ${aiContext.dateRange}:

${JSON.stringify(aiContext, null, 2)}

Provide 3-5 key insights as bullet points. Start each with an emoji that matches the sentiment (📈 positive, 📉 negative, 💡 opportunity, ⚠️ warning).`

    if (!hasOpenAIKey()) {
      return NextResponse.json({
        bullets: [
          'AI insights require OPENAI_API_KEY to be configured.',
          'Please set OPENAI_API_KEY in your environment variables.',
          'Alternatively, review spend, ROAS, and quality lead trends manually.'
        ]
      })
    }

    try {
      const openai = getOpenAI()
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
      const text = completion.choices?.[0]?.message?.content?.trim() || ''
      const bullets = text
        .split('\n')
        .map(line => line.replace(/^[-•*]\s*/, '').trim())
        .filter(line => line.length > 0)
        .slice(0, 5)
      return NextResponse.json({ bullets, context: aiContext })
    } catch (err) {
      console.error('[insights/summary] AI call failed', err)
      return NextResponse.json({
        bullets: [
          'Unable to generate insights. Please try again.',
          'If the issue persists, verify OPENAI_API_KEY and network access.'
        ]
      })
    }
  } catch (err: any) {
    console.error('[insights/summary] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate summary.' },
      { status: 500 }
    )
  }
}



