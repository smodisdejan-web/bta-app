'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  Loader2, Ship, AlertCircle, Check, X, Info, Flag, RefreshCw,
} from 'lucide-react'
import type { TurkeyCampaignResult, YachtFill, AvailWeek, YachtQlLead, CreativeRow, CampaignRow } from '@/lib/turkey-campaign'

const ACCENT = '#B39262'
const BLUE = '#2563EB'
const RED = '#B83C3C'

const fmtCur = (v: number) => `€${Math.round(v || 0).toLocaleString('en-US')}`
const fmtPct = (v: number, d = 1) => `${(v || 0).toFixed(d)}%`

function formatBudgetRange(range?: string) {
  if (!range) return '—'
  const m = range.match(/€?\s?(\d[\d.,]*)\s*to\s*€?\s?(\d[\d.,]*)/)
  if (m) return `€${m[1].replace(/[.,]/g, '').replace(/000$/, 'k')}–${m[2].replace(/[.,]/g, '').replace(/000$/, 'k')}`
  const upTo = range.match(/Up to €?(\d[\d.,]*)/)
  if (upTo) return `≤€${upTo[1].replace(/[.,]/g, '').replace(/000$/, 'k')}`
  const more = range.match(/More than €?(\d[\d.,]*)/)
  if (more) return `€${more[1].replace(/[.,]/g, '').replace(/000$/, 'k')}+`
  return range
}

function formatDate(date: string) {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(+d)) return date
  return d.toLocaleDateString('en-GB')
}

export default function TurkeyCampaignPage() {
  const [data, setData] = useState<TurkeyCampaignResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [batch, setBatch] = useState<number>(0) // 0 = "So far" (cumulative actuals); 5/10 = projection
  const [showAllLeads, setShowAllLeads] = useState(false)
  const [leadFilter, setLeadFilter] = useState<'all' | 'ql' | 'yachtql'>('all')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (fresh = false) => {
    try {
      if (fresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const res = await fetch(`/api/turkey-campaign${fresh ? '?fresh=1' : ''}`)
      if (!res.ok) throw new Error(`Request failed ${res.status}`)
      setData((await res.json()) as TurkeyCampaignResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#B39262] flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5" /> Fill the Fleet
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-gray-900">Turkey Campaign 2026</h1>
            <p className="text-sm text-gray-500">Tosca + Belgin Sultan · 25 weeks to fill · break-even mandate</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <Flag className="h-3.5 w-3.5 text-[#B39262]" />
                <span className="text-sm font-medium text-gray-700">Since 1 May 2026</span>
                <span className="hidden text-[11px] text-gray-400 sm:inline">campaign to date</span>
              </div>
              <button
                onClick={() => load(true)}
                disabled={refreshing || loading}
                title="Pull the latest data (bypasses the 10-min cache)"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
            {data && (
              <span className="text-[11px] text-gray-400">
                data as of {new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </header>

        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4" /> {error}</div>
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white p-10 shadow-sm">
            <Loader2 className="h-6 w-6 animate-spin text-[#B39262]" />
            <span className="ml-3 text-sm text-gray-600">Loading Turkey campaign…</span>
          </div>
        ) : data ? (
          <div className="mt-8 space-y-12">
            <FleetFillSection data={data} />
            <ColumnsSection data={data} batch={batch} setBatch={setBatch} />
            <YachtQlSection
              data={data}
              leadFilter={leadFilter}
              setLeadFilter={setLeadFilter}
              showAllLeads={showAllLeads}
              setShowAllLeads={setShowAllLeads}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ─── SECTION A: Fleet Fill ──────────────────────────────────────────────────

function FleetFillSection({ data }: { data: TurkeyCampaignResult }) {
  const { spent, thresholds, byYacht } = data.costToFill
  const cap = thresholds.target   // €100K — approved Plan C budget cap (NOT a target to reach)
  const max = thresholds.max      // €140K — hard ceiling
  const fillPct = (spent / max) * 100
  const pctOfCap = cap > 0 ? Math.round((spent / cap) * 100) : 0
  const headroom = Math.max(0, cap - spent)
  // milestone ticks every €10K; label the €20K majors up to the cap
  const milestones: { v: number; major: boolean; isCap: boolean; label: boolean }[] = []
  for (let v = 10000; v < max; v += 10000) {
    const isCap = v === cap
    milestones.push({ v, major: v % 20000 === 0, isCap, label: isCap || (v % 20000 === 0 && v < cap) })
  }
  return (
    <section>
      <SectionTitle n="A" title="Main KPI — Fleet Fill" subtitle="Weeks booked vs target · cost-to-fill vs budget thresholds" />
      <div className="grid gap-4 md:grid-cols-2">
        {data.fills.map((f) => <YachtFillCard key={f.id} fill={f} />)}
      </div>

      {/* Cost-to-fill */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-1">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Cost-to-fill</h3>
              <p className="mt-0.5 text-xs text-gray-500">Spend to fill the fleet · {pctOfCap}% of the €{(cap / 1000).toFixed(0)}K cap · lower is better</p>
            </div>
            <InfoIcon text="All Turkey campaign spend (FB + Google) in 2026. €100K is Mitja's approved Plan C budget CAP (€140K hard ceiling) — not a target to hit. The aim is to fill the fleet for as little spend as possible. Most spend runs through shared Turkey campaigns that feed both yachts, so yacht-specific spend stays small." />
          </div>
          <span className="text-2xl font-semibold text-gray-900">{fmtCur(spent)}</span>
        </div>

        {/* per-yacht / shared split — explained */}
        <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">
            Most spend runs through <span className="font-medium text-gray-700">shared Turkey campaigns that feed both yachts</span>. Yacht-specific spend is still small:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <SplitItem label="Shared Turkey" value={byYacht.shared} emphasis />
            <span className="text-gray-300">·</span>
            <SplitItem label="Tosca" value={byYacht.tosca} />
            <span className="text-gray-300">·</span>
            <SplitItem label="Belgin" value={byYacht.belgin} />
          </div>
        </div>

        {/* budget gauge */}
        <div className="mt-5">
          {/* spent marker above the bar */}
          <div className="relative mb-1 h-4">
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-[#8a6f43]"
              style={{ left: `${Math.min(88, Math.max(10, fillPct))}%` }}
            >
              {fmtCur(spent)} spent
            </span>
          </div>
          <div className="relative h-8 w-full overflow-hidden rounded-lg bg-gray-100">
            <div
              className="h-full rounded-lg bg-gradient-to-r from-[#B39262] to-[#caa978] transition-all"
              style={{ width: `${Math.min(100, fillPct)}%` }}
            />
            {/* milestone ticks every €10K */}
            {milestones.map((m) => (
              <div key={m.v} className="absolute top-0 h-full" style={{ left: `${(m.v / max) * 100}%` }}>
                <div className={cn('h-full', m.isCap ? 'w-0.5 bg-amber-500' : m.major ? 'w-px bg-gray-300' : 'w-px bg-gray-200')} />
              </div>
            ))}
          </div>
          {/* axis labels */}
          <div className="relative mt-1 h-4 text-[11px]">
            <span className="absolute left-0 text-gray-400">€0</span>
            {milestones.filter((m) => m.label).map((m) => (
              <span
                key={m.v}
                className={cn('absolute -translate-x-1/2 whitespace-nowrap', m.isCap ? 'font-semibold text-amber-600' : 'text-gray-400')}
                style={{ left: `${(m.v / max) * 100}%` }}
              >
                {m.isCap ? '€100K cap' : `€${(m.v / 1000).toFixed(0)}K`}
              </span>
            ))}
            <span className="absolute right-0 font-medium text-red-400">€{(max / 1000).toFixed(0)}K max</span>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{fmtCur(spent)}</span> of the €{(cap / 1000).toFixed(0)}K cap used · <span className="font-semibold text-gray-900">{fmtCur(headroom)}</span> headroom before the ceiling. <span className="text-gray-500">Lower spend is the win — the fleet just needs to fill.</span>
          </p>
        </div>
      </div>
    </section>
  )
}

function SplitItem({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('text-xs', emphasis ? 'font-medium text-gray-700' : 'text-gray-500')}>{label}</span>
      <span className={cn('text-sm tabular-nums', emphasis ? 'font-semibold text-gray-900' : 'font-medium text-gray-700')}>{value > 0 ? fmtCur(value) : '—'}</span>
    </span>
  )
}

function YachtFillCard({ fill }: { fill: YachtFill }) {
  const pct = Math.min(100, fill.progressPct)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Ship className="h-4 w-4 text-[#B39262]" />
            <h3 className="text-lg font-semibold text-gray-900">{fill.name}</h3>
          </div>
          <p className="text-xs text-gray-500">{fill.specs} · from {fmtCur(fill.priceFrom)}/wk</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-gray-900">
            {fill.newFills}<span className="text-lg font-medium text-gray-400"> / {fill.target}</span>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400">weeks filled</p>
        </div>
      </div>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-[#3D7C4D] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-400">
        <span>{fmtPct(fill.progressPct, 0)} of goal</span>
        <span>baseline {fill.baseline} excluded</span>
      </div>

      {/* week calendar grouped by month */}
      <div className="mt-4 space-y-1.5">
        {groupByMonth(fill.weeks).map(([month, weeks]) => (
          <div key={month} className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-[10px] font-semibold uppercase text-gray-400">{month}</span>
            <div className="flex flex-wrap gap-1">
              {weeks.map((w) => <WeekChip key={w.startIso} w={w} />)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
        <LegendDot cls="bg-[#3D7C4D]" label="Booked" />
        <LegendDot cls="bg-amber-400" label="Paperwork" />
        <LegendDot cls="bg-gray-200" label="On request" />
        <LegendDot cls="border border-gray-300 bg-white" label="Open" />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 border-t pt-3 text-center">
        <Mini label="Booked" value={fill.confirmed} />
        <Mini label="Paperwork" value={fill.paperwork} />
        <Mini label="Open" value={fill.available} />
        <Mini label="2027 fwd" value={fill.forward2027} />
      </div>
    </div>
  )
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={cn('inline-block h-2.5 w-2.5 rounded-sm', cls)} />{label}</span>
}

/** Group weeks into [monthLabel, weeks[]] preserving chronological order. */
function groupByMonth(weeks: AvailWeek[]): [string, AvailWeek[]][] {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const order: string[] = []
  const map = new Map<string, AvailWeek[]>()
  for (const w of weeks) {
    const mi = Number((w.startIso || '').slice(5, 7)) - 1
    const key = MONTHS[mi] || '—'
    if (!map.has(key)) { map.set(key, []); order.push(key) }
    map.get(key)!.push(w)
  }
  return order.map((k) => [k, map.get(k)!])
}

function WeekChip({ w }: { w: AvailWeek }) {
  const color =
    w.status === 'booked' ? 'bg-[#3D7C4D] text-white border-[#3D7C4D]'
    : w.status === 'paperwork' ? 'bg-amber-400 text-white border-amber-400'
    : w.status === 'on_request' ? 'bg-gray-200 text-gray-500 border-gray-200'
    : 'bg-white text-gray-400 border-gray-200'
  const dd = w.label.slice(0, 5) // DD.MM
  return (
    <span
      className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium', color)}
      title={`${w.label} · ${w.status}${w.price ? ` · ${fmtCur(w.price)}` : ''}`}
    >
      {dd}
    </span>
  )
}

function Mini({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-base font-semibold text-gray-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  )
}

// ─── SECTION B: Blue / Red ──────────────────────────────────────────────────

function ColumnsSection({ data, batch, setBatch }: { data: TurkeyCampaignResult; batch: number; setBatch: (n: number) => void }) {
  const { columns: c, economics: e } = data
  const { tosca, belgin } = c.blue1
  const barMax = Math.max(tosca.rvc, belgin.rvc, c.blue2.rvc, c.red1.spend, 1)
  const C_TOSCA = '#1D4ED8', C_BELGIN = '#3B82F6', C_OTHER = '#93C5FD'
  const statusMap = {
    push: { label: 'PUSH HARD', cls: 'bg-green-100 text-green-700 border-green-200' },
    watch: { label: 'WATCH', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    pull: { label: 'EASE OFF', cls: 'bg-red-100 text-red-700 border-red-200' },
  }[c.status]

  // Cost vs Earnings: "So far" (batch 0) = real cumulative totals; "Per 5/10" = projection at the
  // current cost & earnings per booking. Mitja wants the macro 5–10-booking lens, not 1-booking obsession.
  const projecting = batch !== 0
  const n = e.totalBookings
  const cost = projecting ? e.costPerBooking * batch : c.red1.spend
  const earnings = projecting ? e.earningsPerBooking * batch : c.combinedBlue
  const net = earnings - cost

  return (
    <section>
      <SectionTitle n="B" title="Macro Scoreboard — Blue vs Red" subtitle="Mitja's rule: while Blue (booking value) stays near or above Red (spend), push hard. Goal = fill the fleet, not maximise ROI." />
      <div className="grid gap-4 lg:grid-cols-3">
        {/* The columns viz */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Booking value (Blue) vs Spend (Red)</h3>
              <InfoIcon text="Blue 1 = RVC from Tosca + Belgin bookings these campaigns drove (the goal). Blue 2 = RVC from OTHER yachts these campaigns produced (cross-pollination — counts too). Red 1 = this campaign's spend. While Blue 1 + Blue 2 stay near or above Red, we scale aggressively (Mitja)." />
            </div>
            <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold', statusMap.cls)}>{statusMap.label}</span>
          </div>

          <div className="mt-6 flex items-end justify-center gap-4 sm:gap-6" style={{ height: 220 }}>
            {/* Blue family — Tosca + Belgin are the goal (shown even at €0), other yachts = cross-poll */}
            <BarCol label="Tosca" sub={`${tosca.bookings} bk`} value={tosca.rvc} color={C_TOSCA} max={barMax} goal />
            <BarCol label="Belgin" sub={`${belgin.bookings} bk`} value={belgin.rvc} color={C_BELGIN} max={barMax} goal />
            <BarCol label="Other yachts" sub={`${c.blue2.bookings} bk`} value={c.blue2.rvc} color={C_OTHER} max={barMax} />
            {/* divider: blue (revenue) | red (cost) */}
            <div className="mx-1 h-full w-px self-stretch bg-gray-200" />
            <BarCol label="Spend" sub="this campaign" value={c.red1.spend} color={RED} max={barMax} />
          </div>
          <div className="mt-2 flex items-center justify-center gap-6 text-[10px] uppercase tracking-wide text-gray-400">
            <span>← Blue · booking value (total {fmtCur(c.combinedBlue)}) →</span>
            <span>Red · spend</span>
          </div>

          {/* Goal callout — Blue 1 is the real objective; surface it even (especially) at €0 */}
          <div className={cn('mt-3 rounded-lg px-3 py-2 text-xs', c.blue1.weeks > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
            {c.blue1.weeks > 0
              ? <>🎯 Target yachts: <b>{c.blue1.weeks} week{c.blue1.weeks > 1 ? 's' : ''}</b> booked on Tosca/Belgin ({fmtCur(c.blue1.rvc)}). The rest is cross-pollination onto other yachts.</>
              : <>🎯 Target yachts (Tosca/Belgin): <b>0 direct bookings yet</b> — spend is so far covered entirely by cross-pollination onto other yachts. Direct fills are what we're pushing for.</>}
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Blue covers Red <span className="font-semibold text-gray-900">{c.ratio.toFixed(2)}×</span> — every €1 spent has returned €{c.ratio.toFixed(2)} in booking value.
            Spend: FB {fmtCur(c.red1.fbSpend)} · Google {fmtCur(c.red1.googleSpend)}.
          </p>
        </div>

        {/* Economics */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Cost vs Earnings</h3>
              <InfoIcon text="Mitja's macro view: don't obsess over a single booking — zoom out to 5–10. 'So far' is the real cumulative total; 'Per 5/10' projects it forward at the current cost & earnings per booking (a target, not actual money)." />
            </div>
            <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
              {[{ label: 'So far', val: 0 }, { label: 'Per 5', val: 5 }, { label: 'Per 10', val: 10 }].map((b) => (
                <button key={b.val} onClick={() => setBatch(b.val)}
                  className={cn('rounded px-2 py-0.5 text-xs font-medium transition', batch === b.val ? 'bg-[#B39262] text-white' : 'text-gray-500 hover:bg-gray-100')}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {projecting
              ? `Projection · at ${batch} bookings (from ${n} so far)`
              : `Actual so far · ${n} booking${n === 1 ? '' : 's'}`}
          </p>

          <div className="mt-4 space-y-3">
            <EconRow label="Cost" value={fmtCur(cost)} color={RED} />
            <EconRow label="Earnings" value={fmtCur(earnings)} color={BLUE} />
            <div className="border-t pt-3">
              <EconRow label="Net" value={fmtCur(net)} color={net >= 0 ? '#3D7C4D' : RED} bold />
            </div>
          </div>

          {projecting ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              ⚠️ Projection only — extrapolated from {n} booking{n === 1 ? '' : 's'} at the current pace. A target, not actual revenue.
            </p>
          ) : (
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
              {earnings >= cost
                ? '✅ Earnings ≥ cost — fleet fills at break-even or better.'
                : '⚠️ Cost above earnings — acceptable during the fill push (Mitja: bookings over ROI).'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function BarCol({ label, sub, value, color, max, goal }: { label: string; sub: string; value: number; color: string; max: number; goal?: boolean }) {
  const pct = value > 0 ? Math.max(4, (value / max) * 100) : 1.5 // tiny sliver at €0 so the column still shows
  return (
    <div className="flex h-full w-16 flex-col items-center justify-end">
      <div className="w-full rounded-t-md transition-all" style={{ height: `${pct}%`, background: value > 0 ? color : '#E5E7EB' }} title={`${label}: ${fmtCur(value)}`} />
      <div className="mt-2 text-center">
        <div className="text-base font-bold text-gray-900">{fmtCur(value)}</div>
        <div className="flex flex-wrap items-center justify-center gap-1 text-[11px] text-gray-600">
          {label}
          {goal && <span className="rounded bg-[#B39262]/10 px-1 text-[8px] font-semibold uppercase tracking-wide text-[#8a6f43]">goal</span>}
        </div>
        <div className="text-[10px] text-gray-400">{sub}</div>
      </div>
    </div>
  )
}

function EconRow({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-gray-600">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}
      </span>
      <span className={cn('tabular-nums', bold ? 'text-lg font-bold' : 'text-base font-semibold', 'text-gray-900')}>{value}</span>
    </div>
  )
}

// ─── SECTION C: Yacht QL ────────────────────────────────────────────────────

function YachtQlSection({
  data, leadFilter, setLeadFilter, showAllLeads, setShowAllLeads,
}: {
  data: TurkeyCampaignResult
  leadFilter: 'all' | 'ql' | 'yachtql'
  setLeadFilter: (f: 'all' | 'ql' | 'yachtql') => void
  showAllLeads: boolean
  setShowAllLeads: (b: boolean) => void
}) {
  const { funnel: f, conditionFails: cf, perYachtQl, creatives, fbCampaigns, googleCampaigns, whenBreakdown: wb, hubspotMatched, traffic: tr, columns: cols } = data
  const spend = cols.red1.spend
  const revenue = cols.combinedBlue
  const cpm = tr.impressions > 0 ? (spend / tr.impressions) * 1000 : 0
  const ctr = tr.impressions > 0 ? (tr.clicks / tr.impressions) * 100 : 0
  const leadRate = tr.clicks > 0 ? (f.leads / tr.clicks) * 100 : 0
  const avgDeal = f.bookings > 0 ? revenue / f.bookings : 0
  const ratioLow = f.qlToYachtQl < 40
  const [yachtFilter, setYachtFilter] = useState<'all' | 'tosca' | 'belgin' | 'turkey'>('all')
  const [showAllCreatives, setShowAllCreatives] = useState(false)
  const [openLead, setOpenLead] = useState<string | null>(null)

  const failData = useMemo(() => [
    { name: 'Date ≠ 2026', count: cf.date },
    { name: 'Budget too low', count: cf.budget },
    { name: 'Group > capacity', count: cf.capacity },
    { name: 'Dest ≠ Turkey', count: cf.destination },
  ].sort((a, b) => b.count - a.count), [cf])

  const leads = useMemo(() => {
    let l = data.leads
    if (leadFilter === 'ql') l = l.filter((x) => x.isQl)
    if (leadFilter === 'yachtql') l = l.filter((x) => x.isYachtQl)
    if (yachtFilter !== 'all') l = l.filter((x) => x.yacht === yachtFilter)
    return l
  }, [data.leads, leadFilter, yachtFilter])

  return (
    <section>
      <SectionTitle n="C" title="Yacht QL — optimisation layer" subtitle="A lead is Yacht QL only if all 5 hold: AI≥50 · group ≤ capacity · budget fits · destination=Turkey · date in 2026." />

      {/* Full funnel — ad spend → booking (FB + Google, since 1 May) */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-1">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Full funnel — ad spend → booking</h3>
          <InfoIcon text="The whole journey across FB + Google, since 1 May. Impressions & link clicks combine FB (raw) + Google; LP views are FB-only so omitted to keep it cross-channel. Connectors show the cost or conversion rate between steps. Leads/QL onward from Streak." />
        </div>
        <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
          <FunnelStage value={fmtCur(spend)} label="Spend" />
          <FunnelArrow top={`€${cpm.toFixed(2)}`} sub="CPM" />
          <FunnelStage value={tr.impressions.toLocaleString()} label="Impressions" hint="awareness" />
          <FunnelArrow top={`${ctr.toFixed(1)}%`} sub="CTR" />
          <FunnelStage value={tr.clicks.toLocaleString()} label="Link clicks" />
          <FunnelArrow top={`${leadRate.toFixed(1)}%`} sub="Lead rate" />
          <FunnelStage value={f.leads.toLocaleString()} label="Leads" />
          <FunnelArrow top={fmtPct(f.leadToQl)} sub="QL rate" />
          <FunnelStage value={f.ql.toLocaleString()} label="QL" hint="AI ≥ 50" />
          <FunnelArrow top={fmtPct(f.qlToYachtQl)} sub="Yacht QL" />
          <FunnelStage value={f.yachtQl.toLocaleString()} label="Yacht QL" hint="all 5" />
          <FunnelArrow top={fmtPct(f.yachtQlToBooking)} sub="Close" />
          <FunnelStage value={f.bookings.toLocaleString()} label="Bookings" />
          <FunnelArrow top={fmtCur(avgDeal)} sub="avg deal" />
          <FunnelStage value={fmtCur(revenue)} label="Revenue" accent />
        </div>
      </div>

      {/* Ratio + when breakdown */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className={cn('rounded-xl border bg-white p-6 shadow-sm', ratioLow ? 'border-red-200' : 'border-green-200')}>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Yacht QL ratio</h3>
            <InfoIcon text="Yacht QL ÷ QL — share of quality leads that actually match Tosca/Belgin supply. Below 40% for 2 weeks → refresh creative/targeting (not budget cut)." />
          </div>
          <div className={cn('mt-2 text-4xl font-bold', ratioLow ? 'text-red-600' : 'text-green-600')}>{fmtPct(f.qlToYachtQl)}</div>
          <p className="mt-1 text-xs text-gray-500">{ratioLow ? '⚠️ Below 40% trigger — refresh creative/targeting.' : '✅ Above 40% — audience matches supply.'}</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Why QL leads miss Yacht QL</h3>
            <InfoIcon text="Among AI-qualified leads, which condition disqualifies them. The tallest bar is your biggest optimisation lever." />
          </div>
          <div className="mt-2 h-44">
            <ResponsiveContainer>
              <BarChart data={failData} layout="vertical" margin={{ left: 20, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11 }}>
                  {failData.map((_, i) => <Cell key={i} fill={i === 0 ? RED : ACCENT} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Desired-date data quality: {wb.y2026} say 2026 · {wb.none} no year (counted as 2026) · {wb.future} explicit 2027+ (excluded).
          </p>
        </div>
      </div>

      {/* Per-yacht QL table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Per-yacht breakdown</h3>
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase text-gray-500">
              <th className="py-2 px-3">Yacht</th>
              <th className="py-2 px-3 text-right">Leads</th>
              <th className="py-2 px-3 text-right">QL</th>
              <th className="py-2 px-3 text-right">Yacht QL</th>
              <th className="py-2 px-3 text-right">Yacht QL %</th>
            </tr>
          </thead>
          <tbody>
            {perYachtQl.map((y, i) => (
              <tr key={y.id} className={cn('border-b last:border-0', i % 2 ? 'bg-[#F9FAFB]' : 'bg-white')}>
                <td className="py-2 px-3 font-medium text-gray-900">{y.name}</td>
                <td className="py-2 px-3 text-right text-gray-700">{y.leads}</td>
                <td className="py-2 px-3 text-right text-gray-700">{y.ql}</td>
                <td className="py-2 px-3 text-right text-gray-700">{y.yachtQl}</td>
                <td className={cn('py-2 px-3 text-right font-medium', y.ql === 0 ? 'text-gray-300' : y.yachtQlRatio < 40 ? 'text-red-600' : 'text-green-600')}>{y.ql === 0 ? '—' : fmtPct(y.yachtQlRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FB Ads — campaign level */}
      <CampaignTable
        title="Facebook Ads — campaign level"
        channel="facebook"
        rows={fbCampaigns}
        hint="Turkey FB campaigns. Spend from fb_ads_enriched; leads/QL/Yacht QL from Streak mapped to campaign via fuzzy match (source_placement → campaign)."
      />

      {/* Google Ads — campaign level */}
      <CampaignTable
        title="Google Ads — campaign level"
        channel="google"
        rows={googleCampaigns}
        hint="Turkey Google campaigns. Spend from daily; leads/QL/Yacht QL from Streak grouped by source_detail (the search campaign). Search terms roll up to the campaign."
      />

      {/* FB ad performance (creative / ad-set level) */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">FB ad performance <span className="text-gray-400 normal-case">(creative / ad-set level)</span></h3>
            <InfoIcon text="FB creatives (Streak source_placement = ad-set) joined Streak↔HubSpot by email. Which creative produces Yacht QL — scale/kill view for Simi. No per-ad spend (FB ad-level spend isn't synced; Streak is ad-set level) — spend is in the FB campaign table above. Yacht: tosca→Tosca, belgin→Belgin (pre-launch), else→General." />
            <span className="ml-1 rounded bg-[#B39262]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#8a6f43]">via HubSpot</span>
          </div>
          <span className="text-[11px] text-gray-400">{hubspotMatched}/{f.leads} leads HubSpot-matched</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase text-gray-500">
                <th className="py-2 px-2">Thumb</th>
                <th className="py-2 px-2">Creative (utm_campaign)</th>
                <th className="py-2 px-2">Yacht</th>
                <th className="py-2 px-2 text-right">Ads</th>
                <th className="py-2 px-2 text-right">Leads</th>
                <th className="py-2 px-2 text-right">QL</th>
                <th className="py-2 px-2 text-right">Yacht QL</th>
                <th className="py-2 px-2 text-right">Yacht QL%</th>
                <th className="py-2 px-2">Top LP</th>
              </tr>
            </thead>
            <tbody>
              {(showAllCreatives ? creatives : creatives.slice(0, 10)).map((c, idx) => (
                <tr key={c.creative} className={cn('border-b last:border-0', idx % 2 ? 'bg-[#F9FAFB]' : 'bg-white')}>
                  <td className="py-2 px-2"><Thumb c={c} /></td>
                  <td className="py-2 px-2 max-w-[280px]">
                    <span className="block truncate font-medium text-gray-900" title={c.creative}>{c.creative}</span>
                  </td>
                  <td className="py-2 px-2"><YachtTag yacht={c.yacht} /></td>
                  <td className="py-2 px-2 text-right text-gray-500">{c.ads || '—'}</td>
                  <td className="py-2 px-2 text-right text-gray-700">{c.leads}</td>
                  <td className="py-2 px-2 text-right text-gray-700">{c.ql}</td>
                  <td className="py-2 px-2 text-right text-gray-700">{c.yachtQl}</td>
                  <td className={cn('py-2 px-2 text-right font-medium', c.ql === 0 ? 'text-gray-300' : c.yachtQlRate < 40 ? 'text-red-600' : 'text-green-600')}>
                    {c.ql === 0 ? '—' : fmtPct(c.yachtQlRate)}
                  </td>
                  <td className="py-2 px-2 text-[11px] text-gray-400 max-w-[200px] truncate" title={c.topLp}>{c.topLp ? c.topLp.replace(/^https?:\/\/[^/]+/, '') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {creatives.length > 10 && (
          <button onClick={() => setShowAllCreatives(!showAllCreatives)} className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            {showAllCreatives ? 'Show less' : `See all ${creatives.length} creatives`}
          </button>
        )}
        <p className="mt-2 text-[11px] text-gray-400">Thumbnails matched from Meta (fb_ads_level) by creative-name overlap — best-effort, blank when no confident match. Meta thumbnail URLs expire; refreshed on the FB sync.</p>
      </div>

      {/* Lead diagnostic table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Lead diagnostic</h3>
            <InfoIcon text="Each lead with its 5 Yacht QL conditions (green = pass, red = fail). Click a row to expand: how they filled the form (Streak answers) + how they arrived (HubSpot — form name, entry page, source, ad)." />
            <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">via Streak + HubSpot · click a row</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
              {(['all', 'tosca', 'belgin', 'turkey'] as const).map((yf) => (
                <button key={yf} onClick={() => setYachtFilter(yf)}
                  className={cn('rounded px-2.5 py-0.5 text-xs font-medium capitalize transition', yachtFilter === yf ? 'bg-[#121212] text-white' : 'text-gray-500 hover:bg-gray-100')}>
                  {yf === 'turkey' ? 'Generic' : yf}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
              {(['all', 'ql', 'yachtql'] as const).map((ff) => (
                <button key={ff} onClick={() => setLeadFilter(ff)}
                  className={cn('rounded px-2.5 py-0.5 text-xs font-medium transition', leadFilter === ff ? 'bg-[#B39262] text-white' : 'text-gray-500 hover:bg-gray-100')}>
                  {ff === 'all' ? 'All' : ff === 'ql' ? 'QL' : 'Yacht QL'}
                </button>
              ))}
            </div>
            <span className="text-sm text-gray-500">{leads.length} rows</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b text-left text-[11px] uppercase text-gray-500">
                <th className="py-2 px-2">Inquiry</th>
                <th className="py-2 px-2">Name</th>
                <th className="py-2 px-2">Yacht</th>
                <th className="py-2 px-2 text-center">AI</th>
                <th className="py-2 px-2 text-center">Group</th>
                <th className="py-2 px-2 text-center">Budget</th>
                <th className="py-2 px-2 text-center">Turkey</th>
                <th className="py-2 px-2 text-center">2026</th>
                <th className="py-2 px-2 text-center">Yacht QL</th>
              </tr>
            </thead>
            <tbody>
              {(showAllLeads ? leads : leads.slice(0, 12)).map((lead, idx) => {
                const rowKey = `${lead.name}-${lead.inquiry_date}-${idx}`
                const open = openLead === rowKey
                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      onClick={() => setOpenLead(open ? null : rowKey)}
                      className={cn('cursor-pointer border-b last:border-0 hover:bg-[#F4EEE2]', idx % 2 ? 'bg-[#F9FAFB]' : 'bg-white', lead.isYachtQl && !open ? 'bg-[#FEFCE8]' : '', open ? 'bg-[#F4EEE2]' : '')}
                    >
                      <td className="py-2 px-2 text-gray-600">{formatDate(lead.inquiry_date)}</td>
                      <td className="py-2 px-2 font-medium text-gray-900 max-w-[160px] truncate" title={lead.name}>
                        <span className="mr-1 text-gray-400">{open ? '▾' : '▸'}</span>{lead.name || '—'}
                      </td>
                      <td className="py-2 px-2 capitalize text-gray-600">{lead.yacht}</td>
                      <td className="py-2 px-2 text-center"><AiBadge score={lead.ai_score} pass={lead.passAi} /></td>
                      <td className="py-2 px-2 text-center"><CondCell pass={lead.passCapacity} label={lead.size_of_group != null ? String(lead.size_of_group) : '—'} /></td>
                      <td className="py-2 px-2 text-center"><CondCell pass={lead.passBudget} label={formatBudgetRange(lead.budget_range)} /></td>
                      <td className="py-2 px-2 text-center"><CondIcon pass={lead.passDestination} /></td>
                      <td className="py-2 px-2 text-center"><CondCell pass={lead.passDate} label={lead.when ? (lead.when.length > 10 ? lead.when.slice(0, 10) + '…' : lead.when) : '—'} /></td>
                      <td className="py-2 px-2 text-center">{lead.isYachtQl ? <Check className="mx-auto h-4 w-4 text-green-600" /> : <X className="mx-auto h-4 w-4 text-gray-300" />}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className="p-0"><LeadDetail lead={lead} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {leads.length > 12 && (
          <button onClick={() => setShowAllLeads(!showAllLeads)} className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            {showAllLeads ? 'Show less' : `See all ${leads.length}`}
          </button>
        )}
      </div>
    </section>
  )
}

function AiBadge({ score, pass }: { score: number; pass: boolean }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold',
      pass ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600')}>
      {score || 0}
    </span>
  )
}

function CondCell({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
      pass ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500')}>
      {pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{label}
    </span>
  )
}

function CondIcon({ pass }: { pass: boolean }) {
  return pass ? <Check className="mx-auto h-4 w-4 text-green-600" /> : <X className="mx-auto h-4 w-4 text-red-400" />
}

function DetailField({ label, value }: { label: string; value?: string | number | null }) {
  const show = value !== undefined && value !== null && value !== ''
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-[13px] text-gray-800 break-words">{show ? value : '—'}</div>
    </div>
  )
}

function LeadDetail({ lead }: { lead: YachtQlLead }) {
  const d = lead.hsDetail
  return (
    <div className="border-y border-[#e8dcc4] bg-[#FAF7F0] px-4 py-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* What they want — Streak form answers */}
        <div className="rounded-lg border border-[#e8dcc4] bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Their answers <span className="font-normal text-gray-400">· Streak form</span></div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <DetailField label="Email" value={lead.name} />
            <DetailField label="Country" value={lead.country} />
            <DetailField label="Destination" value={lead.destination} />
            <DetailField label="Group size" value={lead.size_of_group} />
            <DetailField label="Budget" value={lead.budget_range} />
            <DetailField label="Desired dates" value={lead.when} />
            <DetailField label="AI score" value={lead.ai_score} />
            <DetailField label="Stage" value={lead.stage} />
          </div>
        </div>
        {/* How they arrived — HubSpot */}
        <div className="rounded-lg border border-[#e8dcc4] bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">How they arrived <span className="font-normal text-gray-400">· HubSpot</span></div>
          {d ? (
            <div className="space-y-2.5">
              <DetailField label="Form submitted" value={d.formName} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <DetailField label="Entry page" value={d.firstUrlPath} />
                <DetailField label="Last page" value={d.lastUrlPath} />
                <DetailField label="Source" value={[d.source, d.sourceDetail].filter(Boolean).join(' · ')} />
                <DetailField label="Created" value={d.createdate ? new Date(d.createdate).toLocaleDateString('en-GB') : ''} />
                <DetailField label="Ad (utm_content)" value={d.utmContent} />
                <DetailField label="Campaign" value={d.utmCampaign} />
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-gray-400">Not matched in HubSpot — Streak data only.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function SectionTitle({ n, title, subtitle }: { n: string; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#121212] text-sm font-semibold text-white">{n}</span>
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </div>
  )
}

function InfoIcon({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-1">
      <Info className="h-[15px] w-[15px] text-gray-400" aria-label={text} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md bg-[#1A1A2E] px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block" role="tooltip">
        {text}
        <span className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#1A1A2E]" />
      </span>
    </span>
  )
}

function Thumb({ c }: { c: CreativeRow }) {
  const [err, setErr] = useState(false)
  if (c.thumbnail && !err) {
    // referrerPolicy="no-referrer" — Meta scontent CDN 403s thumbnails when a referrer is sent
    // (this is why they showed broken; the FB Ads section already does this). onError degrades
    // to the placeholder if a URL has genuinely expired instead of showing a broken-image icon.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.thumbnail} alt={c.creative} referrerPolicy="no-referrer" onError={() => setErr(true)} className="h-9 w-12 rounded object-cover" />
  }
  return <div className="flex h-9 w-12 items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-[9px] text-gray-300">—</div>
}

function ChannelChip({ channel }: { channel: 'google' | 'facebook' }) {
  return channel === 'google'
    ? <span className="shrink-0 rounded bg-[#4285F4]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1a73e8]" title="Google Search — search terms rolled up to the campaign">GOOGLE</span>
    : <span className="shrink-0 rounded bg-[#1877F2]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1877F2]" title="Facebook / Instagram ad creative">FB</span>
}

function CampaignTable({ title, channel, rows, hint }: { title: string; channel: 'google' | 'facebook'; rows: CampaignRow[]; hint: string }) {
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0)
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0)
  const totalQl = rows.reduce((s, r) => s + r.ql, 0)
  const totalYachtQl = rows.reduce((s, r) => s + r.yachtQl, 0)
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ChannelChip channel={channel} />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
          <InfoIcon text={hint} />
        </div>
        <span className="text-[11px] text-gray-400">{fmtCur(totalSpend)} spend · {totalLeads} leads · {totalQl} QL · {totalYachtQl} Yacht QL</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase text-gray-500">
              <th className="py-2 px-2">Campaign</th>
              <th className="py-2 px-2 text-right">Spend</th>
              <th className="py-2 px-2 text-right">Leads</th>
              <th className="py-2 px-2 text-right">QL</th>
              <th className="py-2 px-2 text-right">Yacht QL</th>
              <th className="py-2 px-2 text-right">QL%</th>
              <th className="py-2 px-2 text-right">CPL</th>
              <th className="py-2 px-2 text-right">CPQL</th>
              <th className="py-2 px-2 text-right">CP Yacht QL</th>
              <th className="py-2 px-2 text-right">Avg AI</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-4 text-center text-gray-400">No campaigns in range</td></tr>
            )}
            {rows.map((r, idx) => (
              <tr key={r.campaign} className={cn('border-b last:border-0', idx % 2 ? 'bg-[#F9FAFB]' : 'bg-white')}>
                <td className="py-2 px-2 font-medium text-gray-900 max-w-[260px] truncate" title={r.campaign}>{r.campaign}</td>
                <td className="py-2 px-2 text-right font-medium text-gray-900">{fmtCur(r.spend)}</td>
                <td className="py-2 px-2 text-right text-gray-700">{r.leads}</td>
                <td className="py-2 px-2 text-right text-gray-700">{r.ql}</td>
                <td className="py-2 px-2 text-right text-gray-700">{r.yachtQl}</td>
                <td className="py-2 px-2 text-right text-gray-500">{r.leads ? fmtPct(r.qlRate, 0) : '—'}</td>
                <td className="py-2 px-2 text-right text-gray-500">{r.leads ? fmtCur(r.cpl) : '—'}</td>
                <td className="py-2 px-2 text-right text-gray-500">{r.ql ? fmtCur(r.cpql) : '—'}</td>
                <td className={cn('py-2 px-2 text-right font-medium', r.yachtQl ? 'text-gray-900' : 'text-gray-300')}>{r.yachtQl ? fmtCur(r.cpYachtQl) : '—'}</td>
                <td className="py-2 px-2 text-right text-gray-500">{r.avgAi || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function YachtTag({ yacht }: { yacht: 'tosca' | 'belgin' | 'turkey' }) {
  const map = {
    tosca: { label: 'Tosca', cls: 'bg-[#B39262]/15 text-[#8a6f43]' },
    belgin: { label: 'Belgin', cls: 'bg-blue-50 text-blue-600' },
    turkey: { label: 'General', cls: 'bg-gray-100 text-gray-500' },
  }[yacht]
  return <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium', map.cls)}>{map.label}</span>
}

function FunnelStage({ value, label, hint, accent }: { value: string; label: string; hint?: string; accent?: boolean }) {
  return (
    <div className="min-w-[92px] flex-1 rounded-lg border border-[#e8dcc4] bg-white p-3 text-center shadow-sm">
      <div className={cn('text-xl font-bold', accent ? 'text-[#B39262]' : 'text-gray-900')}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {hint && <div className="mt-0.5 text-[9px] uppercase tracking-wide text-gray-400">{hint}</div>}
    </div>
  )
}

function FunnelArrow({ top, sub }: { top: string; sub: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center px-0.5">
      <span className="text-gray-300">→</span>
      <span className="whitespace-nowrap text-[11px] font-medium text-gray-600">{top}</span>
      <span className="text-[9px] uppercase tracking-wide text-gray-400">{sub}</span>
    </div>
  )
}
