'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'
import { VESSEL_PROFILES } from '@/lib/vessel-profiles'
import type { VesselFunnelResult, VesselLead } from '@/lib/vessel-funnel'
import { cn } from '@/lib/utils'
import { Loader2, Ship, TrendingUp, AlertCircle } from 'lucide-react'

const ACCENT = '#B39262'
const DATE_OPTIONS = [7, 30, 60, 90]

function formatPct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function formatCurrency(value: number) {
  return `€${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function aiColor(score: number) {
  if (score >= 70) return 'text-green-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-red-600'
}

export default function VesselFunnelPage() {
  const [vesselId, setVesselId] = useState(VESSEL_PROFILES[0].id)
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<VesselFunnelResult | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/vessel-funnel?vesselId=${vesselId}&days=${days}`)
        if (!res.ok) throw new Error(`Request failed ${res.status}`)
        const json = (await res.json()) as VesselFunnelResult
        setData(json)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vessel funnel')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [vesselId, days])

  const funnelData = useMemo(() => data?.funnelSteps || [], [data])
  const whyNotData = useMemo(() => data?.whyNot || [], [data])
  const leads = useMemo(() => data?.leads || [], [data])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Vessel Funnel</p>
            <h1 className="text-3xl font-semibold text-gray-900">{data?.profile.name || 'Vessel'}</h1>
            {data?.profile.specs && (
              <p className="text-sm text-gray-500">⛵ {data.profile.specs}{data.profile.priceFrom ? ` · ${data.profile.priceFrom}` : ''}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={vesselId}
              onChange={(e) => setVesselId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#B39262] focus:outline-none"
            >
              {VESSEL_PROFILES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <div className="flex items-center rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
              {DATE_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    'rounded-md px-3 py-1 text-sm font-medium transition',
                    days === d ? 'bg-[#B39262] text-white shadow' : 'text-gray-600 hover:bg-gray-100'
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </header>

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
            <span className="ml-3 text-sm text-gray-600">Loading vessel funnel…</span>
          </div>
        ) : data ? (
          <div className="mt-8 space-y-8">
            {/* KPI cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard title="Leads" value={data.counts.leads.toLocaleString()} icon={<Ship className="h-4 w-4" />} />
              <KpiCard
                title="QL"
                value={`${data.counts.ql.toLocaleString()}`}
                subtitle={`${formatPct(data.rates.leadToQl)}`}
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <KpiCard title="Vessel QL" value={data.counts.vesselQl.toLocaleString()} icon={<Ship className="h-4 w-4" />} />
              <KpiCard title="Assigned" value={data.counts.assigned.toLocaleString()} icon={<Ship className="h-4 w-4" />} />
              <KpiCard
                title="Bookings"
                value={data.counts.bookings.toLocaleString()}
                subtitle={data.counts.revenue > 0 ? formatCurrency(data.counts.revenue) : '—'}
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <KpiCard
                title="Cost / Booking"
                value={data.counts.bookings > 0 ? formatCurrency(0) : '—'}
                subtitle="Spend TBD"
                icon={<AlertCircle className="h-4 w-4" />}
              />
            </div>

            {/* Conversion cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <RateCard label="Lead → QL" value={data.rates.leadToQl} />
              <RateCard label="QL → Vessel QL" value={data.rates.qlToVesselQl} />
              <RateCard label="Vessel QL → Assigned" value={data.rates.vesselQlToAssigned} />
              <RateCard label="Assigned → Booking" value={data.rates.assignedToBooking} />
              <RateCard label="Revenue / Lead" value={data.rates.revenuePerLead} money />
            </div>

            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Funnel</h3>
                  <TrendingUp className="h-4 w-4 text-[#B39262]" />
                </div>
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={funnelData} layout="vertical" margin={{ left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="label" />
                      <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
                      <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Why NOT</h3>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </div>
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={whyNotData} layout="vertical" margin={{ left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="reason" type="category" width={160} />
                      <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
                      <Legend />
                      <Bar dataKey="count" name="Count" fill={ACCENT} radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            {/* Leads table */}
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Leads</h3>
                <span className="text-sm text-gray-500">{leads.length} rows</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-gray-500">
                      <th className="py-2">Inquiry</th>
                      <th className="py-2">Name</th>
                      <th className="py-2">Country</th>
                      <th className="py-2">AI</th>
                      <th className="py-2">Budget</th>
                      <th className="py-2">Guests</th>
                      <th className="py-2">Destination</th>
                      <th className="py-2">Stage</th>
                      <th className="py-2">Vessel QL</th>
                      <th className="py-2">Assigned</th>
                      <th className="py-2">Why NOT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, idx) => (
                      <tr
                        key={`${lead.source}-${idx}`}
                        className={cn(
                          'border-b last:border-0',
                          lead.vesselQl ? 'bg-yellow-50' : 'bg-white'
                        )}
                      >
                        <td className="py-2 text-gray-700">{lead.inquiry_date}</td>
                        <td className="py-2 font-medium text-gray-900">{lead.name || '—'}</td>
                        <td className="py-2 text-gray-700">{lead.country || '—'}</td>
                        <td className={cn('py-2 font-semibold', aiColor(lead.ai_score))}>{lead.ai_score || 0}</td>
                        <td className="py-2 text-gray-700">{lead.budget_range || '—'}</td>
                        <td className="py-2 text-gray-700">{lead.size_of_group ?? '—'}</td>
                        <td className="py-2 text-gray-700">{lead.destination || '—'}</td>
                        <td className="py-2 text-gray-700">{lead.stage || '—'}</td>
                        <td className="py-2 text-gray-700">{lead.vesselQl ? '✓' : '—'}</td>
                        <td className="py-2 text-gray-700">{lead.assigned ? '✓' : '—'}</td>
                        <td className="py-2 text-gray-700">{lead.why_not_segment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
}

function KpiCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
          <div className="text-2xl font-semibold text-gray-900">{value}</div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {icon && <div className="text-[#B39262]">{icon}</div>}
      </div>
    </Card>
  )
}

function RateCard({ label, value, money = false }: { label: string; value: number; money?: boolean }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <div className="text-2xl font-semibold text-gray-900">{money ? formatCurrency(value) : formatPct(value)}</div>
    </Card>
  )
}
