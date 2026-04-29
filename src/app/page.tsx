'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  BarChart3,
  DollarSign,
  Gauge,
  PieChart as PieIcon,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  ChevronRight
} from 'lucide-react'
import { Pie, PieChart, ResponsiveContainer, Cell, Tooltip, Legend, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid } from 'recharts'
import { fetchFbEnriched, fetchStreakSync, fetchTab, fetchBookings, BookingRecord, StreakLeadRow } from '@/lib/sheetsData'
import { getSheetsUrl } from '@/lib/config'
import { formatCurrency } from '@/lib/utils'
import { AiAsk } from '@/components/overview/AiAsk'

type Zone = 'scale' | 'maintain' | 'optimize' | 'cut'

type MetricCardProps = {
  title: string
  value: string
  subtitle?: string
  icon: React.ReactNode
  accent?: string
  zone?: Zone
  zoneLabel?: string
  target?: string
}

// Goolets CPQL Zone Framework thresholds (from knowledge base)
const CAC_THRESHOLDS = { scale: 96, maintain: 150, optimize: 240 } // €
const ROAS_THRESHOLDS = { cut: 2, optimize: 2.8, maintain: 4 } // x (2.8 = ROMI break-even)
const AI_SCORE_THRESHOLDS = { cut: 40, optimize: 48, maintain: 55 }
const QL_RATE_THRESHOLDS = { cut: 35, optimize: 45, maintain: 55 } // %

function zoneForCac(value: number): Zone {
  if (value === 0) return 'maintain'
  if (value < CAC_THRESHOLDS.scale) return 'scale'
  if (value < CAC_THRESHOLDS.maintain) return 'maintain'
  if (value < CAC_THRESHOLDS.optimize) return 'optimize'
  return 'cut'
}
function zoneForRoas(value: number): Zone {
  if (value >= ROAS_THRESHOLDS.maintain) return 'scale'
  if (value >= ROAS_THRESHOLDS.optimize) return 'maintain'
  if (value >= ROAS_THRESHOLDS.cut) return 'optimize'
  return 'cut'
}
function zoneForAiScore(value: number): Zone {
  if (value >= AI_SCORE_THRESHOLDS.maintain) return 'scale'
  if (value >= AI_SCORE_THRESHOLDS.optimize) return 'maintain'
  if (value >= AI_SCORE_THRESHOLDS.cut) return 'optimize'
  return 'cut'
}
function zoneForQlRate(value: number): Zone {
  if (value >= QL_RATE_THRESHOLDS.maintain) return 'scale'
  if (value >= QL_RATE_THRESHOLDS.optimize) return 'maintain'
  if (value >= QL_RATE_THRESHOLDS.cut) return 'optimize'
  return 'cut'
}

const ZONE_STYLES: Record<Zone, { border: string; bg: string; text: string; label: string }> = {
  scale: { border: '#047857', bg: '#ecfdf5', text: '#047857', label: 'SCALE' },
  maintain: { border: '#B39262', bg: '#fbf6ea', text: '#8B7355', label: 'MAINTAIN' },
  optimize: { border: '#d97706', bg: '#fef3c7', text: '#92400e', label: 'OPTIMIZE' },
  cut: { border: '#dc2626', bg: '#fef2f2', text: '#991b1b', label: 'CUT' }
}

type ChannelMetric = {
  label: string
  value: string
  emphasis?: boolean
}

type ChannelCardProps = {
  title: string
  icon: React.ReactNode
  metrics: ChannelMetric[]
}

type DailyRow = {
  date: string
  cost: number
  clicks: number
  conv: number
  value: number
}

type SummaryData = {
  spend: number
  leads: number
  qualityLeads: number
  avgAi: number
  bookings: number
  revenue: number
  lpViews: number
}

const gold = '#B39262'
const ivory = '#f8f7f2'
const grayBar = '#D1D5DB'
const darkGold = '#8B7355'
const emerald = '#047857'

type Range = '7d' | '30d' | '60d' | '90d' | 'mtd' | 'lastMonth'

export default function HomePage() {
  const [range, setRange] = useState<Range>('mtd')
  const [cacMode, setCacMode] = useState<'leads' | 'deals'>('leads')
  const [marketsSort, setMarketsSort] = useState<'revenue' | 'ql' | 'bookings'>('revenue')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [fbEnriched, setFbEnriched] = useState<any[]>([])
  const [googleDaily, setGoogleDaily] = useState<DailyRow[]>([])
  const [streakFb, setStreakFb] = useState<StreakLeadRow[]>([])
  const [streakGoogle, setStreakGoogle] = useState<StreakLeadRow[]>([])
  const [aiBullets, setAiBullets] = useState<string[]>([])
  const [prefill, setPrefill] = useState('')
  const [apiTotals, setApiTotals] = useState<any>(null)

  const dateBounds = useMemo(() => computeDateBounds(range), [range])
  const days = useMemo(() => {
    const ms = dateBounds.end.getTime() - dateBounds.start.getTime()
    return Math.max(1, Math.round(ms / 86_400_000) + 1)
  }, [dateBounds])

  // Fetch combined totals from API when range changes
  useEffect(() => {
    const startISO = dateBounds.start.toISOString().slice(0, 10)
    const endISO = dateBounds.end.toISOString().slice(0, 10)
    fetch(`/api/dashboard-totals?start=${startISO}&end=${endISO}`)
      .then((res) => res.json())
      .then((data) => setApiTotals(data))
      .catch((e) => console.error('API totals fetch failed', e))
  }, [dateBounds])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const sheetUrl = getSheetsUrl()
        const [{ headers: dailyHeaders, rows: dailyRows }, fbRows, streakAll, bookingRows] =
          await Promise.all([
            fetchTab('daily', sheetUrl),
            fetchFbEnriched(fetchFbEnrichedSheet, sheetUrl),
            fetchStreakSync(fetchFbEnrichedSheet, sheetUrl),
            fetchBookings(fetchFbEnrichedSheet)
          ])

        const fbLeads = (streakAll || []).filter((l) => (l as any).platform === 'facebook')
        const googleLeads = (streakAll || []).filter((l) => (l as any).platform === 'google')

        setFbEnriched(fbRows || [])
        setStreakFb(fbLeads || [])
        setStreakGoogle(googleLeads || [])
        setBookings(bookingRows || [])
        setGoogleDaily(mapDailyRows(dailyHeaders, dailyRows))
      } catch (e) {
        console.error('Failed to load overview data', e)
        setError('Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [days])

  const fetchFbEnrichedSheet = async ({ sheetUrl, tab }: { sheetUrl: string; tab: string }) => {
    return fetchTab(tab, sheetUrl).then((res) => [res.headers, ...res.rows])
  }

  const monthRangeLabel = useMemo(() => {
    const { start, end } = dateBounds
    const fmt = (d: Date) => d.toLocaleString('default', { month: 'short', year: 'numeric' })
    if (range === 'mtd' || range === 'lastMonth') return fmt(start)
    return `${fmt(start)} - ${fmt(end)}`
  }, [dateBounds, range])

  const monthsInRange = useMemo(() => getMonthsInRange(range), [range])

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const dateStr = String(b.booking_date || '')
      let bookingMonth: string
      if (dateStr.includes('T')) {
        const date = new Date(dateStr)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        bookingMonth = `${year}-${month}`
      } else {
        bookingMonth = dateStr.substring(0, 7)
      }
      return monthsInRange.includes(bookingMonth)
    })
  }, [bookings, monthsInRange])

  const revenueTotals = useMemo(() => {
    const totalRevenue = filteredBookings.reduce((sum, b) => sum + (b.rvc || 0), 0)
    const deals = filteredBookings.length
    const avgDeal = deals > 0 ? totalRevenue / deals : 0
    return { totalRevenue, deals, avgDeal }
  }, [filteredBookings])

  const streakAll = useMemo(() => [...streakFb, ...streakGoogle], [streakFb, streakGoogle])

  const leadsFiltered = useMemo(() => {
    const { start, end } = dateBounds
    return streakAll.filter((l) => {
      if (!l.inquiry_date) return false
      const d = new Date(l.inquiry_date)
      return d >= start && d <= end
    })
  }, [streakAll, dateBounds])

  const leadsFbFiltered = useMemo(() => leadsFiltered.filter((l) => l.platform?.toLowerCase().includes('facebook')), [leadsFiltered])
  const leadsGoogleFiltered = useMemo(() => leadsFiltered.filter((l) => l.platform?.toLowerCase().includes('google')), [leadsFiltered])

  const qualityCount = (list: StreakLeadRow[]) => list.filter((l) => l.ai_score >= 50).length
  const avgAiScore = (list: StreakLeadRow[]) => {
    const scores = list.map((l) => l.ai_score).filter((s) => s > 0)
    if (!scores.length) return 0
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
  }

  const fbEnrichedFiltered = useMemo(() => {
    const { start, end } = dateBounds
    return fbEnriched.filter((r: any) => {
      const d = new Date(r.date_iso || r.date_start)
      return r.date_iso && d >= start && d <= end
    })
  }, [fbEnriched, dateBounds])

  const googleDailyFiltered = useMemo(() => {
    const { start, end } = dateBounds
    return googleDaily.filter((r) => {
      const d = new Date(r.date)
      return d >= start && d <= end
    })
  }, [googleDaily, dateBounds])

  const fbSpend = useMemo(
    () => fbEnrichedFiltered.reduce((sum, r: any) => sum + (r.spend || 0), 0),
    [fbEnrichedFiltered]
  )
  const fbLeads = useMemo(
    () => fbEnrichedFiltered.reduce((sum, r: any) => sum + (r.fb_form_leads || 0) + (r.landing_leads || 0), 0),
    [fbEnrichedFiltered]
  )
  const fbLpViews = useMemo(
    () => fbEnrichedFiltered.reduce((sum, r: any) => sum + (r.lp_views || 0), 0),
    [fbEnrichedFiltered]
  )
  const googleSpend = useMemo(
    () => googleDailyFiltered.reduce((sum, r) => sum + (r.cost || 0), 0),
    [googleDailyFiltered]
  )
  const googleClicks = useMemo(
    () => googleDailyFiltered.reduce((sum, r) => sum + (r.clicks || 0), 0),
    [googleDailyFiltered]
  )

  const totals: SummaryData = useMemo(() => {
    const totalSpend = apiTotals?.combined?.spend ?? fbSpend + googleSpend
    const totalLeads = apiTotals?.combined?.leads ?? leadsFiltered.length
    const totalQuality = qualityCount(leadsFiltered)
    const avgAi = avgAiScore(leadsFiltered)
    const bookingsCount = filteredBookings.length
    const revenue = revenueTotals.totalRevenue
    const lpViews = fbLpViews + googleClicks
    return { spend: totalSpend, leads: totalLeads, qualityLeads: totalQuality, avgAi, bookings: bookingsCount, revenue, lpViews }
  }, [apiTotals, fbSpend, googleSpend, leadsFiltered, filteredBookings.length, revenueTotals.totalRevenue, fbLpViews, googleClicks])

  const cacValue = useMemo(() => {
    if (cacMode === 'deals') {
      return totals.bookings > 0 ? totals.spend / totals.bookings : 0
    }
    return totals.qualityLeads > 0 ? totals.spend / totals.qualityLeads : 0
  }, [totals, cacMode])

  const roasValue = useMemo(() => (totals.spend > 0 ? totals.revenue / totals.spend : 0), [totals])

  const channelFb = useMemo(() => {
    const quality = qualityCount(leadsFbFiltered)
    const leadsCount = (apiTotals?.fb?.fbFormLeads || 0) + (apiTotals?.fb?.landingLeads || 0)
    const qRate = leadsCount > 0 ? Math.round((quality / leadsCount) * 100) : 0
    const bookingsFb = filteredBookings.filter((b) => b.source.startsWith('fb_'))
    const revenueFb = bookingsFb.reduce((s, b) => s + (b.rvc || 0), 0)
    const spend = apiTotals?.fb?.spend ?? fbSpend
    const roas = spend > 0 ? revenueFb / spend : 0
    const cpql = quality > 0 ? spend / quality : 0
    return {
      spend,
      leads: leadsCount,
      quality,
      qRate,
      cpql,
      bookings: bookingsFb.length,
      revenue: revenueFb,
      roas
    }
  }, [apiTotals, leadsFbFiltered, filteredBookings, fbSpend])

  const channelGoogle = useMemo(() => {
    const quality = qualityCount(leadsGoogleFiltered)
    const leadsCount = apiTotals?.google?.conversions ?? leadsGoogleFiltered.length
    const qRate = leadsCount > 0 ? Math.round((quality / leadsCount) * 100) : 0
    const bookingsGoogle = filteredBookings.filter((b) => b.source === 'google')
    const revenueGoogle = bookingsGoogle.reduce((s, b) => s + (b.rvc || 0), 0)
    const spend = apiTotals?.google?.spend ?? googleSpend
    const roas = spend > 0 ? revenueGoogle / spend : 0
    const cpql = quality > 0 ? spend / quality : 0
    return {
      spend,
      leads: leadsCount,
      quality,
      qRate,
      cpql,
      bookings: bookingsGoogle.length,
      revenue: revenueGoogle,
      roas
    }
  }, [apiTotals, leadsGoogleFiltered, filteredBookings, googleSpend])

  const revenueBySource = useMemo(() => {
    const map: Record<string, number> = { 'FB Landing': 0, 'FB Lead': 0, Google: 0 }
    filteredBookings.forEach((b) => {
      if (b.source === 'fb_landing') map['FB Landing'] += b.rvc || 0
      else if (b.source === 'fb_lead') map['FB Lead'] += b.rvc || 0
      else if (b.source === 'google') map['Google'] += b.rvc || 0
    })
    const totalAll = Object.values(map).reduce((a, b) => a + b, 0)
    const entries = Object.entries(map)
      .map(([name, value]) => ({
        name,
        value,
        pct: totalAll > 0 ? Math.round((value / totalAll) * 100) : 0
      }))
      .filter((item) => item.value > 0)
    return entries
  }, [filteredBookings])

  const qualityByCountry = useMemo(() => {
    const map = new Map<string, number>()
    leadsFiltered
      .filter((l) => l.ai_score >= 50)
      .forEach((l) => {
        const country = normalizeCountry(l.country)
        map.set(country, (map.get(country) || 0) + 1)
      })
    return map
  }, [leadsFiltered])

  const topMarkets = useMemo(() => {
    const map = new Map<string, { revenue: number; bookings: number; ql: number }>()
    filteredBookings.forEach((b) => {
      const key = normalizeCountry(b.client_country)
      const entry = map.get(key) || { revenue: 0, bookings: 0, ql: 0 }
      entry.revenue += b.rvc || 0
      entry.bookings += 1
      map.set(key, entry)
    })
    qualityByCountry.forEach((ql, country) => {
      const entry = map.get(country) || { revenue: 0, bookings: 0, ql: 0 }
      entry.ql += ql
      map.set(country, entry)
    })

    const all = Array.from(map.entries())
      .map(([country, data]) => {
        const closeRate = data.ql > 0 ? (data.bookings / data.ql) * 100 : 0
        return { country, revenue: data.revenue, bookings: data.bookings, qualityLeads: data.ql, closeRate }
      })
      .filter((m) => m.revenue > 0 || m.qualityLeads > 0 || m.bookings > 0)

    const sortKey =
      marketsSort === 'ql' ? (m: typeof all[number]) => m.qualityLeads
      : marketsSort === 'bookings' ? (m: typeof all[number]) => m.bookings
      : (m: typeof all[number]) => m.revenue

    return all.sort((a, b) => sortKey(b) - sortKey(a)).slice(0, 8)
  }, [filteredBookings, qualityByCountry, marketsSort])

  const funnel = useMemo(() => {
    const steps = [
      { label: 'LP Views', value: totals.lpViews },
      { label: 'Leads', value: totals.leads },
      { label: 'Quality Leads', value: totals.qualityLeads },
      { label: 'Bookings', value: totals.bookings },
      { label: 'Revenue', value: totals.revenue }
    ]
    const withRates = steps.map((s, idx) => {
      if (idx === 0) return { ...s, rate: null }
      const prev = steps[idx - 1].value
      const rate = prev > 0 ? Math.round((s.value / prev) * 100) : 0
      return { ...s, rate }
    })
    return withRates
  }, [totals])

  const groupByWeek = useMemo(
    () => days > 7 && range !== 'mtd' && range !== 'lastMonth',
    [days, range]
  )

  const leadTrend = useMemo(() => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)

    const map = new Map<string, { totalLeads: number; qualityLeads: number; avgAi: number; count: number; label: string; bucketEnd: Date }>()
    leadsFiltered.forEach((l) => {
      const d = new Date(l.inquiry_date)
      const key = groupByWeek ? weekKey(d) : d.toISOString().slice(0, 10)
      const label = groupByWeek ? weekLabel(d) : d.toLocaleDateString()
      const bucketStart = new Date(groupByWeek ? weekKey(d) : d.toISOString().slice(0, 10))
      const bucketEnd = new Date(bucketStart)
      bucketEnd.setDate(bucketEnd.getDate() + (groupByWeek ? 6 : 0))
      bucketEnd.setHours(23, 59, 59, 999)
      const entry = map.get(key) || { totalLeads: 0, qualityLeads: 0, avgAi: 0, count: 0, label, bucketEnd }
      entry.totalLeads += 1
      if (l.ai_score >= 50) entry.qualityLeads += 1
      entry.avgAi += l.ai_score || 0
      entry.count += 1
      map.set(key, entry)
    })
    return Array.from(map.values())
      .map((v) => {
        const isPartial = v.bucketEnd.getTime() > today.getTime()
        const rawRate = v.totalLeads > 0 ? (v.qualityLeads / v.totalLeads) * 100 : 0
        return {
          label: v.label,
          totalLeads: v.totalLeads,
          qualityLeads: v.qualityLeads,
          qlRate: isPartial ? null : Math.round(rawRate * 10) / 10,
          qlRateDisplay: Math.round(rawRate * 10) / 10,
          avgAiScore: v.count > 0 ? Math.round((v.avgAi / v.count) * 10) / 10 : 0,
          isPartial
        }
      })
      .sort((a, b) => new Date(a.label).getTime() - new Date(b.label).getTime())
  }, [leadsFiltered, groupByWeek])

  const qlRateDelta = useMemo(() => {
    const completes = leadTrend.filter((p) => !p.isPartial && p.totalLeads > 0)
    if (completes.length < 2) return null
    const last = completes[completes.length - 1].qlRateDisplay
    const prev = completes[completes.length - 2].qlRateDisplay
    return Math.round((last - prev) * 10) / 10
  }, [leadTrend])

  const handleAsk = async (prompt: string) => {
    const startISO = dateBounds.start.toISOString().slice(0, 10)
    const endISO = dateBounds.end.toISOString().slice(0, 10)
    const res = await fetch('/api/insights/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        filters: {
          dateRange: range === 'mtd' || range === 'lastMonth' ? 'custom' : range,
          customStart: startISO,
          customEnd: endISO
        },
        sheetUrl: getSheetsUrl()
      })
    })
    if (!res.ok) throw new Error('Failed to generate insights')
    return res.json()
  }

  // Build the EXACT metrics payload shown on the page so the AI summary never
  // diverges from the KPI cards. All numbers below come from the same memos
  // that render the visible UI — no server-side recomputation.
  const aiMetricsPayload = useMemo(() => ({
    dateRange: rangeLabel(range),
    totalSpend: totals.spend,
    totalLeads: totals.leads,
    totalQualityLeads: totals.qualityLeads,
    avgAiScore: totals.avgAi,
    totalBookings: totals.bookings,
    totalRevenue: totals.revenue,
    overallROAS: roasValue,
    overallCAC: cacValue,
    cacMode,
    facebook: {
      spend: channelFb.spend,
      leads: channelFb.leads,
      qualityLeads: channelFb.quality,
      qlRate: channelFb.qRate,
      cpql: channelFb.cpql,
      bookings: channelFb.bookings,
      revenue: channelFb.revenue,
      roas: channelFb.roas
    },
    google: {
      spend: channelGoogle.spend,
      leads: channelGoogle.leads,
      qualityLeads: channelGoogle.quality,
      qlRate: channelGoogle.qRate,
      cpql: channelGoogle.cpql,
      bookings: channelGoogle.bookings,
      revenue: channelGoogle.revenue,
      roas: channelGoogle.roas
    },
    revenueBySource,
    topMarkets,
    leadTrend,
    funnel
  }), [range, totals, roasValue, cacValue, cacMode, channelFb, channelGoogle, revenueBySource, topMarkets, leadTrend, funnel])

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const startISO = dateBounds.start.toISOString().slice(0, 10)
        const endISO = dateBounds.end.toISOString().slice(0, 10)
        const res = await fetch('/api/insights/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: {
              dateRange: range === 'mtd' || range === 'lastMonth' ? 'custom' : range,
              customStart: startISO,
              customEnd: endISO
            },
            sheetUrl: getSheetsUrl(),
            metrics: aiMetricsPayload
          })
        })
        if (!res.ok) return
        const data = await res.json()
        setAiBullets(Array.isArray(data.bullets) ? data.bullets : [])
      } catch (err) {
        console.error('AI summary load failed', err)
      }
    }
    loadSummary()
  }, [range, dateBounds, aiMetricsPayload])

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-8" style={{ backgroundColor: ivory }}>
        <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="space-y-3">
              <div className="h-3 w-36 rounded bg-[#e1d8c7]/60" />
              <div className="h-10 w-72 rounded bg-[#e1d8c7]/80" />
              <div className="h-3 w-56 rounded bg-[#e1d8c7]/50" />
            </div>
            <div className="flex gap-2">
              {[1,2,3,4,5].map((i) => <div key={i} className="h-9 w-20 rounded-md bg-[#e1d8c7]/60" />)}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="h-44 rounded-xl border border-[#e1d8c7]/60 bg-white/70 lg:col-span-2" />
            <div className="h-44 rounded-xl border border-[#e1d8c7]/60 bg-white/70" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[1,2,3,4,5,6].map((i) => <div key={i} className="h-24 rounded-xl border border-[#e1d8c7]/60 bg-white/70" />)}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="h-64 rounded-xl border border-[#e1d8c7]/60 bg-white/70" />
            <div className="h-64 rounded-xl border border-[#e1d8c7]/60 bg-white/70" />
          </div>
        </div>
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 text-center">
          <p className="font-script text-lg text-[#B39262]">Preparing your insights…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: ivory }}>
      <div className="sticky top-16 z-30 border-b border-[#e1d8c7]/60 bg-[#f8f7f2]/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#B39262] mb-2">Command Center</p>
            <h1 className="font-serif text-3xl md:text-4xl font-medium text-foreground tracking-tight leading-tight">
              Cross-channel performance
            </h1>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-px w-8 bg-[#B39262]" />
              <p className="text-sm text-muted-foreground">
                Paid marketing intelligence · {monthRangeLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap md:pt-1">
            {([
              { key: '7d', label: '7 Days' },
              { key: '30d', label: '30 Days' },
              { key: '60d', label: '60 Days' },
              { key: '90d', label: '90 Days' },
              { key: 'mtd', label: 'This Month' },
              { key: 'lastMonth', label: 'Last Month' }
            ] as const).map((option) => (
              <Button
                key={option.key}
                variant={option.key === range ? 'default' : 'outline'}
                onClick={() => setRange(option.key)}
                className={
                  option.key === range
                    ? 'bg-[#B39262] text-white hover:bg-[#9c7f54]'
                    : 'border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]'
                }
              >
                {option.label}
              </Button>
            ))}
            <Button
              variant="outline"
              size="icon"
              className="border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]"
              aria-label="Refresh data"
              onClick={() => setRange(range)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5 lg:col-span-2">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Live Revenue
              </div>
              <p className="text-xs tracking-[0.2em] text-gray-500">{monthRangeLabel}</p>
              <p className="text-xs tracking-[0.2em] text-gray-500">TOTAL REVENUE WON</p>
              <div className="text-4xl font-semibold" style={{ color: gold }}>
                {formatCurrency(revenueTotals.totalRevenue, 'EUR')}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
                <span className="flex items-center gap-1 text-green-700">
                  ✅ <span>{revenueTotals.deals} deals closed</span>
                </span>
                <span className="h-4 w-px bg-gray-200" />
                <span>Avg {formatCurrency(revenueTotals.avgDeal, 'EUR')} per deal</span>
              </div>
                </CardContent>
            </Card>

          <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-[#B39262]" />
                  <div>
                    <p className="text-sm font-semibold">AI Executive Summary</p>
                    <p className="text-xs text-muted-foreground">Key insights for today</p>
                  </div>
                            </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]"
                  onClick={() => setRange(range)}
                >
                  Refresh
                                </Button>
                            </div>
              <div className="space-y-2 text-sm text-gray-700">
                {aiBullets.length === 0 ? (
                  <p className="text-muted-foreground italic">The executive summary arrives once data settles.</p>
                ) : (
                  aiBullets.map((b, idx) => {
                    const clean = b.replace(/\*\*/g, '')
                    return <p key={idx}>• {clean}</p>
                  })
                )}
              </div>
                        </CardContent>
                    </Card>
                </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard title="Total Spend" value={formatCurrency(totals.spend, 'EUR')} subtitle="All channels" icon={<DollarSign className="h-4 w-4 text-[#B39262]" />} />
          <MetricCard title="Total Leads" value={totals.leads.toLocaleString()} subtitle="All sources" icon={<Users className="h-4 w-4 text-[#B39262]" />} />
          <MetricCard
            title="Quality Leads"
            value={`${totals.qualityLeads.toLocaleString()}${totals.leads > 0 ? ` (${Math.round((totals.qualityLeads / totals.leads) * 100)}%)` : ''}`}
            subtitle="AI ≥ 50"
            icon={<Sparkles className="h-4 w-4 text-[#B39262]" />}
            zone={totals.leads > 0 ? zoneForQlRate((totals.qualityLeads / totals.leads) * 100) : undefined}
            target=">45% of leads"
          />
          <MetricCard
            title="Avg AI Score"
            value={totals.avgAi.toFixed(1)}
            subtitle="avg score"
            icon={<Gauge className="h-4 w-4 text-[#B39262]" />}
            zone={totals.leads > 0 ? zoneForAiScore(totals.avgAi) : undefined}
            target="≥50 (QL threshold)"
          />
          <MetricCard
            title={cacMode === 'deals' ? 'CAC' : 'CPQL'}
            value={formatCurrency(cacValue, 'EUR')}
            subtitle={cacMode === 'deals' ? 'spend / booking' : 'spend / quality lead'}
            icon={<Target className="h-4 w-4 text-[#B39262]" />}
            zone={cacMode === 'leads' && cacValue > 0 ? zoneForCac(cacValue) : undefined}
            target={cacMode === 'leads' ? '€96 SCALE · €150 OPTIMIZE · €240 CUT' : undefined}
          />
          <MetricCard
            title="ROAS"
            value={`${roasValue.toFixed(2)}x`}
            subtitle="return on ad spend"
            icon={<BarChart3 className="h-4 w-4 text-[#34a853]" />}
            accent="#34a853"
            zone={totals.spend > 0 ? zoneForRoas(roasValue) : undefined}
            target="ROMI break-even 2.8x"
          />
            </div>

        <div className="flex flex-wrap gap-2">
          <Button variant={cacMode === 'leads' ? 'default' : 'outline'} size="sm" onClick={() => setCacMode('leads')}>
            CAC by Leads
          </Button>
          <Button variant={cacMode === 'deals' ? 'default' : 'outline'} size="sm" onClick={() => setCacMode('deals')}>
            CAC by Deals
                            </Button>
                        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChannelCard
            title="Facebook Ads"
            icon={<span className="text-[#1877F2]">ⓕ</span>}
            metrics={[
              { label: 'Spend', value: formatCurrency(channelFb.spend, 'EUR') },
              { label: 'Leads', value: channelFb.leads.toLocaleString() },
              { label: 'Quality Leads', value: `${channelFb.quality.toLocaleString()} (${channelFb.qRate}%)` },
              { label: 'CPQL', value: formatCurrency(channelFb.cpql, 'EUR') },
              { label: 'Bookings', value: channelFb.bookings.toString() },
              { label: 'Revenue', value: formatCurrency(channelFb.revenue, 'EUR') },
              { label: 'ROAS', value: `${channelFb.roas.toFixed(2)}x`, emphasis: true }
            ]}
          />
          <ChannelCard
            title="Google Ads"
            icon={<span className="text-[#4285F4]">ⓖ</span>}
            metrics={[
              { label: 'Spend', value: formatCurrency(channelGoogle.spend, 'EUR') },
              { label: 'Leads', value: channelGoogle.leads.toLocaleString() },
              { label: 'Quality Leads', value: `${channelGoogle.quality.toLocaleString()} (${channelGoogle.qRate}%)` },
              { label: 'CPQL', value: formatCurrency(channelGoogle.cpql, 'EUR') },
              { label: 'Bookings', value: channelGoogle.bookings.toString() },
              { label: 'Revenue', value: formatCurrency(channelGoogle.revenue, 'EUR') },
              { label: 'ROAS', value: `${channelGoogle.roas.toFixed(2)}x`, emphasis: true }
            ]}
          />
                    </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Revenue by Source</p>
                  <p className="text-xs text-muted-foreground">FB Landing, FB Lead, Google</p>
                </div>
                <PieIcon className="h-4 w-4 text-[#B39262]" />
              </div>
              <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={revenueBySource} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40} paddingAngle={3}>
                      {revenueBySource.map((_, idx) => (
                        <Cell key={idx} fill={[gold, '#D4B896', emerald][idx % 3]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip formatter={(val: any) => formatCurrency(Number(val), 'EUR')} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-sm text-gray-700">
                {revenueBySource.length === 0 && (
                  <div className="py-6 text-center space-y-1">
                    <p className="font-serif text-lg text-foreground">Revenue awaits.</p>
                    <p className="text-sm text-muted-foreground">The chart fills as deals close within this period.</p>
                  </div>
                )}
                {revenueBySource.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <span>{item.name}</span>
                    <span>
                      {formatCurrency(item.value, 'EUR')} ({item.pct}%)
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                  <p className="text-sm font-semibold">Top Markets</p>
                  <p className="text-xs text-muted-foreground">Funnel by country</p>
                            </div>
                <div className="flex gap-1">
                  {([
                    { key: 'revenue', label: 'Revenue' },
                    { key: 'ql', label: 'QL' },
                    { key: 'bookings', label: 'Bookings' }
                  ] as const).map((option) => (
                    <Button
                      key={option.key}
                      variant={option.key === marketsSort ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMarketsSort(option.key)}
                      className={
                        option.key === marketsSort
                          ? 'bg-[#B39262] text-white hover:bg-[#9c7f54] h-7 px-2 text-xs'
                          : 'border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3] h-7 px-2 text-xs'
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                        </div>
              <div className="space-y-3">
                {topMarkets.map((m) => {
                  const sortValue =
                    marketsSort === 'ql' ? m.qualityLeads
                    : marketsSort === 'bookings' ? m.bookings
                    : m.revenue
                  const maxValue =
                    marketsSort === 'ql' ? (topMarkets[0]?.qualityLeads || 1)
                    : marketsSort === 'bookings' ? (topMarkets[0]?.bookings || 1)
                    : (topMarkets[0]?.revenue || 1)
                  const sortLabel =
                    marketsSort === 'ql' ? `${m.qualityLeads.toLocaleString()} QL`
                    : marketsSort === 'bookings' ? `${m.bookings} bookings`
                    : formatCurrency(m.revenue, 'EUR')
                  return (
                  <div key={m.country} className="space-y-1">
                    <div className="grid grid-cols-4 items-center text-sm gap-2">
                      <span>{m.country}</span>
                      <span className="text-gray-900 font-medium">{m.qualityLeads.toLocaleString()} QL</span>
                      <span className="text-gray-900 font-medium">{m.bookings} bookings</span>
                      <span className="text-gray-900 font-medium">{formatCurrency(m.revenue, 'EUR')}</span>
                        </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Close Rate</span>
                      <span>{m.closeRate.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-full rounded bg-[#f2ede3]">
                        <div
                          className="h-2 rounded bg-[#B39262]"
                          style={{
                            width: `${Math.min(100, (sortValue / maxValue) * 100)}%`
                          }}
                        />
                    </div>
                      <span className="text-sm font-semibold">{sortLabel}</span>
                    </div>
                  </div>
                  )
                })}
                {topMarkets.length === 0 && (
                  <div className="py-6 text-center space-y-1">
                    <p className="font-serif text-lg text-foreground">Your next story starts here.</p>
                    <p className="text-sm text-muted-foreground">Awaiting the first booking of this period.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
                </div>

        <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
                <div>
                <p className="text-sm font-semibold">Conversion Funnel</p>
                <p className="text-xs text-muted-foreground">Spend → LP Views → Leads → Quality Leads → Bookings → Revenue</p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between gap-2 overflow-x-auto flex-nowrap">
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{formatCurrencyNoCents(totals.spend, 'EUR')}</div>
                <div className="text-sm text-gray-500">Spend</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {totals.lpViews > 0 ? formatCurrency(totals.spend / totals.lpViews, 'EUR') : '—'}
                </span>
                <span className="text-[11px] text-gray-500">CPC</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{totals.lpViews.toLocaleString()}</div>
                <div className="text-sm text-gray-500">LP Views</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {calcRate(totals.leads, totals.lpViews)}
                </span>
                <span className="text-[11px] text-gray-500">LP→Leads</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{totals.leads.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Leads</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {calcRate(totals.qualityLeads, totals.leads)}
                </span>
                <span className="text-[11px] text-gray-500">Leads→Quality</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{totals.qualityLeads.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Quality Leads</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {calcRate(totals.bookings, totals.qualityLeads)}
                </span>
                <span className="text-[11px] text-gray-500">Quality→Bookings</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{totals.bookings.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Bookings</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {totals.bookings > 0 ? formatCurrencyNoCents(totals.revenue / totals.bookings, 'EUR') : '—'}
                </span>
                <span className="text-[11px] text-gray-500">avg deal</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-[#B39262]">{formatCurrencyNoCents(totals.revenue, 'EUR')}</div>
                <div className="text-sm text-gray-500">Revenue</div>
                <div className="text-xs text-gray-400 mt-1">ROAS {roasValue.toFixed(2)}x</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-semibold">Lead Quality Trend</p>
                <p className="text-xs text-muted-foreground">QL rate over time · volume in background</p>
              </div>
              {qlRateDelta !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{groupByWeek ? 'WoW' : 'DoD'}</span>
                  <span
                    className={
                      'rounded px-2 py-1 text-xs font-semibold ' +
                      (qlRateDelta > 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : qlRateDelta < 0
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-gray-100 text-gray-700')
                    }
                  >
                    {qlRateDelta > 0 ? '↑' : qlRateDelta < 0 ? '↓' : '→'} {Math.abs(qlRateDelta).toFixed(1)}pp
                  </span>
                </div>
              )}
            </div>
            <div className="h-72">
              {leadTrend.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center gap-1">
                  <p className="font-serif text-lg text-foreground">Quality emerges in time.</p>
                  <p className="text-sm text-muted-foreground">Lead trends appear as campaigns fire.</p>
                </div>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart data={leadTrend} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#efe8d8" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <YAxis
                      yAxisId="left"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      width={42}
                    />
                    <YAxis yAxisId="right" orientation="right" hide />
                    <Tooltip
                      formatter={(value: any, name: string, item: any) => {
                        if (name === 'QL Rate') {
                          if (item?.payload?.isPartial) return [`${item.payload.qlRateDisplay}% (partial)`, name]
                          return [`${value}%`, name]
                        }
                        return [value, name]
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="right" dataKey="totalLeads" name="Total Leads" fill={grayBar} fillOpacity={0.45} radius={[3, 3, 0, 0]} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="qlRate"
                      name="QL Rate"
                      stroke={gold}
                      strokeWidth={3}
                      dot={{ fill: gold, r: 4 }}
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">AI Marketing Assistant</p>
                <p className="text-xs text-muted-foreground">Ask about your marketing performance</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Which campaign has best ROI?', 'How can I reduce CAC?', 'Where are we wasting spend?', 'Which market drives quality leads?'].map((qp) => (
                <Button
                  key={qp}
                  variant="outline"
                  size="sm"
                  className="border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]"
                  onClick={() => setPrefill(qp)}
                >
                  {qp}
                </Button>
              ))}
                                                </div>
            <AiAsk onAsk={handleAsk} prefill={prefill} />
                                        </CardContent>
                                    </Card>
                    </div>
                </div>
  )
}

function mapDailyRows(headers: string[], rows: any[][]): DailyRow[] {
  if (!headers?.length || !rows?.length) return []
  const norm = (s: any) => String(s || '').trim().toLowerCase()
  const col = (name: string) => headers.findIndex((h) => norm(h) === name)
  const idx = {
    date: col('date') !== -1 ? col('date') : col('day'),
    cost: col('cost'),
    clicks: col('clicks'),
    conv: col('conv'),
    value: col('value')
  }
  return rows.map((r) => ({
    date: String(r[idx.date] || ''),
    cost: Number(r[idx.cost]) || 0,
    clicks: Number(r[idx.clicks]) || 0,
    conv: Number(r[idx.conv]) || 0,
    value: Number(r[idx.value]) || 0
  }))
}

function weekKey(d: Date) {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1)
  copy.setDate(diff)
  copy.setHours(0, 0, 0, 0)
  return copy.toISOString().slice(0, 10)
}

function weekLabel(d: Date) {
  const start = new Date(weekKey(d))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${start.toLocaleDateString()}`
}

function getMonthsInRange(range: Range): string[] {
  const now = new Date()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  if (range === 'mtd') {
    return [fmt(now)]
  }
  if (range === 'lastMonth') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return [fmt(d)]
  }

  const months: string[] = []
  let numMonths = 1
  if (range === '30d') numMonths = 2
  if (range === '60d') numMonths = 3
  if (range === '90d') numMonths = 4

  for (let i = 0; i < numMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(fmt(d))
  }
  return months
}

function computeDateBounds(range: Range): { start: Date; end: Date } {
  const now = new Date()
  if (range === 'mtd') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }
  if (range === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }
  const days = Number(range.replace('d', ''))
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function rangeLabel(range: Range): string {
  const now = new Date()
  if (range === 'mtd') {
    return `${now.toLocaleString('en-US', { month: 'long', year: 'numeric' })} (MTD)`
  }
  if (range === 'lastMonth') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }
  return `Last ${range.replace('d', ' days')}`
}

function calcRate(numerator: number, denominator: number) {
  if (!denominator || denominator <= 0) return '—'
  const pct = (numerator / denominator) * 100
  return `${pct.toFixed(1)}%`
}

function formatCurrencyNoCents(value: number, currency: 'EUR' | 'USD' = 'EUR') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(value || 0)
}

function normalizeCountry(country: string) {
  const c = (country || '').trim().toLowerCase()
  if (!c) return 'Unknown'
  if (['us', 'usa', 'united states', 'united states of america'].includes(c)) return 'USA'
  if (['uk', 'united kingdom', 'great britain', 'england'].includes(c)) return 'UK'
  if (['uae', 'united arab emirates'].includes(c)) return 'UAE'
  if (c === 'canada' || c === 'ca') return 'Canada'
  if (c === 'australia' || c === 'au') return 'Australia'
  return country.toUpperCase()
}

function MetricCard({ title, value, subtitle, icon, accent, zone, zoneLabel, target }: MetricCardProps) {
  const zoneStyle = zone ? ZONE_STYLES[zone] : null
  return (
    <Card
      className="bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5"
      style={{
        borderColor: zoneStyle?.border || '#e1d8c7',
        borderLeftWidth: zoneStyle ? 3 : 1
      }}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#fbf9f4]" style={{ color: accent || gold }}>
            {icon}
          </div>
        </div>
        <div className="text-2xl font-semibold text-gray-900">{value}</div>
        <div className="flex items-center justify-between gap-2 min-h-[18px]">
          {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : <span />}
          {zoneStyle ? (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
              style={{ backgroundColor: zoneStyle.bg, color: zoneStyle.text }}
              title={target || undefined}
            >
              {zoneLabel || zoneStyle.label}
            </span>
          ) : null}
        </div>
        {target ? <div className="text-[10px] text-muted-foreground">Target: {target}</div> : null}
      </CardContent>
    </Card>
  )
}

function ChannelCard({ title, icon, metrics }: ChannelCardProps) {
  return (
    <Card className="border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md hover:-translate-y-0.5">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fbf9f4] text-lg">{icon}</div>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">Performance overview</p>
                    </div>
                </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-[#e1d8c7] bg-[#fbf9f4] p-3">
              <div className="text-xs text-muted-foreground">{metric.label}</div>
              <div className={`text-sm font-semibold ${metric.emphasis ? 'text-[#1d7a3d]' : 'text-gray-900'}`}>{metric.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
    )
}

