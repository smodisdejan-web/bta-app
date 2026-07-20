'use client'

import React, { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  eur, eur2, pct1, pct0, intFmt, cpqlColor, norm,
  MarketBadge, VerdictBadge, campaignVerdict, type SortDir,
  type FbCampaign, type FbAdset, type FbAd,
} from './mtd-shared'
import { CreativeCard } from './CreativeCard'

export type FbSortField = 'spend' | 'landingLeads' | 'quality' | 'qRate' | 'cpql'

export const FB_SORT_OPTIONS: { key: FbSortField; label: string }[] = [
  { key: 'spend', label: 'Spend' },
  { key: 'landingLeads', label: 'Leads' },
  { key: 'quality', label: 'QL' },
  { key: 'qRate', label: 'QL%' },
  { key: 'cpql', label: 'CPQL' },
]

/* ---- Campaign comparator (untracked / zero CPQL always sinks to bottom) ---- */
function compareCampaigns(a: FbCampaign, b: FbCampaign, field: FbSortField, dir: SortDir): number {
  const mul = dir === 'desc' ? -1 : 1
  if (field === 'cpql') {
    const av = a.qualityTracked && a.cpql > 0 ? a.cpql : null
    const bv = b.qualityTracked && b.cpql > 0 ? b.cpql : null
    if (av == null && bv == null) return b.spend - a.spend
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * mul
  }
  const pick = (c: FbCampaign): number =>
    field === 'landingLeads' ? c.landingLeads
    : field === 'quality' ? c.quality
    : field === 'qRate' ? c.qRate
    : c.spend
  const diff = (pick(a) - pick(b)) * mul
  return diff !== 0 ? diff : b.spend - a.spend
}

/* ---- Computed view models ---- */
interface AdsetView {
  adset: FbAdset
  ads: FbAd[]
  matchedAdIds: Set<string>
  adsetMatch: boolean
  autoOpen: boolean
}
interface CampaignView {
  c: FbCampaign
  adsetViews: AdsetView[]
  campMatch: boolean
  autoOpen: boolean
}

/* ---- Highlighted name ---- */
function HName({ text, match, className }: { text: string; match: boolean; className?: string }) {
  return <span className={cn(className, match && 'text-[#B39262]')} title={text}>{text}</span>
}

/* ---- Campaign metric tile ---- */
function CTile({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="text-right min-w-[64px]">
      <div className="text-[9.5px] uppercase tracking-[0.03em] text-gray-400 font-semibold">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="text-[9px] text-gray-400 leading-tight">{sub}</div>}
    </div>
  )
}

/* ---- Adset row (level 2) → expands to creative cards (level 3) ---- */
function AdsetRow({ view, turkey, searchActive }: { view: AdsetView; turkey: boolean; searchActive: boolean }) {
  const { adset, ads, matchedAdIds, adsetMatch, autoOpen } = view
  const [localOpen, setLocalOpen] = useState(false)
  const open = searchActive ? (autoOpen || localOpen) : localOpen
  const active = adset.status === 'ACTIVE'
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => ads.length > 0 && setLocalOpen((v) => !v)}
        className={cn('w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-left', ads.length > 0 && 'cursor-pointer hover:bg-gray-50')}
      >
        <div className="flex items-center gap-2 min-w-[200px] flex-1">
          {ads.length > 0
            ? <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform', open && 'rotate-90')} />
            : <span className="w-3.5 shrink-0" />}
          <HName text={adset.name} match={adsetMatch} className="text-[12.5px] font-semibold text-gray-800 truncate" />
          <span className={cn('text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded shrink-0', active ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-gray-100 text-gray-500')}>
            {active ? 'ACTIVE' : 'PAUSED'}
          </span>
          {ads.length > 0 && <span className="text-[10px] text-gray-400 shrink-0">{ads.length} ad{ads.length === 1 ? '' : 's'}</span>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 ml-auto">
          <CTile label="Spend" value={eur(adset.spend)} />
          <CTile label="Leads" value={intFmt(adset.landing_leads)} />
          <CTile label="CPL" value={adset.cpl > 0 ? eur2(adset.cpl) : '–'} tone={adset.cpl > 0 ? cpqlColor(adset.cpl, turkey) : undefined} />
          <CTile label="CTR" value={pct1(adset.ctr)} />
        </div>
      </button>
      {open && ads.length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t bg-[#FAF8F5]">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {ads.map((ad) => <CreativeCard key={ad.id} ad={ad} turkey={turkey} highlight={matchedAdIds.has(ad.id)} />)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---- Campaign row (level 1) → expands to adsets ---- */
function CampaignRow({ view, searchActive }: { view: CampaignView; searchActive: boolean }) {
  const { c, adsetViews, campMatch, autoOpen } = view
  const [localOpen, setLocalOpen] = useState(false)
  const open = searchActive ? (autoOpen || localOpen) : localOpen
  const turkey = c.market === 'Turkey'
  const verdict = campaignVerdict(c)
  const qlGood = c.qualityTracked && c.qRate >= 45
  const hasChildren = adsetViews.length > 0

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => hasChildren && setLocalOpen((v) => !v)}
        className={cn('w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left', hasChildren && 'cursor-pointer hover:bg-gray-50')}
      >
        <div className="flex items-center gap-2.5 min-w-[260px] flex-1">
          {hasChildren
            ? <ChevronRight className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-90')} />
            : <span className="w-4 shrink-0" />}
          <VerdictBadge verdict={verdict} />
          <HName text={c.name} match={campMatch} className="text-sm font-bold text-gray-900 leading-snug" />
          <MarketBadge market={c.market} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 ml-auto">
          <CTile label="Spend" value={eur(c.spend)} />
          <CTile label="Leads" value={intFmt(c.landingLeads)} />
          <CTile label="QL" value={c.qualityTracked ? intFmt(c.quality) : '–'} />
          <CTile label="QL%" value={c.qualityTracked ? pct0(c.qRate) : '–'} tone={c.qualityTracked ? (qlGood ? '#047857' : undefined) : undefined} />
          <CTile
            label="CPQL"
            value={c.qualityTracked && c.cpql > 0 ? eur2(c.cpql) : '–'}
            tone={c.qualityTracked && c.cpql > 0 ? cpqlColor(c.cpql, turkey) : undefined}
            sub="on tracked QL"
          />
        </div>
      </button>
      {open && hasChildren && (
        <div className="px-4 pb-4 pt-1 border-t bg-[#FAF8F5] space-y-2">
          <p className="text-[11px] text-gray-400 italic pt-2">
            Ad sets &amp; ads show <strong>Landing Leads / CPL</strong> (Meta exact); QL/CPQL live at campaign level only.
          </p>
          {adsetViews.map((v) => <AdsetRow key={v.adset.id} view={v} turkey={turkey} searchActive={searchActive} />)}
        </div>
      )}
    </div>
  )
}

export function CampaignAccordion({
  campaigns, adsets, ads, search = '', sortField = 'spend', sortDir = 'desc',
}: {
  campaigns: FbCampaign[]
  adsets: FbAdset[]
  ads: FbAd[]
  search?: string
  sortField?: FbSortField
  sortDir?: SortDir
}) {
  const q = norm(search.trim())
  const active = q.length > 0

  const views: CampaignView[] = useMemo(() => {
    const built = campaigns.map<CampaignView | null>((c) => {
      const campMatch = active && norm(c.name).includes(q)
      const cAdsets = adsets.filter((a) => a.campaign_name === c.name).sort((x, y) => y.spend - x.spend)

      const adsetViews: AdsetView[] = []
      let hasDeepMatch = false

      for (const as of cAdsets) {
        const asAds = ads.filter((a) => a.adset_id === as.id).sort((x, y) => y.spend - x.spend)
        const adsetMatch = active && norm(as.name).includes(q)
        const matchedAdIds = new Set<string>(active ? asAds.filter((a) => norm(a.name).includes(q)).map((a) => a.id) : [])
        const hasAdMatch = matchedAdIds.size > 0

        const include = !active || campMatch || adsetMatch || hasAdMatch
        if (!include) continue

        const renderAds = active && !campMatch && !adsetMatch ? asAds.filter((a) => matchedAdIds.has(a.id)) : asAds
        if (adsetMatch || hasAdMatch) hasDeepMatch = true

        adsetViews.push({ adset: as, ads: renderAds, matchedAdIds, adsetMatch, autoOpen: hasAdMatch })
      }

      const visible = !active || campMatch || adsetViews.length > 0
      if (!visible) return null

      return { c, adsetViews, campMatch, autoOpen: active && hasDeepMatch }
    })
    return built.filter((v): v is CampaignView => v !== null)
  }, [campaigns, adsets, ads, q, active])

  const sorted = useMemo(
    () => [...views].sort((a, b) => compareCampaigns(a.c, b.c, sortField, sortDir)),
    [views, sortField, sortDir]
  )

  return (
    <div className="space-y-2.5">
      {active && (
        <div className="text-xs text-gray-500">
          <strong className="text-gray-700 tabular-nums">{sorted.length}</strong> of{' '}
          <span className="tabular-nums">{campaigns.length}</span> campaigns
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="rounded-xl border bg-white shadow-sm px-4 py-8 text-center text-sm text-gray-500">
          No campaigns, ad sets, or ads match &ldquo;{search.trim()}&rdquo;.
        </div>
      ) : (
        sorted.map((v) => <CampaignRow key={v.c.name} view={v} searchActive={active} />)
      )}
    </div>
  )
}
