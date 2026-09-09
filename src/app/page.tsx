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
import { getSheetsUrl, SHEETS_TABS } from '@/lib/config'
import { formatCurrency } from '@/lib/utils'
import { AiAsk } from '@/components/overview/AiAsk'
import {
  Zone,
  ZONE_STYLES,
  zoneForCac,
  zoneForRoas,
  zoneForAiScore,
  zoneForQlRate
} from '@/lib/zones'

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

type ChannelMetric = {
  label: string
  value: string
  /** Colour source. A Zone paints its own colour, null paints grey (n/a - nothing measured),
   *  undefined leaves the value in plain ink. Never hard-code green here: ROAS used to render
   *  in #1d7a3d whatever it said, so "0.00x" on a dead feed looked like a good month. */
  zone?: Zone | null
}

type ChannelCardProps = {
  title: string
  icon: React.ReactNode
  metrics: ChannelMetric[]
}

type FbSpendApiRow = {
  date: string
  campaign: string
  spend: number
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
  /** Platform-reported leads (Meta forms + landing + Google conversions). Different measuring
   *  system from `leads`/`qualityLeads` (Streak CRM) — never mix the two in one ratio. */
  platformLeads: number
  qualityLeads: number
  avgAi: number
  bookings: number
  revenue: number
  /** null when the Facebook feed does not cover this window — never a half-measured number. */
  lpViews: number | null
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
  const [fbSpendApi, setFbSpendApi] = useState<FbSpendApiRow[]>([])
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
    const startISO = toLocalISODate(dateBounds.start)
    const endISO = toLocalISODate(dateBounds.end)
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
        const [{ headers: dailyHeaders, rows: dailyRows }, fbRows, streakAll, bookingRows, fbApi] =
          await Promise.all([
            fetchTab('daily_api', sheetUrl), // CUTOVER 2026-06-15: Google Ads API (was Mixed Analytics 'daily')
            fetchFbEnriched(fetchFbEnrichedSheet, sheetUrl),
            fetchStreakSync(fetchFbEnrichedSheet, sheetUrl),
            fetchBookings(fetchFbEnrichedSheet),
            // FB spend straight from Meta (code/facebook/sync-fb-ads-api.js). Read on the CLIENT,
            // not via /api/dashboard-totals: that route re-fetches the same Apps Script web app
            // while these four calls are in flight, hits the Apps Script concurrency limit and
            // hangs for minutes, so `apiTotals` stays null and FB spend silently fell back to the
            // dead `fb_ads_enriched` column -> EUR 0 for September. See 2026-09-08 diagnosis.
            fetchTab(SHEETS_TABS.FB_SPEND_DAILY, sheetUrl)
          ])

        const fbLeads = (streakAll || []).filter((l) => (l as any).platform === 'facebook')
        const googleLeads = (streakAll || []).filter((l) => (l as any).platform === 'google')

        setFbEnriched(fbRows || [])
        setStreakFb(fbLeads || [])
        setStreakGoogle(googleLeads || [])
        setBookings(bookingRows || [])
        setGoogleDaily(mapDailyRows(dailyHeaders, dailyRows))
        setFbSpendApi(mapFbSpendApiRows(fbApi?.headers || [], fbApi?.rows || []))
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

  // Bookings honour the SAME day window as spend and leads. They used to be bucketed by whole
  // CALENDAR MONTH (getMonthsInRange: 7d -> 1 month, 30d -> 2, 60d -> 3, 90d -> 4), so "7 Days"
  // priced the whole month's revenue against seven days of spend and printed ROAS 19.33x in a
  // green SCALE badge when the window's true ceiling was ~3.4x. Only This Month and Last Month
  // happened to line up. Compare on LOCAL calendar days, the same basis dateBounds uses.
  // `bookings_api` carries MONTH granularity only -- `booking_date` is "YYYY-MM", both in the
  // sheet and after fetchBookings() truncates it. Comparing that against day keys (the 2026-08-31
  // "day window" rewrite did: "2026-09" >= "2026-09-01" is FALSE in JS, a shorter string sorts
  // before its own prefix extension) silently dropped EVERY booking in EVERY range: Live Revenue
  // read EUR 0.00 / 0 deals / ROAS 0.00x from 31.8. onwards, while September actually held four
  // bookings worth EUR 91,800. Match on the months the window touches instead.
  const windowMonths = useMemo(() => {
    const { start, end } = dateBounds
    const months = new Set<string>()
    const cur = new Date(start.getFullYear(), start.getMonth(), 1)
    const last = new Date(end.getFullYear(), end.getMonth(), 1)
    while (cur <= last) {
      months.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
      cur.setMonth(cur.getMonth() + 1)
    }
    return months
  }, [dateBounds])

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const raw = String(b.booking_date || '')
      if (!raw) return false
      const month = raw.includes('T') ? toLocalISODate(new Date(raw)).slice(0, 7) : raw.slice(0, 7)
      return windowMonths.has(month)
    })
  }, [bookings, windowMonths])

  // A rolling day window (7d/30d/60d/90d) can never be priced against month-level bookings: it
  // would put a whole month of revenue over a few days of spend -- the 19.33x ROAS the 31.8.
  // commit was right to kill. This Month / Last Month ARE whole calendar months, so they are the
  // only ranges where a revenue-over-spend ratio is a real measurement.
  const revenueWindowIsWholeMonth = range === 'mtd' || range === 'lastMonth'

  // Does `bookings_api` actually reach the window we are drawing? The feed is MONTHLY
  // ("YYYY-MM"), so "live" means it carries the last month the window touches. A feed that
  // stops short cannot be told apart from a month that has genuinely closed nothing yet, so
  // it reads n/a - never a green zero. Eight days of "EUR 0,00 / OK 0 deals closed /
  // ROAS 0.00x", all painted green, is exactly what this flag exists to prevent.
  const bookingsFeedState = useMemo<'live' | 'stale' | 'missing'>(() => {
    if (!bookings.length) return 'missing'
    let maxMonth = ''
    for (const b of bookings) {
      const raw = String(b.booking_date || '')
      if (!raw) continue
      const m = raw.includes('T') ? toLocalISODate(new Date(raw)).slice(0, 7) : raw.slice(0, 7)
      if (/^\d{4}-\d{2}$/.test(m) && m > maxMonth) maxMonth = m
    }
    if (!maxMonth) return 'missing'
    const lastWindowMonth = Array.from(windowMonths).sort().pop() || ''
    return maxMonth >= lastWindowMonth ? 'live' : 'stale'
  }, [bookings, windowMonths])

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
  // Authoritative FB spend: `fb_ads_api` (Meta -> sheet, daily). `fb_ads_enriched` is a Mixed
  // Analytics feed frozen since 2026-08-09, so its spend column is 0 for anything after that.
  const fbSpendFromApi = useMemo(() => {
    const startKey = toLocalISODate(dateBounds.start)
    const endKey = toLocalISODate(dateBounds.end)
    let total = 0
    let covered = false
    for (const r of fbSpendApi) {
      if (r.date >= startKey && r.date <= endKey) {
        total += r.spend
        covered = true
      }
    }
    return { total, covered }
  }, [fbSpendApi, dateBounds])
  /** Last day `fb_ads_api` carries — used to say how fresh the FB half of Total Spend is. */
  const fbSpendLastDay = useMemo(() => {
    let max = ''
    for (const r of fbSpendApi) if (r.date > max) max = r.date
    return max
  }, [fbSpendApi])
  const fbLeads = useMemo(
    () => fbEnrichedFiltered.reduce((sum, r: any) => sum + (r.fb_form_leads || 0) + (r.landing_leads || 0), 0),
    [fbEnrichedFiltered]
  )
  const fbLpViews = useMemo(
    () => fbEnrichedFiltered.reduce((sum, r: any) => sum + (r.lp_views || 0), 0),
    [fbEnrichedFiltered]
  )
  // fb_ads_enriched is a Mixed Analytics feed that has been frozen since 2026-08-09. Reading it
  // for a window it does not cover returns a partial sum that LOOKS like a measurement: LP Views
  // showed 32,438 (1-9 Aug only) added to 17,905 Google clicks for all 31 days, and the "7 Days"
  // view returned 0. Detect the gap and render "no data" instead of a number that is 50-60% low.
  const fbEnrichedCoversWindow = useMemo(() => {
    if (!fbEnriched.length) return false
    const { start, end } = dateBounds
    let maxDate = ''
    for (const r of fbEnriched as any[]) {
      const d = String(r.date_iso || r.date_start || '').slice(0, 10)
      if (d && d > maxDate) maxDate = d
    }
    if (!maxDate) return false
    // The feed must reach the end of the window, allowing one day of normal reporting lag.
    const lagDay = new Date(end)
    lagDay.setDate(lagDay.getDate() - 1)
    return maxDate >= toLocalISODate(lagDay)
  }, [fbEnriched, dateBounds])
  const googleSpend = useMemo(
    () => googleDailyFiltered.reduce((sum, r) => sum + (r.cost || 0), 0),
    [googleDailyFiltered]
  )
  const googleClicks = useMemo(
    () => googleDailyFiltered.reduce((sum, r) => sum + (r.clicks || 0), 0),
    [googleDailyFiltered]
  )
  /** Does `daily_api` (Google spend) reach this window? Same one-day lag allowance as FB. */
  const googleFeedCoversWindow = useMemo(() => {
    if (!googleDaily.length) return false
    let maxDate = ''
    for (const r of googleDaily) {
      const d = String(r.date || '').slice(0, 10)
      if (d && d > maxDate) maxDate = d
    }
    if (!maxDate) return false
    const lagDay = new Date(dateBounds.end)
    lagDay.setDate(lagDay.getDate() - 1)
    return maxDate >= toLocalISODate(lagDay)
  }, [googleDaily, dateBounds])

  const totals: SummaryData = useMemo(() => {
    // Spend precedence: fb_ads_api (Meta, daily) > /api/dashboard-totals > fb_ads_enriched.
    // The old line trusted `apiTotals` first and fell all the way back to `fbSpend` (enriched)
    // when that route did not answer. On 2026-09-08 the route hung on the Apps Script
    // concurrency limit, enriched had no September rows, and Total Spend printed EUR 6,029.99
    // (Google only) instead of EUR 20,526.69 -- CPQL EUR 31.41 instead of EUR 106.91.
    const fbSpendFinal = fbSpendFromApi.covered
      ? fbSpendFromApi.total
      : apiTotals?.fb?.spend ?? fbSpend
    const totalSpend = fbSpendFinal + (apiTotals?.google?.spend ?? googleSpend)
    // LEADS = Streak CRM, the same set QL / QL% / CPQL are counted from. The platform-reported
    // count is a different measuring system and is kept separate, never as a QL denominator.
    const totalLeads = leadsFiltered.length
    const platformLeads = apiTotals?.combined?.leads ?? 0
    const totalQuality = qualityCount(leadsFiltered)
    const avgAi = avgAiScore(leadsFiltered)
    const bookingsCount = filteredBookings.length
    const revenue = revenueTotals.totalRevenue
    // null, not 0, when the Facebook half cannot be measured for this window — the funnel and the
    // "CPC" arrow both read this, and a half-measured denominator is worse than an absent one.
    const lpViews = fbEnrichedCoversWindow ? fbLpViews + googleClicks : null
    return { spend: totalSpend, leads: totalLeads, platformLeads, qualityLeads: totalQuality, avgAi, bookings: bookingsCount, revenue, lpViews }
  }, [apiTotals, fbSpend, fbSpendFromApi, googleSpend, leadsFiltered, filteredBookings.length, revenueTotals.totalRevenue, fbLpViews, googleClicks])

  const cacValue = useMemo(() => {
    if (cacMode === 'deals') {
      return totals.bookings > 0 ? totals.spend / totals.bookings : 0
    }
    return totals.qualityLeads > 0 ? totals.spend / totals.qualityLeads : 0
  }, [totals, cacMode])

  const roasValue = useMemo(() => (totals.spend > 0 ? totals.revenue / totals.spend : 0), [totals])
  /** null = not measurable for this window: month-level bookings vs. a rolling day window, no
   *  spend, or a bookings feed that does not reach the window. A dead feed must never be able
   *  to produce "0.00x" - that is a measurement, and there was none. */
  const roasDisplay =
    revenueWindowIsWholeMonth && totals.spend > 0 && bookingsFeedState === 'live' ? roasValue : null

  // Total Spend is a SUM of two feeds. When one of them is dead its zero vanishes into the
  // total and the card still says "All channels" - that is how September printed EUR 6,029.99
  // (Google only) and nothing on screen said the Facebook half was missing. Name the gap.
  const spendHealth = useMemo(() => {
    const fbOk = fbSpendFromApi.covered || (apiTotals?.fb?.spend ?? 0) > 0
    const googleOk = googleFeedCoversWindow || (apiTotals?.google?.spend ?? 0) > 0
    const warning: string | null = fbOk && googleOk ? null : fbOk ? 'Google n/a' : googleOk ? 'FB n/a' : 'n/a'
    const subtitle = fbOk && googleOk ? 'All channels' : fbOk ? 'Facebook only' : googleOk ? 'Google only' : 'no live spend feed'
    return { fbOk, googleOk, warning, subtitle }
  }, [fbSpendFromApi.covered, googleFeedCoversWindow, apiTotals])

  const bothSpendFeedsDead = !spendHealth.fbOk && !spendHealth.googleOk

  // How the Live Revenue card is painted. Green belongs to a live feed WITH money on it;
  // a real zero next to real spend is red; an unreachable feed is grey and says n/a.
  const revenueStatus = useMemo(() => {
    if (bookingsFeedState !== 'live') {
      return { tone: 'na' as const, dot: '#9ca3af', text: '#6b7280', label: 'Revenue n/a' }
    }
    if (revenueTotals.totalRevenue > 0) {
      return { tone: 'live' as const, dot: '#22c55e', text: '#16a34a', label: 'Live Revenue' }
    }
    if (totals.spend > 5000) {
      return { tone: 'alert' as const, dot: '#dc2626', text: '#991b1b', label: 'No revenue booked' }
    }
    return { tone: 'quiet' as const, dot: '#9ca3af', text: '#6b7280', label: 'Revenue' }
  }, [bookingsFeedState, revenueTotals.totalRevenue, totals.spend])

  // Fail loud: a QL rate above 100% means numerator and denominator came from different
  // measuring systems. Show nothing rather than an impossible number.
  const qlRate = useMemo(() => {
    if (totals.leads <= 0) return null
    if (totals.qualityLeads > totals.leads) {
      console.error('[bta] QL > leads — mismatched sources', { ql: totals.qualityLeads, leads: totals.leads })
      return null
    }
    return (totals.qualityLeads / totals.leads) * 100
  }, [totals])

  const channelFb = useMemo(() => {
    const quality = qualityCount(leadsFbFiltered)
    const leadsCount = leadsFbFiltered.length
    const platformLeads = (apiTotals?.fb?.fbFormLeads || 0) + (apiTotals?.fb?.landingLeads || 0)
    // `fb_ads_enriched` is the ONLY source for FB platform leads / clicks / LP views and it
    // stopped emitting rows on 2026-08-08 (last date in the tab). Spend still arrives, because
    // fetchFacebookAds backfills it from fb_ads_api, so the card kept printing "Platform leads 0"
    // next to EUR 16,360 of spend — a dead feed rendered as a measurement of zero. No window can
    // truthfully carry spend with zero clicks AND zero LP views AND zero leads, so when all four
    // enriched-derived fields are empty the feed did not cover the window and the tile says n/a.
    // Display only — platformLeads itself is untouched.
    const platformLeadsMeasured =
      ((apiTotals?.fb?.clicks || 0) + (apiTotals?.fb?.lpViews || 0) + platformLeads) > 0
    const qRate = leadsCount > 0 ? Math.round((quality / leadsCount) * 100) : 0
    const bookingsFb = filteredBookings.filter((b) => b.source.startsWith('fb_'))
    const revenueFb = bookingsFb.reduce((s, b) => s + (b.rvc || 0), 0)
    const spend = fbSpendFromApi.covered ? fbSpendFromApi.total : apiTotals?.fb?.spend ?? fbSpend
    const roas = spend > 0 ? revenueFb / spend : 0
    const cpql = quality > 0 ? spend / quality : 0
    return {
      spend,
      leads: leadsCount,
      platformLeads,
      platformLeadsMeasured,
      quality,
      qRate,
      cpql,
      bookings: bookingsFb.length,
      revenue: revenueFb,
      roas
    }
  }, [apiTotals, leadsFbFiltered, filteredBookings, fbSpend, fbSpendFromApi])

  const channelGoogle = useMemo(() => {
    const quality = qualityCount(leadsGoogleFiltered)
    const leadsCount = leadsGoogleFiltered.length
    const platformLeads = apiTotals?.google?.conversions ?? 0
    const qRate = leadsCount > 0 ? Math.round((quality / leadsCount) * 100) : 0
    const bookingsGoogle = filteredBookings.filter((b) => b.source === 'google')
    const revenueGoogle = bookingsGoogle.reduce((s, b) => s + (b.rvc || 0), 0)
    const spend = apiTotals?.google?.spend ?? googleSpend
    const roas = spend > 0 ? revenueGoogle / spend : 0
    const cpql = quality > 0 ? spend / quality : 0
    return {
      spend,
      leads: leadsCount,
      platformLeads,
      quality,
      qRate,
      cpql,
      bookings: bookingsGoogle.length,
      revenue: revenueGoogle,
      roas
    }
  }, [apiTotals, leadsGoogleFiltered, filteredBookings, googleSpend])

  // A channel ROAS is measurable on exactly the same terms as the headline one: a whole
  // calendar month, a live bookings feed and spend > 0. Anything else is n/a, never 0.00x.
  const channelRoasDisplay = (spend: number, roas: number): number | null =>
    revenueWindowIsWholeMonth && bookingsFeedState === 'live' && spend > 0 ? roas : null
  const fbRoasDisplay = channelRoasDisplay(channelFb.spend, channelFb.roas)
  const googleRoasDisplay = channelRoasDisplay(channelGoogle.spend, channelGoogle.roas)

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
      { label: 'LP Views', value: totals.lpViews ?? 0 },
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

    // Bucket and label on the SAME calendar. The key used to be `toISOString()` (UTC) while the
    // label was `toLocaleDateString()` (local): in CEST every lead stamped 22:00-24:00Z fell into
    // the next UTC day, so August built 32 buckets for 31 days, 30 x-axis labels were produced by
    // two different buckets, and 166 of 1,902 leads sat on the wrong day. The DoD badge read the
    // last two buckets and so compared a 3-lead sliver against a full 54-lead day.
    const map = new Map<string, { totalLeads: number; qualityLeads: number; avgAi: number; count: number; label: string; bucketEnd: Date }>()
    leadsFiltered.forEach((l) => {
      const d = new Date(l.inquiry_date)
      const dayKey = toLocalISODate(d)
      const key = groupByWeek ? weekKey(d) : dayKey
      const label = groupByWeek ? weekLabel(d) : dayKey
      // Build the bucket end from local calendar parts. `new Date("2026-08-31")` parses as UTC
      // midnight, so the later setHours(23,59,...) produced a moment equal to `today` and the
      // `>` test was never true — isPartial was dead for every daily range.
      const [by, bm, bd] = (groupByWeek ? weekKey(d) : dayKey).split('-').map(Number)
      const bucketEnd = new Date(by, bm - 1, bd + (groupByWeek ? 6 : 0), 23, 59, 59, 999)
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
      // Sort on the ISO key, not the rendered label. `new Date(a.label)` could not parse a
      // Slovenian locale date ("31. 8. 2026") -> NaN comparator -> the chart silently fell back
      // to the Streak feed's newest-first order. Labels are ISO now, so this is stable anywhere.
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  }, [leadsFiltered, groupByWeek])

  const qlRateDelta = useMemo(() => {
    const completes = leadTrend.filter((p) => !p.isPartial && p.totalLeads > 0)
    if (completes.length < 2) return null
    const last = completes[completes.length - 1].qlRateDisplay
    const prev = completes[completes.length - 2].qlRateDisplay
    return Math.round((last - prev) * 10) / 10
  }, [leadTrend])

  const handleAsk = async (prompt: string) => {
    const startISO = toLocalISODate(dateBounds.start)
    const endISO = toLocalISODate(dateBounds.end)
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
    overallROAS: roasDisplay,
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
  }), [range, totals, roasDisplay, cacValue, cacMode, channelFb, channelGoogle, revenueBySource, topMarkets, leadTrend, funnel])

  // The summary used to fire on every change of `aiMetricsPayload`, starting with the FIRST
  // render — before any sheet had loaded. That first POST carried an all-zero payload, and the
  // route hands the payload to the model as ground truth, so the model correctly described what
  // it was given: "All metrics in the payload are zero ... a tracking/data sync issue". The page
  // then rendered that verdict above KPI cards reading EUR 82,097 spend and 1,902 leads. Up to
  // eight POSTs went out per page view, one model call each.
  //
  // Two guards: never ask about a payload that has no data in it yet, and debounce so the
  // in-between payloads (as each feed lands) coalesce into one request for the settled numbers.
  useEffect(() => {
    if (loading) return
    const hasData = totals.spend > 0 || totals.leads > 0 || totals.revenue > 0
    if (!hasData) return

    let cancelled = false
    const timer = setTimeout(() => {
      const loadSummary = async () => {
        try {
          const startISO = toLocalISODate(dateBounds.start)
          const endISO = toLocalISODate(dateBounds.end)
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
          if (!res.ok || cancelled) return
          const data = await res.json()
          // A late response from a superseded payload must never overwrite a newer summary.
          if (cancelled) return
          setAiBullets(Array.isArray(data.bullets) ? data.bullets : [])
        } catch (err) {
          console.error('AI summary load failed', err)
        }
      }
      loadSummary()
    }, 800)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [range, dateBounds, aiMetricsPayload, loading, totals.spend, totals.leads, totals.revenue])

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
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: revenueStatus.text }}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: revenueStatus.dot }} />
                {revenueStatus.label}
              </div>
              <p className="text-xs tracking-[0.2em] text-gray-500">{monthRangeLabel}</p>
              <p className="text-xs tracking-[0.2em] text-gray-500">TOTAL REVENUE WON</p>
              <div
                className="text-4xl font-semibold"
                style={{
                  color:
                    revenueStatus.tone === 'na' ? '#9ca3af' : revenueStatus.tone === 'alert' ? '#991b1b' : gold
                }}
              >
                {revenueStatus.tone === 'na' ? 'n/a' : formatCurrency(revenueTotals.totalRevenue, 'EUR')}
              </div>
              {revenueStatus.tone === 'na' ? (
                <div className="text-sm text-gray-500">
                  Bookings feed does not reach {monthRangeLabel} — deals and revenue are not measurable.
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
                  <span
                    className="flex items-center gap-1"
                    style={{ color: revenueTotals.deals > 0 ? '#15803d' : '#6b7280' }}
                  >
                    {revenueTotals.deals > 0 ? '✅' : ''}
                    <span>{revenueTotals.deals} deals closed</span>
                  </span>
                  <span className="h-4 w-px bg-gray-200" />
                  <span>Avg {revenueTotals.deals > 0 ? formatCurrency(revenueTotals.avgDeal, 'EUR') : 'n/a'} per deal</span>
                </div>
              )}
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
          <MetricCard
            title="Total Spend"
            value={bothSpendFeedsDead ? 'n/a' : formatCurrency(totals.spend, 'EUR')}
            subtitle={spendHealth.subtitle}
            icon={<DollarSign className="h-4 w-4 text-[#B39262]" />}
            zone={spendHealth.warning ? 'optimize' : undefined}
            zoneLabel={spendHealth.warning || undefined}
            target={spendHealth.warning ? 'One spend feed is not answering for this window - the total is incomplete.' : undefined}
          />
          <MetricCard
            title="Total Leads"
            value={totals.leads.toLocaleString()}
            subtitle={`Streak CRM${totals.platformLeads > 0 ? ` · platform-reported ${totals.platformLeads.toLocaleString()}` : ''}`}
            icon={<Users className="h-4 w-4 text-[#B39262]" />}
          />
          <MetricCard
            title="Quality Leads"
            value={`${totals.qualityLeads.toLocaleString()}${qlRate !== null ? ` (${Math.round(qlRate)}%)` : ''}`}
            subtitle="AI ≥ 50"
            icon={<Sparkles className="h-4 w-4 text-[#B39262]" />}
            zone={qlRate !== null ? zoneForQlRate(qlRate) : undefined}
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
            value={cacValue > 0 ? formatCurrency(cacValue, 'EUR') : 'n/a'}
            subtitle={cacMode === 'deals' ? 'spend / booking' : 'spend / quality lead'}
            icon={<Target className="h-4 w-4 text-[#B39262]" />}
            zone={(cacMode === 'leads' ? zoneForCac(cacValue) : null) ?? undefined}
            target={cacMode === 'leads' ? '€96 SCALE · €150 OPTIMIZE · €240 CUT' : undefined}
          />
          <MetricCard
            title="ROAS"
            value={roasDisplay !== null ? `${roasDisplay.toFixed(2)}x` : 'n/a'}
            subtitle={roasDisplay !== null ? 'return on ad spend' : 'bookings are month-level'}
            icon={<BarChart3 className="h-4 w-4 text-[#34a853]" />}
            accent="#34a853"
            zone={roasDisplay !== null ? zoneForRoas(roasDisplay) : undefined}
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
              {
                label: 'Platform leads',
                value: channelFb.platformLeadsMeasured ? channelFb.platformLeads.toLocaleString() : 'n/a',
                zone: channelFb.platformLeadsMeasured ? undefined : null
              },
              { label: 'Quality Leads', value: `${channelFb.quality.toLocaleString()} (${channelFb.qRate}%)` },
              { label: 'CPQL', value: formatCurrency(channelFb.cpql, 'EUR') },
              { label: 'Bookings', value: bookingsFeedState === 'live' ? channelFb.bookings.toString() : 'n/a' },
              { label: 'Revenue', value: bookingsFeedState === 'live' ? formatCurrency(channelFb.revenue, 'EUR') : 'n/a' },
              {
                label: 'ROAS',
                value: fbRoasDisplay !== null ? `${fbRoasDisplay.toFixed(2)}x` : 'n/a',
                zone: fbRoasDisplay !== null ? zoneForRoas(fbRoasDisplay) : null
              }
            ]}
          />
          <ChannelCard
            title="Google Ads"
            icon={<span className="text-[#4285F4]">ⓖ</span>}
            metrics={[
              { label: 'Spend', value: formatCurrency(channelGoogle.spend, 'EUR') },
              { label: 'Leads', value: channelGoogle.leads.toLocaleString() },
              { label: 'Platform leads', value: channelGoogle.platformLeads.toLocaleString() },
              { label: 'Quality Leads', value: `${channelGoogle.quality.toLocaleString()} (${channelGoogle.qRate}%)` },
              { label: 'CPQL', value: formatCurrency(channelGoogle.cpql, 'EUR') },
              { label: 'Bookings', value: bookingsFeedState === 'live' ? channelGoogle.bookings.toString() : 'n/a' },
              { label: 'Revenue', value: bookingsFeedState === 'live' ? formatCurrency(channelGoogle.revenue, 'EUR') : 'n/a' },
              {
                label: 'ROAS',
                value: googleRoasDisplay !== null ? `${googleRoasDisplay.toFixed(2)}x` : 'n/a',
                zone: googleRoasDisplay !== null ? zoneForRoas(googleRoasDisplay) : null
              }
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
                  {totals.lpViews && totals.lpViews > 0 ? formatCurrency(totals.spend / totals.lpViews, 'EUR') : '—'}
                </span>
                <span className="text-[11px] text-gray-500">CPC</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {totals.lpViews != null ? totals.lpViews.toLocaleString() : '—'}
                </div>
                <div className="text-sm text-gray-500">LP Views</div>
                {totals.lpViews == null && (
                  <div className="text-[11px] text-amber-700 mt-1">Facebook feed stale — not measurable</div>
                )}
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {calcRate(totals.platformLeads, totals.lpViews ?? 0)}
                </span>
                <span className="text-[11px] text-gray-500">LP→Leads (platform)</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{totals.leads.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Leads</div>
                <div className="text-xs text-gray-400 mt-1">platform {totals.platformLeads.toLocaleString()}</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {qlRate !== null ? `${qlRate.toFixed(1)}%` : '—'}
                </span>
                <span className="text-[11px] text-gray-500">Leads→Quality</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{totals.qualityLeads.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Quality Leads</div>
              </div>
              {/* PERIOD metric, deliberately — not a cohort conversion rate (Dejan, 2026-08-31).
                  Goolets counts a booking in the month it CLOSES and a lead in the month it
                  ARRIVES, so an August booking off a July lead belongs to August on both sides
                  of the business. Only 1 of the 11 August bookings has an August inquiry date;
                  that is expected under this convention and is NOT a defect. Do not "fix" this
                  into a cohort rate and do not remove it — it is the number the team steers on.
                  The label says "per period" so nobody reads it as a cohort conversion. */}
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {bookingsFeedState === 'live' ? calcRate(totals.bookings, totals.qualityLeads) : '—'}
                </span>
                <span className="text-[11px] text-gray-500">Quality→Bookings</span>
                <span className="text-[10px] text-gray-400">per period</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div
                  className="text-2xl font-bold"
                  style={{
                    color:
                      bookingsFeedState !== 'live'
                        ? '#9ca3af'
                        : totals.bookings === 0 && totals.spend > 5000
                        ? '#991b1b'
                        : '#111827'
                  }}
                >
                  {bookingsFeedState === 'live' ? totals.bookings.toLocaleString() : 'n/a'}
                </div>
                <div className="text-sm text-gray-500">Bookings</div>
                {bookingsFeedState !== 'live' && (
                  <div className="text-[11px] text-amber-700 mt-1">Bookings feed stale — not measurable</div>
                )}
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-gray-400">→</span>
                <span className="text-xs text-gray-500">
                  {totals.bookings > 0 ? formatCurrencyNoCents(totals.revenue / totals.bookings, 'EUR') : '—'}
                </span>
                <span className="text-[11px] text-gray-500">avg deal</span>
              </div>
              <div className="flex-1 min-w-[140px] bg-white rounded-lg shadow-sm border border-[#e1d8c7] p-4 text-center">
                <div
                  className="text-2xl font-bold"
                  style={{
                    color:
                      revenueStatus.tone === 'na' ? '#9ca3af' : revenueStatus.tone === 'alert' ? '#991b1b' : gold
                  }}
                >
                  {revenueStatus.tone === 'na' ? 'n/a' : formatCurrencyNoCents(totals.revenue, 'EUR')}
                </div>
                <div className="text-sm text-gray-500">Revenue</div>
                <div
                  className="text-xs mt-1"
                  style={{ color: roasDisplay === null ? '#9ca3af' : ZONE_STYLES[zoneForRoas(roasDisplay)].text }}
                >
                  ROAS {roasDisplay === null ? 'n/a' : `${roasDisplay.toFixed(2)}x`}
                </div>
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

/** Rows of the `fb_ads_api` tab: one (date, campaign, spend) triple straight from Meta. */
function mapFbSpendApiRows(headers: string[], rows: any[][]): FbSpendApiRow[] {
  if (!headers?.length || !rows?.length) return []
  const norm = (v: any) => String(v || '').trim().toLowerCase()
  const col = (name: string) => headers.findIndex((h) => norm(h) === name)
  const idx = { date: col('date'), campaign: col('campaign'), spend: col('spend') }
  if (idx.date === -1 || idx.spend === -1) return []
  return rows
    .map((r) => ({
      date: String(r[idx.date] || '').slice(0, 10),
      campaign: idx.campaign === -1 ? '' : String(r[idx.campaign] || ''),
      spend: Number(r[idx.spend]) || 0
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
}

/** ISO date of the Monday starting this date's local week. */
function weekKey(d: Date) {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1)
  copy.setDate(diff)
  copy.setHours(0, 0, 0, 0)
  // toISOString() would shift local Monday midnight back to Sunday 22:00Z in CEST and name the
  // week after the wrong day (Thu 27 Aug -> "2026-08-23", a Sunday). Read local parts instead.
  return toLocalISODate(copy)
}

function weekLabel(d: Date) {
  return weekKey(d)
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

/**
 * Format a Date as YYYY-MM-DD using its LOCAL calendar parts.
 *
 * Do not use toISOString().slice(0,10) for these window bounds. computeDateBounds() returns local
 * midnight, and in CEST (UTC+2) toISOString() renders 1 Aug 00:00 as "2026-07-31T22:00:00Z", so
 * every MTD query silently started on 31 July and dragged an extra day of spend into the KPIs
 * (on 2026-08-17 that was €2.360 of FB + €485 of Google, which inflated spend and depressed ROAS).
 */
function toLocalISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

/**
 * One country, one row. Anything not aliased used to fall through to `country.toUpperCase()`,
 * which split real markets across several rows and corrupted both QL counts and close rates:
 * UK 132 + GB 33 + SCOTLAND 1 (true 166, close rate shown 1.5% vs a true 1.2%), BRAZIL 31 +
 * BRASIL 14 (true 45, shown 3.2% vs a true 2.2%), plus SPAIN/ESPAÑA, FRANCE/FR, ITALY/ITALIA,
 * NETHERLANDS/NL and GERMANY/DE. Sorted by QL, "GB" surfaced as a top-8 market in its own right.
 * Add a synonym here rather than letting a new spelling quietly open a second row.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  us: 'USA', usa: 'USA', 'united states': 'USA', 'united states of america': 'USA', america: 'USA',
  uk: 'UK', gb: 'UK', 'united kingdom': 'UK', 'great britain': 'UK', britain: 'UK',
  england: 'UK', scotland: 'UK', wales: 'UK', 'northern ireland': 'UK',
  uae: 'UAE', 'united arab emirates': 'UAE',
  ca: 'Canada', canada: 'Canada',
  au: 'Australia', aus: 'Australia', australia: 'Australia',
  br: 'Brazil', brazil: 'Brazil', brasil: 'Brazil',
  es: 'Spain', spain: 'Spain', 'españa': 'Spain', espana: 'Spain',
  fr: 'France', france: 'France',
  it: 'Italy', italy: 'Italy', italia: 'Italy',
  nl: 'Netherlands', netherlands: 'Netherlands', holland: 'Netherlands',
  de: 'Germany', germany: 'Germany', deutschland: 'Germany',
  ie: 'Ireland', ireland: 'Ireland',
  il: 'Israel', israel: 'Israel',
  ch: 'Switzerland', switzerland: 'Switzerland',
  at: 'Austria', austria: 'Austria',
  be: 'Belgium', belgium: 'Belgium',
  se: 'Sweden', sweden: 'Sweden',
  no: 'Norway', norway: 'Norway',
  dk: 'Denmark', denmark: 'Denmark',
  pl: 'Poland', poland: 'Poland',
  nz: 'New Zealand', 'new zealand': 'New Zealand',
  za: 'South Africa', 'south africa': 'South Africa',
  mx: 'Mexico', mexico: 'Mexico',
  ar: 'Argentina', argentina: 'Argentina',
  si: 'Slovenia', slovenia: 'Slovenia',
  hr: 'Croatia', croatia: 'Croatia',
  tr: 'Turkey', turkey: 'Turkey', turkiye: 'Turkey', 'türkiye': 'Turkey',
}

function normalizeCountry(country: string) {
  const c = (country || '').trim().toLowerCase()
  // "n/a" is the same absence of information as an empty cell — one row, not two.
  if (!c || c === 'n/a' || c === 'na' || c === '-' || c === 'unknown') return 'Unknown'
  const alias = COUNTRY_ALIASES[c]
  if (alias) return alias
  // Title Case, so an unaliased country reads like a name instead of shouting.
  return c.replace(/\b\w/g, (m) => m.toUpperCase())
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
          {metrics.map((metric) => {
            // undefined zone = plain ink. null = grey, nothing was measured. A Zone brings its
            // own colour, so CUT reads red instead of the old unconditional green.
            const zoneColor =
              metric.zone === undefined ? '#111827' : metric.zone === null ? '#6b7280' : ZONE_STYLES[metric.zone].text
            return (
              <div key={metric.label} className="rounded-lg border border-[#e1d8c7] bg-[#fbf9f4] p-3">
                <div className="text-xs text-muted-foreground">{metric.label}</div>
                <div className="text-sm font-semibold" style={{ color: zoneColor }}>{metric.value}</div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
    )
}

