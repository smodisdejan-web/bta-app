'use client'

/* ============================================================
   MTD SHARED — types, formatters, and presentational primitives
   Native bta visual system (ivory bg, white cards, gold #B39262,
   Cormorant serif headings). Structure mirrors goolets-reports /mtd.
   ============================================================ */

import React from 'react'
import { Search, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ZONE_STYLES, zoneForCac, type Zone } from '@/lib/zones'
import { MONTHS } from '@/data/months'

/* ---------- Search normalizer (case + diacritic insensitive) ---------- */
export function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/* ---------- Types (mtd-data.json schema) ---------- */

export type MarketKey = 'all' | 'Croatia/Other' | 'Turkey'
export type CampaignMarket = 'Croatia/Other' | 'Turkey'

export interface BookingCell { bookings: number; revenue: number }
export interface ScoredCell { scored: number; quality: number }

export interface FbTotals {
  spend: number; clicks: number; lpViews: number; landingLeads: number
  streakLeads: number; quality: number; attributedLeads: number
  attributedQuality: number; qRate: number; cpql: number
}
export interface GoogleTotals extends Omit<FbTotals, 'lpViews' | 'landingLeads'> {
  conv: number
}

export interface FbCampaign {
  name: string; spend: number; clicks: number; ctr: number; impressions: number
  lpViews: number; landingLeads: number; status: string; streakLeads: number
  qualityTracked: boolean; quality: number; excellent: number; qRate: number
  avgAI: number; cpql: number; cpl: number; market: CampaignMarket
}
export interface FbAdset {
  id: string; name: string; status: string; campaign_name: string
  spend: number; clicks: number; ctr: number; impressions: number
  landing_leads: number; cpl: number
}
export interface CopyVariant {
  text: string; spend: number; impressions: number; clicks: number; ctr: number
}
export interface FbAd {
  id: string; adset_id: string; name: string; status: string; spend: number
  impressions: number; clicks: number; ctr: number; landing_leads: number; cpl: number
  hook_rate: number | null; hold_rate: number | null; body: string; title: string
  cta: string; thumbnail_url: string | null; thumb: string | null; is_video: boolean
  drive_url?: string | null; drive_confidence?: string | null
  body_variants?: CopyVariant[]; title_variants?: CopyVariant[]
}
export interface GCampaign {
  name: string; spend: number; conv: number; clicks: number; impressions: number
  type: string; streakLeads: number; quality: number; qRate: number; avgAI: number
  cpql: number; convRate: number; market: CampaignMarket
}

export interface MtdData {
  month: string
  generated: string
  bookings: { fb: Record<MarketKey, BookingCell>; google: Record<MarketKey, BookingCell> }
  totals: { fb: FbTotals; google: GoogleTotals; combined: Record<string, number> }
  streakTotals: { fb: Record<MarketKey, ScoredCell>; google: Record<MarketKey, ScoredCell> }
  fbCampaigns: FbCampaign[]
  adsets: FbAdset[]
  ads: FbAd[]
  gCampaigns: GCampaign[]
  fbUnmatchedSources: string[]
  meta: { fbLeadsAI: number; gLeads: number; gMatched: number; driveMatched: number; corruptRowsDropped: unknown[] }
}

/* ---------- Market chips ---------- */

export const MARKET_CHIPS: { key: MarketKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'Croatia/Other', label: 'Croatia / Other' },
  { key: 'Turkey', label: 'Turkey' },
]

export function inMarket(market: CampaignMarket, filter: MarketKey): boolean {
  return filter === 'all' || market === filter
}

/* ---------- Formatters ---------- */

export function eur(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '–'
  return `€${Math.round(n).toLocaleString('en-US')}`
}
export function eur2(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '–'
  return `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function intFmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '–'
  return Math.round(n).toLocaleString('en-US')
}
export function pct1(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '–'
  return `${n.toFixed(1)}%`
}
export function pct0(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '–'
  return `${Math.round(n)}%`
}

/* ---------- Page header (bta pattern) ---------- */

export function PageHeader({
  icon, iconBg, title, eyebrow, subtitle, through,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  eyebrow: string
  subtitle: string
  through: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md"
          style={{ backgroundColor: iconBg, boxShadow: `0 4px 14px ${iconBg}33` }}
        >
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-4xl tracking-tight text-gray-900">{title}</h1>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#B39262] font-medium mt-2">{eyebrow}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>
      </div>
      <div className="text-xs text-gray-400 mt-2">Data through {through}</div>
    </div>
  )
}

/* ---------- Market toggle ---------- */

export function MarketToggle({ value, onChange }: { value: MarketKey; onChange: (m: MarketKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Market filter">
      {MARKET_CHIPS.map((chip) => {
        const active = value === chip.key
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.key)}
            className={cn(
              'text-sm font-semibold px-3.5 py-1.5 rounded-full border transition-colors',
              active
                ? 'bg-[#B39262] text-white border-[#B39262]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#B39262]/50'
            )}
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Month picker ---------- */

export function MonthPicker({
  value, onChange,
}: { value: string; onChange: (k: string) => void }) {
  const months = MONTHS
  if (months.length <= 1) return null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Month">
      {months.map((m) => {
        const active = value === m.key
        return (
          <button
            key={m.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(m.key)}
            className={cn(
              'text-sm font-semibold px-3.5 py-1.5 rounded-full border transition-colors',
              active
                ? 'bg-[#B39262] text-white border-[#B39262]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#B39262]/50'
            )}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Bookings strip ---------- */

export function BookingsStrip({ cell, periodLabel }: { cell: BookingCell; periodLabel?: string }) {
  const closed = periodLabel ? `closed in ${periodLabel}` : 'closed this month'
  return (
    <Card className="p-5 bg-white">
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-8">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold">Bookings</div>
            <div className="text-3xl font-semibold text-gray-900 tabular-nums mt-0.5">{intFmt(cell.bookings)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold">RVC</div>
            <div className="text-3xl font-semibold text-[#B39262] tabular-nums mt-0.5">{eur(cell.revenue)}</div>
          </div>
        </div>
        <p className="text-xs text-gray-400 max-w-xs">
          Charters <strong className="text-gray-500">{closed}</strong> — a lagging KPI, not attributable to that
          period&apos;s spend. No ROAS.
        </p>
      </div>
    </Card>
  )
}

/* ---------- KPI tile + row ---------- */

export function KpiTile({
  label, value, sub, accent,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="p-4 bg-white">
      <div className="text-[10px] uppercase tracking-[0.1em] text-gray-400 font-semibold">{label}</div>
      <div className={cn('text-3xl font-semibold tabular-nums mt-1', accent ? 'text-[#B39262]' : 'text-gray-900')}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
    </Card>
  )
}

/* ---------- Horizontal funnel ---------- */

export interface FunnelStep { label: string; value: string; sub?: string }
export interface FunnelConn { label: string; rate: string }

export function Funnel({ steps, conns }: { steps: FunnelStep[]; conns: FunnelConn[] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-stretch min-w-min gap-1">
        {steps.map((s, i) => (
          <React.Fragment key={s.label}>
            <div className="flex-1 min-w-[104px] bg-white rounded-lg border shadow-sm px-3 py-3 text-center">
              <div className="text-xl font-semibold text-gray-900 tabular-nums leading-none">{s.value}</div>
              <div className="text-[10px] uppercase tracking-[0.04em] text-gray-400 font-semibold mt-1.5">{s.label}</div>
              {s.sub && <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{s.sub}</div>}
            </div>
            {i < conns.length && (
              <div className="flex flex-col items-center justify-center px-1 min-w-[54px] shrink-0">
                <span className="text-gray-300 text-sm leading-none">→</span>
                <span className="text-[11px] font-semibold text-gray-500 mt-0.5">{conns[i].rate}</span>
                <span className="text-[9px] uppercase tracking-[0.03em] text-gray-400">{conns[i].label}</span>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

/* ---------- Zone scorecards ---------- */

export function CpqlZoneCard({ cpql, blendedNote = 'blended' }: { cpql: number; blendedNote?: string }) {
  const zone: Zone | null = cpql > 0 ? zoneForCac(cpql) : null
  const style = zone ? ZONE_STYLES[zone] : null
  return (
    <Card
      className="p-5"
      style={{ backgroundColor: style?.bg || '#fbf6ea', borderColor: style?.border || '#e8d5b0', borderLeftWidth: 3 }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: style?.text || '#8B7355' }}>CPQL</span>
        {style && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide text-white" style={{ backgroundColor: style.border }}>
            {style.label}
          </span>
        )}
      </div>
      <div className="text-3xl font-semibold tabular-nums" style={{ color: style?.text || '#8B4513' }}>{eur2(cpql)}</div>
      <div className="text-[11px] text-gray-500 mt-1.5">
        {blendedNote} · €96 scale · €150 maintain · €240 cut
      </div>
    </Card>
  )
}

export function QualityRateCard({ qRate, scored }: { qRate: number; scored: number }) {
  const good = qRate >= 45
  return (
    <Card className="p-5 bg-white" style={{ borderLeftWidth: 3, borderLeftColor: good ? '#047857' : '#d97706' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-600">Quality Rate</span>
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
          style={{ backgroundColor: good ? '#ecfdf5' : '#fef3c7', color: good ? '#047857' : '#92400e' }}
        >
          {good ? 'ON TARGET' : 'BELOW'}
        </span>
      </div>
      <div className="text-3xl font-semibold tabular-nums text-gray-900">{pct0(qRate)}</div>
      <div className="text-[11px] text-gray-500 mt-1.5">of {intFmt(scored)} CRM-scored · target ≥45%</div>
    </Card>
  )
}

export function NeutralStatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5 bg-white">
      <div className="text-xs font-semibold text-gray-600 mb-1">{label}</div>
      <div className="text-3xl font-semibold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1.5">{sub}</div>}
    </Card>
  )
}

/* ---------- Section eyebrow ---------- */

export function Eyebrow({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mt-2">
      <span className="text-[10px] uppercase tracking-[0.25em] text-[#B39262] font-semibold">{children}</span>
      {sub && <span className="text-xs text-gray-400 ml-2 normal-case tracking-normal">{sub}</span>}
    </div>
  )
}

/* ---------- Market badge ---------- */

export function MarketBadge({ market }: { market: CampaignMarket }) {
  const turkey = market === 'Turkey'
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded border"
      style={{
        borderColor: turkey ? '#a78bef55' : '#77a8d055',
        color: turkey ? '#6d4fc4' : '#3f6f9c',
        backgroundColor: turkey ? '#a78bef14' : '#77a8d014',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: turkey ? '#7a5cd6' : '#4b7ea8' }} />
      {turkey ? 'Turkey' : 'Croatia / Other'}
    </span>
  )
}

/* ---------- Verdict badge (zones.ts logic; Turkey ungraded) ---------- */

const MIN_SPEND = 300
const MIN_LEADS = 5

export type Verdict =
  | { kind: 'turkey' }
  | { kind: 'early' }
  | { kind: 'untracked' }
  | { kind: 'zone'; zone: Zone }

export function campaignVerdict(c: { market: CampaignMarket; spend: number; landingLeads: number; qualityTracked: boolean; cpql: number }): Verdict {
  if (c.market === 'Turkey') return { kind: 'turkey' }
  if (c.spend < MIN_SPEND || c.landingLeads < MIN_LEADS) return { kind: 'early' }
  if (!c.qualityTracked || c.cpql <= 0) return { kind: 'untracked' }
  return { kind: 'zone', zone: zoneForCac(c.cpql) }
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict.kind === 'turkey') {
    return (
      <span className="text-[10px] font-bold tracking-[0.04em] px-2 py-1 rounded" style={{ color: '#6d4fc4', backgroundColor: '#a78bef1f' }}>
        TURKEY TARGETS
      </span>
    )
  }
  if (verdict.kind === 'early') {
    return <span className="text-[10px] font-bold tracking-[0.04em] px-2 py-1 rounded bg-gray-100 text-gray-500">TOO EARLY</span>
  }
  if (verdict.kind === 'untracked') {
    return <span className="text-[10px] font-bold tracking-[0.04em] px-2 py-1 rounded bg-gray-100 text-gray-500">NO QL YET</span>
  }
  const style = ZONE_STYLES[verdict.zone]
  return (
    <span className="text-[10px] font-bold tracking-[0.04em] px-2 py-1 rounded" style={{ color: style.text, backgroundColor: style.bg }}>
      {style.label}
    </span>
  )
}

/* CPQL colored text (campaign tile / adset) — neutral for Turkey */
export function cpqlColor(cpql: number, turkey: boolean): string {
  if (turkey || cpql <= 0) return '#7e8ea0'
  return ZONE_STYLES[zoneForCac(cpql)].text
}

/* ---------- Footer meta ---------- */

export function FooterMeta({
  driveMatched, unmatchedCount, corruptDropped, month, generated,
}: { driveMatched?: number; unmatchedCount?: number; corruptDropped: number; month: string; generated: string }) {
  const items: { label: string; value: string }[] = []
  if (driveMatched != null) items.push({ label: 'Drive-matched creatives', value: intFmt(driveMatched) })
  if (unmatchedCount != null) items.push({ label: 'Unmatched source variants', value: intFmt(unmatchedCount) })
  items.push({ label: 'Corrupt rows dropped', value: intFmt(corruptDropped) })
  items.push({ label: 'Month', value: month })
  items.push({ label: 'Generated', value: generated })
  return (
    <Card className="p-5 bg-white">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-[10px] uppercase tracking-[0.1em] text-gray-400 font-semibold">{it.label}</div>
            <div className="text-sm text-gray-700 tabular-nums mt-0.5">{it.value}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ---------- Search input (gold focus ring) ---------- */

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full md:max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 focus-visible:ring-[#B39262] focus-visible:ring-2"
        aria-label={placeholder}
      />
    </div>
  )
}

/* ---------- Sort chips (card-row layouts, e.g. FB campaign list) ---------- */

export type SortDir = 'asc' | 'desc'

export function SortChips<T extends string>({
  options, field, dir, onSort,
}: {
  options: { key: T; label: string }[]
  field: T
  dir: SortDir
  onSort: (k: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-gray-400 font-semibold mr-0.5">Sort</span>
      {options.map((o) => {
        const active = field === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSort(o.key)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors',
              active
                ? 'bg-[#B39262] text-white border-[#B39262]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#B39262]/50'
            )}
          >
            {o.label}
            {active && (dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Sort arrow (table headers) ---------- */

export function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="inline-block w-3" />
  return dir === 'desc'
    ? <ArrowDown className="h-3 w-3 ml-1 inline text-[#B39262]" />
    : <ArrowUp className="h-3 w-3 ml-1 inline text-[#B39262]" />
}
