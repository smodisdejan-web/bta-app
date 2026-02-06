'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { cn } from '@/lib/utils'
import type { GA4LandingPage, GA4LandingPageTotals } from '@/lib/ga4-landing-pages'
import {
  Calendar,
  Loader2,
  ArrowRight,
  MousePointerClick,
  Users,
  Sparkles,
  Activity,
  TrendingUp,
  AlertCircle,
  BarChart3,
  Clock,
  PieChart as PieIcon,
  Filter,
  RefreshCw,
} from 'lucide-react'

const ACCENT = '#B39262'
const COLORS = ['#B39262', '#4285f4', '#34a853', '#ea4335', '#9ca3af', '#f59e0b']
const DATE_OPTIONS = [7, 30, 60, 90]
const PAGE_SIZE = 10

type LandingPagesResponse = {
  totals: GA4LandingPageTotals
  topPerformers: GA4LandingPage[]
  leakyBuckets: GA4LandingPage[]
  bySource: { source: string; sessions: number; conversions: number; conversionRate: number }[]
  byDevice: { device: string; sessions: number; conversions: number; conversionRate: number }[]
  allPages: GA4LandingPage[]
  timeseries?: { date: string; sessions: number; conversions: number; conversionRate: number }[]
  meta: {
    days: number
    totalRows: number
    dateRange: { from: string | null; to: string | null }
  }
}

function formatNumber(value: number) {
  return value.toLocaleString()
}

function toPercentValue(value: number) {
  if (!Number.isFinite(value)) return 0
  // If value is already a percentage (e.g., 42), keep it. If it's a decimal (0.52), scale.
  if (value <= 1) return value * 100
  // Handle extreme values that look like millis/micros—clamp
  if (value > 1000) return 0
  return value
}

function formatPercent(value: number, digits = 1) {
  return `${toPercentValue(value).toFixed(digits)}%`
}

function formatEngagement(seconds: number) {
  if (!Number.isFinite(seconds)) return '0s'
  let sec = seconds
  // Heuristic: if absurdly high, treat as ms and scale down up to 3 times
  for (let i = 0; i < 3 && sec > 86400; i++) {
    sec = sec / 1000
  }
  const mins = Math.floor(sec / 60)
  const rem = Math.floor(sec % 60)
  if (mins >= 60) {
    const hours = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hours}h ${remMins}m`
  }
  return mins > 0 ? `${mins}m ${rem}s` : `${rem}s`
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-gray-200 shadow-sm p-6', className)}>{children}</div>
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string
  value: string
  subtitle?: string
  icon: React.ReactNode
}) {
  return (
    <Card className="flex flex-col space-y-2">
      <div className="flex items-center space-x-2 text-sm text-gray-600">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#B39262]/10 text-[#B39262]">{icon}</div>
        <span className="font-medium">{title}</span>
      </div>
      <div className="text-3xl font-semibold text-gray-900">{value}</div>
      {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
    </Card>
  )
}

export default function LandingPagesDashboard() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<LandingPagesResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/landing-pages?days=${days}`)
        if (!res.ok) throw new Error(`Request failed ${res.status}`)
        const json = (await res.json()) as LandingPagesResponse
        setData(json)
        setPage(1)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [days])

  const filteredPages = useMemo(() => {
    if (!data) return []
    return data.allPages.filter((row) => row.landingPage.toLowerCase().includes(search.toLowerCase()))
  }, [data, search])

  const pagedPages = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredPages.slice(start, start + PAGE_SIZE)
  }, [filteredPages, page])

  const totalPages = Math.max(1, Math.ceil(filteredPages.length / PAGE_SIZE))

  const sessionsTrend = useMemo(() => data?.timeseries || [], [data])

  const totals = data?.totals

  const insights = useMemo(() => {
    if (!data) return []
    const [top] = data.topPerformers || []
    const [leak] = data.leakyBuckets || []
    const bestDevice = (data.byDevice || []).slice().sort((a, b) => b.conversionRate - a.conversionRate)[0]
    const bestSource = (data.bySource || []).slice().sort((a, b) => b.sessions - a.sessions)[0]

    const items: string[] = []
    if (top) {
      items.push(
        `Top page: ${top.landingPage} with ${formatPercent(top.conversionRate)} on ${formatNumber(
          top.sessions,
        )} sessions.`,
      )
    }
    if (bestDevice) {
      items.push(
        `Device gap: ${bestDevice.device} leads with ${formatPercent(bestDevice.conversionRate)}, check UX on other devices.`,
      )
    }
    if (bestSource) {
      items.push(
        `Traffic source: ${bestSource.source} drives ${formatNumber(bestSource.sessions)} sessions; keep investing if quality holds.`,
      )
    }
    if (leak) {
      items.push(
        `Leaky bucket: ${leak.landingPage} has ${formatNumber(leak.sessions)} sessions but only ${formatPercent(
          leak.conversionRate,
        )} conversion rate—investigate.`,
      )
    }
    if (items.length === 0) items.push('No insights available yet. Try a broader date range.')
    return items
  }, [data])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Command Center</p>
            <h1 className="text-3xl font-semibold text-gray-900">GA4 Landing Pages</h1>
            {data?.meta?.dateRange?.from && data.meta.dateRange.to && (
              <p className="text-sm text-gray-500">
                Data from <span className="font-medium">{data.meta.dateRange.from}</span> to{' '}
                <span className="font-medium">{data.meta.dateRange.to}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
              {DATE_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    'rounded-md px-3 py-1 text-sm font-medium transition',
                    days === d ? 'bg-[#B39262] text-white shadow' : 'text-gray-600 hover:bg-gray-100',
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              onClick={() => setDays((prev) => prev)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white p-10 shadow-sm">
            <Loader2 className="h-6 w-6 animate-spin text-[#B39262]" />
            <span className="ml-3 text-sm text-gray-600">Loading landing pages…</span>
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">AI Executive Summary</p>
                    <h2 className="text-xl font-semibold text-gray-900">What matters now</h2>
                  </div>
                  <Sparkles className="h-5 w-5 text-[#B39262]" />
                </div>
                <div className="mt-4 space-y-3 text-sm text-gray-700">
                  <ul className="space-y-2 list-disc pl-5">
                    {insights.map((line, index) => (
                      <li key={index} className="leading-relaxed">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              <div className="lg:col-span-2">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <MetricCard title="Total Sessions" value={formatNumber(totals?.totalSessions || 0)} icon={<PieIcon className="h-4 w-4" />} />
                  <MetricCard title="Total Users" value={formatNumber(totals?.totalUsers || 0)} icon={<Users className="h-4 w-4" />} />
                  <MetricCard title="Conversions" value={formatNumber(totals?.totalConversions || 0)} icon={<MousePointerClick className="h-4 w-4" />} />
                  <MetricCard title="Conversion Rate" value={formatPercent(totals?.conversionRate || 0)} icon={<TrendingUp className="h-4 w-4" />} />
                  <MetricCard title="Avg Bounce Rate" value={formatPercent(totals?.avgBounceRate || 0, 2)} icon={<Activity className="h-4 w-4" />} />
                  <MetricCard title="Avg Engagement" value={formatEngagement(totals?.avgEngagementTime || 0)} icon={<Clock className="h-4 w-4" />} />
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">🏆 Top Performing Pages</h3>
                    <p className="text-sm text-gray-500">Sorted by conversion rate</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[#B39262]" />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-gray-500">
                        <th className="py-2">Landing Page</th>
                        <th className="py-2 text-right">Sessions</th>
                        <th className="py-2 text-right">Conversions</th>
                        <th className="py-2 text-right">Conv Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.topPerformers || []).map((row, index) => (
                        <tr key={`${row.landingPage}-${index}`} className="border-b last:border-0">
                          <td className="py-2 font-medium text-gray-900">{row.landingPage}</td>
                          <td className="py-2 text-right text-gray-700">{formatNumber(row.sessions)}</td>
                          <td className="py-2 text-right text-gray-700">{formatNumber(row.conversions)}</td>
                          <td className="py-2 text-right font-medium text-gray-900">
                            {formatPercent(Math.min(row.conversionRate, 100))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">🪣 Leaky Buckets</h3>
                    <p className="text-sm text-gray-500">High traffic, low conversion</p>
                  </div>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-gray-500">
                        <th className="py-2">Landing Page</th>
                        <th className="py-2 text-right">Sessions</th>
                        <th className="py-2 text-right">Conversions</th>
                        <th className="py-2 text-right">Conv Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.leakyBuckets || []).map((row, index) => (
                        <tr key={`${row.landingPage}-${index}`} className="border-b last:border-0">
                          <td className="py-2 font-medium text-gray-900">{row.landingPage}</td>
                          <td className="py-2 text-right text-gray-700">{formatNumber(row.sessions)}</td>
                          <td className="py-2 text-right text-gray-700">{formatNumber(row.conversions)}</td>
                          <td className="py-2 text-right font-medium text-gray-900">
                            {formatPercent(Math.min(row.conversionRate, 100))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Sessions by Source</h3>
                    <p className="text-sm text-gray-500">Top traffic sources</p>
                  </div>
                  <PieIcon className="h-4 w-4 text-[#B39262]" />
                </div>
                <div className="h-72">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={(data?.bySource || []).slice(0, 6)}
                        dataKey="sessions"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {(data?.bySource || []).slice(0, 6).map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatNumber(Number(v))} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Conversions by Device</h3>
                    <p className="text-sm text-gray-500">Total leads per device</p>
                  </div>
                  <BarChart3 className="h-4 w-4 text-[#B39262]" />
                </div>
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={data?.byDevice || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="device" />
                      <YAxis tickFormatter={(v) => formatNumber(Number(v))} />
                      <Tooltip formatter={(v: any) => formatNumber(Number(v))} />
                      <Bar dataKey="conversions" fill={ACCENT} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Conversions Trend</h3>
                    <p className="text-sm text-gray-500">Daily conversions over time</p>
                  </div>
                  <TrendingUp className="h-4 w-4 text-[#B39262]" />
                </div>
                <div className="h-72">
                  <ResponsiveContainer>
                    <LineChart data={sessionsTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={(v) => formatNumber(Number(v))} />
                      <Tooltip formatter={(value: any) => formatNumber(Number(value))} />
                      <Legend />
                      <Line type="monotone" dataKey="conversions" stroke={ACCENT} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card className="mt-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">All Landing Pages</h3>
                  <p className="text-sm text-gray-500">Search and paginate</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value)
                        setPage(1)
                      }}
                      placeholder="Search landing page"
                      className="w-60 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-[#B39262] focus:outline-none"
                    />
                    <Filter className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                  </div>
                  <div className="text-xs text-gray-500">
                    {filteredPages.length} results · Page {page} of {totalPages}
                  </div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-gray-500">
                      <th className="py-2">Landing Page</th>
                      <th className="py-2 text-right">Sessions</th>
                      <th className="py-2 text-right">Users</th>
                      <th className="py-2 text-right">Conversions</th>
                      <th className="py-2 text-right">Conv Rate</th>
                      <th className="py-2 text-right">Bounce Rate</th>
                      <th className="py-2 text-right">Engagement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPages.map((row) => (
                      <tr key={row.landingPage} className="border-b last:border-0">
                        <td className="py-2 font-medium text-gray-900">{row.landingPage}</td>
                        <td className="py-2 text-right text-gray-700">{formatNumber(row.sessions)}</td>
                        <td className="py-2 text-right text-gray-700">{formatNumber(row.users)}</td>
                        <td className="py-2 text-right text-gray-700">{formatNumber(row.conversions)}</td>
                        <td className="py-2 text-right font-medium text-gray-900">
                          {formatPercent(Math.min(row.conversionRate, 100))}
                        </td>
                        <td className="py-2 text-right text-gray-700">{formatPercent(row.bounceRate, 2)}</td>
                        <td className="py-2 text-right text-gray-700">{formatEngagement(row.avgEngagementTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition',
                    page === 1
                      ? 'cursor-not-allowed border-gray-200 text-gray-300'
                      : 'border-gray-200 text-gray-700 hover:border-[#B39262] hover:text-[#B39262]',
                  )}
                >
                  Previous
                </button>
                <div className="text-xs text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredPages.length)} of{' '}
                  {filteredPages.length}
                </div>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition',
                    page >= totalPages
                      ? 'cursor-not-allowed border-gray-200 text-gray-300'
                      : 'border-gray-200 text-gray-700 hover:border-[#B39262] hover:text-[#B39262]',
                  )}
                >
                  Next
                </button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

