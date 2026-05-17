'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  Users,
  Sparkles,
  TrendingUp,
  AlertCircle,
  BarChart3,
  Gauge,
  Trophy,
  Filter,
  Search as SearchIcon,
  RefreshCw,
  ExternalLink,
  X as XIcon,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import {
  ZONE_STYLES,
  zoneForQlRate,
  zoneForAiScore,
  type Zone,
} from '@/lib/zones'
import type { LPAggregate, LPFunnelTotals } from '@/lib/lp-attribution'

// ============================================================================
// CONSTANTS
// ============================================================================

const ACCENT = '#B39262'
const IVORY = '#f8f7f2'
type RangeKey = 'mtd' | 'lastMonth' | '7d' | '30d' | '60d' | '90d' | 'ytd'
const DATE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'mtd', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '60d', label: '60 Days' },
  { key: '90d', label: '90 Days' },
  { key: 'ytd', label: 'YTD' },
]
const PAGE_SIZE = 15

function computeDateBounds(range: RangeKey): { from: string; to: string; label: string } {
  const now = new Date()
  const fmt = (d: Date) => d.toLocaleString('default', { month: 'short', year: 'numeric' })

  if (range === 'mtd') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { from: start.toISOString(), to: end.toISOString(), label: `${fmt(start)} (MTD)` }
  }
  if (range === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    end.setHours(23, 59, 59, 999)
    return { from: start.toISOString(), to: end.toISOString(), label: fmt(start) }
  }
  if (range === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { from: start.toISOString(), to: end.toISOString(), label: `${now.getFullYear()} (YTD)` }
  }
  const days = Number(range.replace('d', ''))
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return { from: start.toISOString(), to: end.toISOString(), label: `Last ${days} days` }
}

type FunnelResponse = {
  totals: LPFunnelTotals
  aggregates: LPAggregate[]
  quality_winners: LPAggregate[]
  leaky_pages: LPAggregate[]
  by_channel: { channel: string; leads: number; ql: number; ql_rate: number }[]
  by_form: { form: string; leads: number; ql: number; ql_rate: number }[]
  meta: {
    hsContactsTotal: number
    streakLeadsTotal: number
    ga4RowsTotal?: number
    ga4LpsInRange?: number
    bookingsTotal?: number
    afterDateFilter: number
    afterLPFilter: number
    fromISO: string
    toISO: string
  }
}

type SortKey = 'leads' | 'ql' | 'ql_rate' | 'avg_ai_score' | 'path' | 'sessions' | 'cvr' | 'bookings' | 'revenue'

function formatEur(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return '—'
  if (n === 0) return '€0'
  if (n >= 1000) return `€${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `€${n.toFixed(0)}`
}

type DetailResponse = {
  path: string
  totals: { leads: number; matched: number; ql: number; ql_rate: number; avg_ai_score: number; sessions?: number; users?: number; cvr?: number; bookings?: number; revenue?: number; avg_deal?: number }
  by_channel: { key: string; count: number; ql: number }[]
  by_campaign: { key: string; count: number; ql: number }[]
  by_form: { key: string; count: number; ql: number }[]
  by_country: { key: string; count: number; ql: number }[]
  ai_buckets: { range: string; min: number; max: number; count: number }[]
  recent: {
    email: string
    ai_score: number | null
    is_ql: boolean
    is_matched: boolean
    country: string
    createdate: string
    utm_campaign: string
    channel: string
    stage: string | null
  }[]
  meta: { fromISO: string; toISO: string }
}

// ============================================================================
// HELPERS
// ============================================================================

function formatNumber(value: number) {
  return value.toLocaleString()
}

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function shortPath(path: string, max = 50) {
  if (path.length <= max) return path
  return path.slice(0, max - 1) + '…'
}

const GOOLETS_DOMAIN = 'https://goolets.net'
function lpUrl(path: string) {
  return `${GOOLETS_DOMAIN}${path}`
}

// HubSpot form names follow "{page title} - Goolets: {form name}" pattern. In a
// per-LP detail view the page prefix is redundant — strip it to surface just
// the form template (MULTISTEP vs legacy Multi vs Matchmaker vs WPCF7 etc.).
// Sum rows whose key collapses to the same value after `transform` (e.g., two
// distinct conversion event names that strip down to the same form template).
function aggregateByFormatted(
  rows: { key: string; count: number; ql: number }[],
  transform: (k: string) => string,
): { key: string; count: number; ql: number }[] {
  const m = new Map<string, { count: number; ql: number }>()
  for (const r of rows) {
    const k = transform(r.key)
    if (!m.has(k)) m.set(k, { count: 0, ql: 0 })
    const s = m.get(k)!
    s.count += r.count
    s.ql += r.ql
  }
  return Array.from(m.entries())
    .map(([key, v]) => ({ key, count: v.count, ql: v.ql }))
    .sort((a, b) => b.count - a.count)
}

function formatFormName(name: string): string {
  const sep = name.indexOf(' - Goolets: ')
  if (sep !== -1) return name.slice(sep + ' - Goolets: '.length)
  const colon = name.lastIndexOf(': ')
  if (colon !== -1) return name.slice(colon + 2)
  return name
}

function normalizeCountry(country: string): string {
  const c = (country || '').trim().toLowerCase()
  if (!c) return 'Unknown'
  if (['us', 'usa', 'united states', 'united states of america', 'united state'].includes(c)) return 'USA'
  if (['uk', 'united kingdom', 'great britain', 'england', 'gb'].includes(c)) return 'UK'
  if (['uae', 'united arab emirates', 'ae'].includes(c)) return 'UAE'
  if (['ca', 'canada'].includes(c)) return 'Canada'
  if (['au', 'australia'].includes(c)) return 'Australia'
  if (['nz', 'new zealand'].includes(c)) return 'New Zealand'
  // Title-case the rest
  return country.trim().replace(/\b\w/g, m => m.toUpperCase())
}

function channelColor(channel: string): string {
  const map: Record<string, string> = {
    PAID_SOCIAL: '#4267B2',
    PAID_SEARCH: '#4285F4',
    ORGANIC_SEARCH: '#34A853',
    DIRECT_TRAFFIC: '#6B7280',
    SOCIAL_MEDIA: '#E1306C',
    EMAIL_MARKETING: '#FBBC04',
    REFERRALS: '#9333EA',
    OTHER_CAMPAIGNS: '#F59E0B',
    OFFLINE: '#94A3B8',
    UNKNOWN: '#CBD5E1',
  }
  return map[channel] || '#9CA3AF'
}

// ============================================================================
// CARD COMPONENTS
// ============================================================================

function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        'rounded-xl border border-[#e1d8c7] bg-white shadow-sm transition-all duration-300 hover:border-[#B39262]/50 hover:shadow-md',
        className,
      )}
    >
      {children}
    </div>
  )
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  zone,
  target,
}: {
  title: string
  value: string
  subtitle?: string
  icon: React.ReactNode
  zone?: Zone
  target?: string
}) {
  const zoneStyle = zone ? ZONE_STYLES[zone] : null
  return (
    <Card
      className="p-4 space-y-3"
      style={{ borderColor: zoneStyle?.border || '#e1d8c7', borderLeftWidth: zoneStyle ? 3 : 1 } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-600">{title}</div>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#fbf9f4]" style={{ color: ACCENT }}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="flex items-center justify-between gap-2 min-h-[18px]">
        {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : <span />}
        {zoneStyle ? (
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
            style={{ backgroundColor: zoneStyle.bg, color: zoneStyle.text }}
            title={target || undefined}
          >
            {zoneStyle.label}
          </span>
        ) : null}
      </div>
      {target ? <div className="text-[10px] text-gray-500">Target: {target}</div> : null}
    </Card>
  )
}

// ============================================================================
// PAGE
// ============================================================================

export default function LpFunnelDashboard() {
  const [range, setRange] = useState<RangeKey>('ytd')
  const [data, setData] = useState<FunnelResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('leads')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const bounds = useMemo(() => computeDateBounds(range), [range])

  // Fetch detail when LP selected
  useEffect(() => {
    if (!selectedPath) {
      setDetail(null)
      setDetailError(null)
      return
    }
    const load = async () => {
      setDetailLoading(true)
      setDetailError(null)
      try {
        const url = `/api/lp-funnel/detail?path=${encodeURIComponent(selectedPath)}&from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`
        const res = await fetch(url)
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Request failed ${res.status}`)
        }
        setDetail(await res.json())
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Failed to load detail')
      } finally {
        setDetailLoading(false)
      }
    }
    load()
  }, [selectedPath, bounds.from, bounds.to])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/lp-funnel?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`)
        if (!res.ok) throw new Error(`Request failed ${res.status}`)
        const json = (await res.json()) as FunnelResponse
        setData(json)
        setPage(1)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [bounds.from, bounds.to])

  const filtered = useMemo(() => {
    if (!data) return []
    const lower = search.toLowerCase()
    const filtered = data.aggregates.filter(a => a.path.toLowerCase().includes(lower))
    const sorted = [...filtered].sort((a, b) => {
      let av: number | string
      let bv: number | string
      switch (sortKey) {
        case 'path': av = a.path; bv = b.path; break
        case 'ql': av = a.ql; bv = b.ql; break
        case 'ql_rate': av = a.ql_rate; bv = b.ql_rate; break
        case 'avg_ai_score': av = a.avg_ai_score; bv = b.avg_ai_score; break
        case 'sessions': av = a.sessions ?? 0; bv = b.sessions ?? 0; break
        case 'cvr': av = a.cvr ?? 0; bv = b.cvr ?? 0; break
        case 'bookings': av = a.bookings ?? 0; bv = b.bookings ?? 0; break
        case 'revenue': av = a.revenue ?? 0; bv = b.revenue ?? 0; break
        default: av = a.leads; bv = b.leads
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return sorted
  }, [data, search, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'path' ? 'asc' : 'desc') }
  }

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-8" style={{ backgroundColor: IVORY }}>
        <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
          <div className="h-10 w-72 rounded bg-[#e1d8c7]/80" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-28 rounded-xl border border-[#e1d8c7]/60 bg-white/70" />)}
          </div>
          <div className="h-96 rounded-xl border border-[#e1d8c7]/60 bg-white/70" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen px-4 py-8" style={{ backgroundColor: IVORY }}>
        <div className="mx-auto max-w-7xl">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-5 w-5" />
              <strong>Failed to load funnel data</strong>
            </div>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { totals } = data
  const overallQlZone = totals.total_leads > 0 ? zoneForQlRate(totals.avg_ql_rate) : undefined
  const aiZone = totals.avg_ai_score > 0 ? zoneForAiScore(totals.avg_ai_score) : undefined

  return (
    <div className="min-h-screen" style={{ backgroundColor: IVORY }}>
      {/* Sticky header */}
      <div className="sticky top-16 z-30 border-b border-[#e1d8c7]/60 bg-[#f8f7f2]/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#B39262] mb-2">Command Center</p>
            <h1 className="font-serif text-3xl md:text-4xl font-medium text-gray-900 tracking-tight leading-tight">
              Landing Page Funnel
            </h1>
            <div className="mt-2 flex items-center gap-3">
              <span className="h-px w-8 bg-[#B39262]" />
              <p className="text-sm text-gray-600">
                Per-LP lead attribution · {bounds.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap md:pt-1">
            {DATE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setRange(opt.key)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition',
                  range === opt.key
                    ? 'bg-[#B39262] text-white hover:bg-[#9c7f54]'
                    : 'border border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]',
                )}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => setRange(range)}
              className="p-2 rounded-md border border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        {/* KPI ROW */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <MetricCard
            title="Sessions"
            value={totals.total_sessions !== undefined ? formatNumber(totals.total_sessions) : '—'}
            subtitle={totals.total_users !== undefined ? `${formatNumber(totals.total_users)} users` : 'GA4'}
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <MetricCard
            title="Total Leads"
            value={formatNumber(totals.total_leads)}
            subtitle={totals.overall_cvr !== undefined ? `${totals.overall_cvr.toFixed(2)}% CVR` : `${totals.unique_lps} unique LPs`}
            icon={<Users className="h-4 w-4" />}
          />
          <MetricCard
            title="Quality Leads"
            value={formatNumber(totals.total_ql)}
            subtitle={`${formatPercent(totals.avg_ql_rate)} QL rate`}
            icon={<Sparkles className="h-4 w-4" />}
            zone={overallQlZone}
            target=">45%"
          />
          <MetricCard
            title="Avg AI Score"
            value={totals.avg_ai_score.toFixed(1)}
            subtitle={`over ${totals.total_matched} matched`}
            icon={<Gauge className="h-4 w-4" />}
            zone={aiZone}
            target="≥50 = QL"
          />
          <MetricCard
            title="Bookings"
            value={totals.total_bookings !== undefined ? formatNumber(totals.total_bookings) : '—'}
            subtitle={totals.total_leads > 0 && totals.total_bookings ? `${((totals.total_bookings / totals.total_leads) * 100).toFixed(1)}% close rate` : 'attributed'}
            icon={<Trophy className="h-4 w-4" />}
          />
          <MetricCard
            title="Revenue"
            value={formatEur(totals.total_revenue)}
            subtitle={totals.avg_deal_size ? `${formatEur(totals.avg_deal_size)} avg` : 'EUR'}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MetricCard
            title="Streak Coverage"
            value={totals.total_leads > 0 ? `${((totals.total_matched / totals.total_leads) * 100).toFixed(0)}%` : '—'}
            subtitle="matched / total"
            icon={<BarChart3 className="h-4 w-4" />}
          />
        </div>

        {/* SIDE PANELS — Winners & Leaky */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Quality Winners</p>
              <span className="text-xs text-gray-500">≥20 leads, sorted by QL%</span>
            </div>
            <div className="space-y-2">
              {data.quality_winners.length === 0 && (
                <p className="text-sm text-gray-500 italic">No LPs with ≥20 leads in this range.</p>
              )}
              {data.quality_winners.map(w => (
                <div key={w.path} className="flex items-center justify-between p-2 rounded bg-emerald-50/40 hover:bg-emerald-100/60 cursor-pointer group" onClick={() => setSelectedPath(w.path)}>
                  <span className="min-w-0 flex-1 inline-flex items-center gap-1">
                    <span className="truncate text-sm font-mono text-[#8B7355] underline decoration-dotted decoration-emerald-700/30 underline-offset-2 group-hover:text-emerald-800 group-hover:decoration-solid">{shortPath(w.path, 42)}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-emerald-700/40 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                  <div className="flex items-center gap-3 text-sm shrink-0">
                    <span className="text-gray-500">{w.leads}L</span>
                    <span className="font-semibold text-emerald-700">{formatPercent(w.ql_rate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600" />
              <p className="text-sm font-semibold">Leaky Pages</p>
              <span className="text-xs text-gray-500">≥50 leads, low QL%</span>
            </div>
            <div className="space-y-2">
              {data.leaky_pages.length === 0 && (
                <p className="text-sm text-gray-500 italic">No high-volume LPs with quality issues — good.</p>
              )}
              {data.leaky_pages.map(p => (
                <div key={p.path} className="flex items-center justify-between p-2 rounded bg-rose-50/40 hover:bg-rose-100/60 cursor-pointer group" onClick={() => setSelectedPath(p.path)}>
                  <span className="min-w-0 flex-1 inline-flex items-center gap-1">
                    <span className="truncate text-sm font-mono text-[#8B7355] underline decoration-dotted decoration-rose-700/30 underline-offset-2 group-hover:text-rose-800 group-hover:decoration-solid">{shortPath(p.path, 42)}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-rose-700/40 group-hover:text-rose-700 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                  <div className="flex items-center gap-3 text-sm shrink-0">
                    <span className="text-gray-500">{p.leads}L</span>
                    <span className="font-semibold text-rose-700">{formatPercent(p.ql_rate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* CHANNEL BREAKDOWN */}
        <Card className="p-6 space-y-3">
          <div>
            <p className="text-sm font-semibold">Channel × Quality</p>
            <p className="text-xs text-gray-500">Leads (bars) vs QL rate (right axis)</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.by_channel} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#efe8d8" vertical={false} />
                <XAxis dataKey="channel" tick={{ fontSize: 11, fill: '#6b7280' }} angle={-15} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip
                  formatter={(v: any, name: string) =>
                    name === 'ql_rate' ? [formatPercent(Number(v)), 'QL Rate'] : [Number(v).toLocaleString(), name]
                  }
                />
                <Bar dataKey="leads" name="Leads" radius={[3, 3, 0, 0]}>
                  {data.by_channel.map((entry, i) => (
                    <Cell key={i} fill={channelColor(entry.channel)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* MAIN TABLE */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold">All Landing Pages</p>
              <p className="text-xs text-gray-500">
                {filtered.length} LPs · {totals.total_leads} leads · sortable
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter LPs…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1) }}
                  className="pl-7 pr-3 py-1.5 text-sm rounded-md border border-[#e1d8c7] bg-white w-56"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-[#e1d8c7]">
                <tr>
                  <th className="py-2 px-2 cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('path')}>Landing Page</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('sessions')}>Sessions</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('leads')}>Leads</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('cvr')}>CVR</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('ql')}>QL</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('ql_rate')}>QL%</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('avg_ai_score')}>Avg AI</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('bookings')}>Book</th>
                  <th className="py-2 px-2 text-right cursor-pointer hover:text-[#B39262]" onClick={() => toggleSort('revenue')}>Revenue</th>
                  <th className="py-2 px-2">Top Channel</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(a => {
                  const qlZone = a.leads > 0 ? zoneForQlRate(a.ql_rate) : undefined
                  const zoneStyle = qlZone ? ZONE_STYLES[qlZone] : null
                  return (
                    <tr key={a.path} className="border-b border-[#f2ede3] hover:bg-[#fbf9f4] cursor-pointer group" onClick={() => setSelectedPath(a.path)}>
                      <td className="py-2 px-2 font-mono text-xs max-w-[260px]">
                        <span className="inline-flex items-center gap-1 max-w-full" title={`Click for details: ${a.path}`}>
                          <span className="truncate text-[#8B7355] underline decoration-dotted decoration-[#B39262]/40 underline-offset-2 group-hover:text-[#B39262] group-hover:decoration-solid">
                            {a.path}
                          </span>
                          <ChevronRight className="h-3 w-3 shrink-0 text-[#B39262]/50 group-hover:text-[#B39262] group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700">{a.sessions !== undefined ? formatNumber(a.sessions) : '—'}</td>
                      <td className="py-2 px-2 text-right font-medium">{formatNumber(a.leads)}</td>
                      <td className="py-2 px-2 text-right text-gray-700">{a.cvr !== undefined ? `${a.cvr.toFixed(2)}%` : '—'}</td>
                      <td className="py-2 px-2 text-right font-medium">{formatNumber(a.ql)}</td>
                      <td className="py-2 px-2 text-right">
                        {zoneStyle ? (
                          <span
                            className="px-2 py-0.5 rounded text-xs font-semibold"
                            style={{ backgroundColor: zoneStyle.bg, color: zoneStyle.text }}
                          >
                            {formatPercent(a.ql_rate)}
                          </span>
                        ) : formatPercent(a.ql_rate)}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700">{a.avg_ai_score > 0 ? a.avg_ai_score.toFixed(1) : '—'}</td>
                      <td className="py-2 px-2 text-right">
                        {(a.bookings || 0) > 0 ? <span className="font-semibold text-emerald-700">{a.bookings}</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {(a.revenue || 0) > 0 ? <span className="font-semibold text-emerald-700">{formatEur(a.revenue)}</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-2">
                        {a.top_channel ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs" style={{ backgroundColor: channelColor(a.top_channel) + '22', color: channelColor(a.top_channel) }}>
                            {a.top_channel}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded border border-[#e1d8c7] bg-white text-sm disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded border border-[#e1d8c7] bg-white text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* TOP FORMS */}
        <Card className="p-6 space-y-3">
          <div>
            <p className="text-sm font-semibold">Top Conversion Forms</p>
            <p className="text-xs text-gray-500">Volume + QL rate per form name</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-[#e1d8c7]">
                <tr>
                  <th className="py-2 px-2">Form</th>
                  <th className="py-2 px-2 text-right">Leads</th>
                  <th className="py-2 px-2 text-right">QL</th>
                  <th className="py-2 px-2 text-right">QL%</th>
                </tr>
              </thead>
              <tbody>
                {data.by_form.slice(0, 10).map(f => (
                  <tr key={f.form} className="border-b border-[#f2ede3] hover:bg-[#fbf9f4]">
                    <td className="py-2 px-2 text-gray-700 max-w-[420px] truncate" title={f.form}>{f.form}</td>
                    <td className="py-2 px-2 text-right">{formatNumber(f.leads)}</td>
                    <td className="py-2 px-2 text-right">{formatNumber(f.ql)}</td>
                    <td className="py-2 px-2 text-right">{formatPercent(f.ql_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* META FOOTER */}
        <div className="text-xs text-gray-400 text-center py-4 space-y-1">
          <p>
            HubSpot {data.meta.hsContactsTotal.toLocaleString()} contacts ·
            Streak {data.meta.streakLeadsTotal.toLocaleString()} leads ·
            GA4 {data.meta.ga4RowsTotal !== undefined ? `${data.meta.ga4RowsTotal.toLocaleString()} rows` : 'n/a'} ·
            Bookings {data.meta.bookingsTotal || 0} ·
            attributable LPs {data.meta.afterLPFilter.toLocaleString()}
          </p>
          <p className="italic">Booking attribution joined via email (bookings.client_email ↔ hubspot_contacts.email).</p>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {selectedPath && (
        <DetailModal
          path={selectedPath}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={() => setSelectedPath(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// DETAIL MODAL
// ============================================================================

function DetailModal({
  path,
  detail,
  loading,
  error,
  onClose,
}: {
  path: string
  detail: DetailResponse | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="w-full max-w-5xl rounded-xl bg-white shadow-2xl border border-[#e1d8c7]">
        {/* HEADER */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#e1d8c7] bg-white px-6 py-4 rounded-t-xl">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#B39262] mb-1">Landing Page Detail</p>
            <h2 className="font-mono text-base text-gray-900 truncate" title={path}>{path}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={lpUrl(path)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-[#e1d8c7] bg-white text-sm text-gray-700 hover:bg-[#f2ede3]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open LP
            </a>
            <button
              onClick={onClose}
              className="p-2 rounded-md border border-[#e1d8c7] bg-white text-gray-700 hover:bg-[#f2ede3]"
              aria-label="Close"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading detail…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4" />
                <strong>Failed to load</strong>
              </div>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {detail && !loading && !error && (
            <>
              {/* KPI STRIP - Full Funnel */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <DetailMetric label="Sessions" value={detail.totals.sessions !== undefined ? detail.totals.sessions.toLocaleString() : '—'} subtitle={detail.totals.users !== undefined ? `${detail.totals.users.toLocaleString()} users` : undefined} />
                <DetailMetric label="Leads" value={detail.totals.leads.toString()} />
                <DetailMetric label="CVR" value={detail.totals.cvr !== undefined ? `${detail.totals.cvr.toFixed(2)}%` : '—'} subtitle="leads / sess" />
                <DetailMetric label="QL" value={detail.totals.ql.toString()} subtitle={`${detail.totals.matched} matched`} />
                <DetailMetric label="QL Rate" value={formatPercent(detail.totals.ql_rate)} highlight={detail.totals.ql_rate >= 55 ? 'good' : detail.totals.ql_rate < 35 ? 'bad' : 'neutral'} />
                <DetailMetric label="Avg AI" value={detail.totals.avg_ai_score > 0 ? detail.totals.avg_ai_score.toFixed(1) : '—'} />
                <DetailMetric label="Bookings" value={detail.totals.bookings !== undefined ? detail.totals.bookings.toString() : '0'} highlight={(detail.totals.bookings || 0) > 0 ? 'good' : 'neutral'} />
                <DetailMetric label="Revenue" value={formatEur(detail.totals.revenue)} subtitle={detail.totals.avg_deal ? `${formatEur(detail.totals.avg_deal)} avg` : undefined} highlight={(detail.totals.revenue || 0) > 0 ? 'good' : 'neutral'} />
              </div>

              {/* AI DISTRIBUTION */}
              {detail.ai_buckets.some(b => b.count > 0) && (
                <Card className="p-4">
                  <p className="text-sm font-semibold mb-3">AI Score Distribution</p>
                  <div className="h-32">
                    <ResponsiveContainer>
                      <BarChart data={detail.ai_buckets} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#efe8d8" vertical={false} />
                        <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#6b7280' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={28} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                          {detail.ai_buckets.map((b, i) => (
                            <Cell key={i} fill={b.min >= 50 ? '#047857' : b.min >= 40 ? '#B39262' : '#dc2626'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Green = QL (≥50). Goolets QL threshold = AI score 50.</p>
                </Card>
              )}

              {/* 4 BREAKDOWNS */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <BreakdownTable title="Channels" rows={detail.by_channel} colorBy={(k) => channelColor(k)} />
                <BreakdownTable title="Campaigns" rows={detail.by_campaign} />
                <BreakdownTable title="Forms" rows={aggregateByFormatted(detail.by_form, formatFormName)} />
                <BreakdownTable title="Countries" rows={aggregateByFormatted(detail.by_country, normalizeCountry)} />
              </div>

              {/* RECENT LEADS */}
              <Card className="p-4">
                <p className="text-sm font-semibold mb-3">Recent 15 leads</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-500 border-b border-[#e1d8c7]">
                      <tr>
                        <th className="py-2 px-2">Email</th>
                        <th className="py-2 px-2 text-right">AI</th>
                        <th className="py-2 px-2">Country</th>
                        <th className="py-2 px-2">Stage</th>
                        <th className="py-2 px-2">Date</th>
                        <th className="py-2 px-2">Campaign</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recent.map((l, i) => (
                        <tr key={i} className="border-b border-[#f2ede3]">
                          <td className="py-2 px-2 text-gray-700 max-w-[180px] truncate" title={l.email}>{l.email}</td>
                          <td className="py-2 px-2 text-right">
                            {l.ai_score === null ? <span className="text-gray-400">—</span> : (
                              <span className={l.is_ql ? 'text-emerald-700 font-semibold' : 'text-gray-600'}>
                                {l.ai_score}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-gray-600">{l.country || '—'}</td>
                          <td className="py-2 px-2 text-gray-600">{l.stage || '—'}</td>
                          <td className="py-2 px-2 text-gray-500">{l.createdate ? new Date(l.createdate).toLocaleDateString() : '—'}</td>
                          <td className="py-2 px-2 text-gray-600 max-w-[150px] truncate" title={l.utm_campaign}>{l.utm_campaign || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailMetric({ label, value, subtitle, highlight }: { label: string; value: string; subtitle?: string; highlight?: 'good' | 'bad' | 'neutral' }) {
  const color = highlight === 'good' ? 'text-emerald-700' : highlight === 'bad' ? 'text-rose-700' : 'text-gray-900'
  return (
    <div className="rounded-lg border border-[#e1d8c7] bg-[#fbf9f4] p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={cn('text-xl font-semibold', color)}>{value}</div>
      {subtitle && <div className="text-[10px] text-gray-500 mt-0.5">{subtitle}</div>}
    </div>
  )
}

function BreakdownTable({
  title,
  rows,
  colorBy,
}: {
  title: string
  rows: { key: string; count: number; ql: number }[]
  colorBy?: (key: string) => string
}) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold mb-3">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No data</p>
      ) : (
        <div className="space-y-1.5">
          {rows.slice(0, 8).map(r => {
            const pct = (r.count / max) * 100
            const qlPct = r.count > 0 ? (r.ql / r.count) * 100 : 0
            return (
              <div key={r.key} className="text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="truncate text-gray-700 max-w-[60%]" title={r.key}>{r.key || '(empty)'}</span>
                  <span className="text-gray-500 shrink-0">
                    {r.count}L · {r.ql}Q ({qlPct.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded bg-[#f2ede3]">
                  <div
                    className="h-1.5 rounded"
                    style={{ width: `${pct}%`, backgroundColor: colorBy ? colorBy(r.key) : '#B39262' }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
