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
  Cell,
} from 'recharts'
import { VESSEL_PROFILES } from '@/lib/vessel-profiles'
import type { VesselFunnelResult, VesselLead } from '@/lib/vessel-funnel'
import { cn } from '@/lib/utils'
import { Loader2, Ship, TrendingUp, AlertCircle, Check, Info } from 'lucide-react'

const ACCENT = '#B39262'
const DATE_OPTIONS = [7, 30, 60, 90]

function formatPct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function formatCurrency(value: number) {
  return `€${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatDate(date: string) {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(+d)) return date
  return d.toLocaleDateString('en-GB')
}

function aiColor(score: number) {
  if (score >= 70) return 'bg-green-100 text-green-700 border-green-200'
  if (score >= 50) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
}

function formatBudgetRange(range?: string) {
  if (!range) return '—'
  const m = range.match(/€?\s?(\d[\d.,]*)\s*to\s*€?\s?(\d[\d.,]*)/)
  if (m) {
    const [_, from, to] = m
    return `€${from.replace(/[,]/g, '').replace(/\.\d+/, '')}-${to.replace(/[,]/g, '').replace(/\.\d+/, '')}k`.replace(/€0-/, '€0-')
  }
  const upTo = range.match(/Up to €?(\d[\d.,]*)/)
  if (upTo) return `€0-${upTo[1].replace(/[,]/g, '').replace(/\.\d+/, '')}k`
  const moreThan = range.match(/More than €?(\d[\d.,]*)/)
  if (moreThan) return `€${moreThan[1].replace(/[,]/g, '').replace(/\.\d+/, '')}k+`
  return range
}

function truncated(text?: string, max = 25) {
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export default function VesselFunnelPage() {
  const [vesselId, setVesselId] = useState(VESSEL_PROFILES[0].id)
  const [days, setDays] = useState<number>(90)
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
  const whyNotData = useMemo(() => {
    return (
      data?.whyNot.map((item) => {
        const shortLabel = item.reason === 'Unknown'
          ? 'Not yet determined'
          : item.reason.replace(/\s*\(.*$/, '').trim();
        return {
          reasonShort: shortLabel,
          reasonFull: item.reason === 'Unknown' ? 'Not yet determined' : item.reason,
          count: item.count,
          isUnknown: shortLabel === 'Not yet determined',
        }
      }) || []
    )
  }, [data])
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
              <KpiCard
                title="Leads"
                value={data.counts.leads.toLocaleString()}
                icon={<Ship className="h-4 w-4" />}
                hint="All leads from Belgin Sultan UTM campaigns (source_placement contains vessel name)"
              />
              <KpiCard
                title="QL"
                value={`${data.counts.ql.toLocaleString()}`}
                subtitle={`${formatPct(data.rates.leadToQl)}`}
                icon={<TrendingUp className="h-4 w-4" />}
                hint="Quality Leads with AI score ≥ 50"
              />
              <KpiCard
                title="Vessel QL"
                value={data.counts.vesselQl.toLocaleString()}
                icon={<Ship className="h-4 w-4" />}
                hint="QL leads matching vessel profile: budget, group size, and destination criteria"
              />
              <KpiCard
                title="Assigned"
                value={data.counts.assigned.toLocaleString()}
                icon={<Ship className="h-4 w-4" />}
                hint="All leads (from any campaign) where broker assigned this vessel in Streak"
              />
              <KpiCard
                title="Bookings"
                value={data.counts.bookings.toLocaleString()}
                subtitle={data.counts.revenue > 0 ? formatCurrency(data.counts.revenue) : '—'}
                icon={<TrendingUp className="h-4 w-4" />}
                hint="Confirmed bookings for this vessel"
              />
              <KpiCard
                title="Cost / Booking"
                value={data.counts.bookings > 0 ? formatCurrency(0) : '—'}
                subtitle="Spend TBD"
                icon={<AlertCircle className="h-4 w-4" />}
                hint="Ad spend divided by number of bookings (spend tracking TBD)"
              />
            </div>

            {/* Conversion cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <RateCard label="Lead → QL" value={data.rates.leadToQl} hint="Percentage of leads that passed AI quality threshold (≥50)" />
              <RateCard label="QL → Vessel QL" value={data.rates.qlToVesselQl} hint="Percentage of QL leads matching vessel budget, guests, and destination criteria" />
              <RateCard label="Vessel QL → Booking" value={data.rates.vesselQlToBooking} hint="Percentage of vessel-qualified leads that converted to booking" />
              <RateCard label="Revenue / Lead" value={data.rates.revenuePerLead} money hint="Total booking revenue divided by number of leads" />
            </div>

            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <h3 className="text-lg font-semibold text-gray-900">Funnel</h3>
                    <InfoIcon text="Visual drop-off from lead to booking for vessel-specific campaigns" />
                  </div>
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
                  <div className="flex items-center gap-1">
                    <h3 className="text-lg font-semibold text-gray-900">Why NOT</h3>
                    <InfoIcon text="Reasons why leads did not convert to booking. Not yet determined = no reason recorded yet in Streak" />
                  </div>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </div>
                <div className="h-96">
                  <ResponsiveContainer>
                    <BarChart data={whyNotData} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="reasonShort" type="category" width={180} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1A1A2E', border: 'none', borderRadius: '8px', color: 'white' }}
                        formatter={(value: any, _name: any, props: any) => {
                          const full = props?.payload?.reasonFull || ''
                          return [Number(value).toLocaleString(), full]
                        }}
                        labelFormatter={() => ''}
                      />
                      <Legend />
                      <Bar
                        dataKey="count"
                        name="Count"
                        radius={[4, 4, 4, 4]}
                        label={{ position: 'right', formatter: (v: any) => Number(v).toLocaleString() }}
                      >
                        {whyNotData.map((entry, index) => {
                          const isUnknown = entry.isUnknown
                          return <Cell key={`cell-${index}`} fill={isUnknown ? '#D1D5DB' : ACCENT} />
                        })}
                      </Bar>
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
                <table className="min-w-full text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b text-left text-[11px] uppercase text-gray-500">
                      <th className="py-2 px-2">Inquiry</th>
                      <th className="py-2 px-2">Name</th>
                      <th className="py-2 px-2">Country</th>
                      <th className="py-2 px-2">AI</th>
                      <th className="py-2 px-2">Budget</th>
                      <th className="py-2 px-2">Guests</th>
                      <th className="py-2 px-2">Destination</th>
                      <th className="py-2 px-2">Stage</th>
                      <th className="py-2 px-2">Vessel QL</th>
                      <th className="py-2 px-2">Assigned</th>
                      <th className="py-2 px-2">Why NOT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, idx) => (
                      <tr
                        key={`${lead.source}-${idx}`}
                        className={cn(
                          'border-b last:border-0',
                          idx % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]',
                          lead.vesselQl ? 'bg-[#FEFCE8]' : ''
                        )}
                      >
                        <td className="py-2 px-2 text-gray-700">{formatDate(lead.inquiry_date)}</td>
                        <td className="py-2 px-2 font-medium text-gray-900">{truncated(lead.name)}</td>
                        <td className="py-2 px-2 text-gray-700">{lead.country || '—'}</td>
                        <td className="py-2 px-2">
                          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', aiColor(lead.ai_score))}>
                            {lead.ai_score || 0}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-700">{formatBudgetRange(lead.budget_range)}</td>
                        <td className="py-2 px-2 text-gray-700">{lead.size_of_group ?? '—'}</td>
                        <td className="py-2 px-2 text-gray-700">{lead.destination || '—'}</td>
                        <td className="py-2 px-2 text-gray-700">{lead.stage || '—'}</td>
                        <td className="py-2 px-2 text-gray-700">
                          {lead.vesselQl ? <Check className="h-4 w-4 text-green-600" /> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2 px-2 text-gray-700">
                          {lead.assigned ? <Check className="h-4 w-4 text-green-600" /> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2 px-2 text-gray-700">{lead.why_not_segment || '—'}</td>
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

function InfoIcon({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-1">
      <Info className="h-[18px] w-[18px] text-gray-600" aria-label={text} />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden w-max max-w-[250px] -translate-x-1/2 transform whitespace-normal rounded-md bg-[#1A1A2E] px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block"
        role="tooltip"
      >
        {text}
        <span className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-[#1A1A2E]" />
      </span>
    </span>
  )
}

function KpiCard({ title, value, subtitle, icon, hint }: { title: string; value: string; subtitle?: string; icon?: React.ReactNode; hint: string }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center">
            {title}
            <InfoIcon text={hint} />
          </p>
          <div className="text-2xl font-semibold text-gray-900">{value}</div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {icon && <div className="text-[#B39262]">{icon}</div>}
      </div>
    </Card>
  )
}

function RateCard({ label, value, money = false, hint }: { label: string; value: number; money?: boolean; hint: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center">
        {label}
        <InfoIcon text={hint} />
      </p>
      <div className="text-2xl font-semibold text-gray-900">{money ? formatCurrency(value) : formatPct(value)}</div>
    </Card>
  )
}
