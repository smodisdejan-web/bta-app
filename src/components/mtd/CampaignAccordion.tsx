'use client'

import React, { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  eur, eur2, pct1, pct0, intFmt, cpqlColor,
  MarketBadge, VerdictBadge, campaignVerdict,
  type FbCampaign, type FbAdset, type FbAd,
} from './mtd-shared'
import { CreativeCard } from './CreativeCard'

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
function AdsetRow({ adset, ads, turkey }: { adset: FbAdset; ads: FbAd[]; turkey: boolean }) {
  const [open, setOpen] = useState(false)
  const myAds = useMemo(() => ads.filter((a) => a.adset_id === adset.id).sort((a, b) => b.spend - a.spend), [ads, adset.id])
  const active = adset.status === 'ACTIVE'
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => myAds.length > 0 && setOpen((v) => !v)}
        className={cn('w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-left', myAds.length > 0 && 'cursor-pointer hover:bg-gray-50')}
      >
        <div className="flex items-center gap-2 min-w-[200px] flex-1">
          {myAds.length > 0
            ? <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform', open && 'rotate-90')} />
            : <span className="w-3.5 shrink-0" />}
          <span className="text-[12.5px] font-semibold text-gray-800 truncate" title={adset.name}>{adset.name}</span>
          <span className={cn('text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded shrink-0', active ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-gray-100 text-gray-500')}>
            {active ? 'ACTIVE' : 'PAUSED'}
          </span>
          {myAds.length > 0 && <span className="text-[10px] text-gray-400 shrink-0">{myAds.length} ad{myAds.length === 1 ? '' : 's'}</span>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 ml-auto">
          <CTile label="Spend" value={eur(adset.spend)} />
          <CTile label="Leads" value={intFmt(adset.landing_leads)} />
          <CTile label="CPL" value={adset.cpl > 0 ? eur2(adset.cpl) : '–'} tone={adset.cpl > 0 ? cpqlColor(adset.cpl, turkey) : undefined} />
          <CTile label="CTR" value={pct1(adset.ctr)} />
        </div>
      </button>
      {open && myAds.length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t bg-[#FAF8F5]">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {myAds.map((ad) => <CreativeCard key={ad.id} ad={ad} turkey={turkey} />)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---- Campaign row (level 1) → expands to adsets ---- */
function CampaignRow({ c, adsets, ads }: { c: FbCampaign; adsets: FbAdset[]; ads: FbAd[] }) {
  const [open, setOpen] = useState(false)
  const turkey = c.market === 'Turkey'
  const myAdsets = useMemo(
    () => adsets.filter((a) => a.campaign_name === c.name).sort((a, b) => b.spend - a.spend),
    [adsets, c.name]
  )
  const verdict = campaignVerdict(c)
  const qlGood = c.qualityTracked && c.qRate >= 45

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => myAdsets.length > 0 && setOpen((v) => !v)}
        className={cn('w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left', myAdsets.length > 0 && 'cursor-pointer hover:bg-gray-50')}
      >
        <div className="flex items-center gap-2.5 min-w-[260px] flex-1">
          {myAdsets.length > 0
            ? <ChevronRight className={cn('h-4 w-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-90')} />
            : <span className="w-4 shrink-0" />}
          <VerdictBadge verdict={verdict} />
          <span className="text-sm font-bold text-gray-900 leading-snug" title={c.name}>{c.name}</span>
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
      {open && myAdsets.length > 0 && (
        <div className="px-4 pb-4 pt-1 border-t bg-[#FAF8F5] space-y-2">
          <p className="text-[11px] text-gray-400 italic pt-2">
            Ad sets &amp; ads show <strong>Landing Leads / CPL</strong> (Meta exact); QL/CPQL live at campaign level only.
          </p>
          {myAdsets.map((as) => <AdsetRow key={as.id} adset={as} ads={ads} turkey={turkey} />)}
        </div>
      )}
    </div>
  )
}

export function CampaignAccordion({ campaigns, adsets, ads }: { campaigns: FbCampaign[]; adsets: FbAdset[]; ads: FbAd[] }) {
  const sorted = useMemo(() => [...campaigns].sort((a, b) => b.spend - a.spend), [campaigns])
  return (
    <div className="space-y-2.5">
      {sorted.map((c) => <CampaignRow key={c.name} c={c} adsets={adsets} ads={ads} />)}
    </div>
  )
}
