'use client'

import React, { useMemo, useState } from 'react'
import { Facebook } from 'lucide-react'
import { MONTHS } from '@/data/months'
import {
  type MtdData, type MarketKey, type FbCampaign, type SortDir,
  inMarket, eur, eur2, pct0, intFmt,
  PageHeader, MarketToggle, MonthPicker, BookingsStrip, KpiTile, Funnel,
  CpqlZoneCard, QualityRateCard, NeutralStatCard, Eyebrow, FooterMeta,
  SearchBar, SortChips,
} from '@/components/mtd/mtd-shared'
import { CampaignAccordion, FB_SORT_OPTIONS, type FbSortField } from '@/components/mtd/CampaignAccordion'
import { UnattributedRow } from '@/components/mtd/UnattributedRow'

function sum<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((a, x) => a + (f(x) || 0), 0)
}

export default function FacebookAdsPage() {
  const [monthKey, setMonthKey] = useState<string>(MONTHS[0].key)
  const selected = MONTHS.find((m) => m.key === monthKey) ?? MONTHS[0]
  const data = selected.data as unknown as MtdData
  const isCurrent = selected.key === 'current'

  const [market, setMarket] = useState<MarketKey>('all')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<FbSortField>('spend')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const onSort = (f: FbSortField) => {
    if (f === sortField) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortField(f); setSortDir('desc') }
  }

  const view = useMemo(() => {
    const camps: FbCampaign[] = data.fbCampaigns.filter((c) => inMarket(c.market, market))
    const st = data.streakTotals.fb[market]

    // Headline (streak truth per market)
    const spend = sum(camps, (c) => c.spend)
    const clicks = sum(camps, (c) => c.clicks)
    const lpViews = sum(camps, (c) => c.lpViews)
    const landingLeads = sum(camps, (c) => c.landingLeads)
    const excellent = sum(camps, (c) => c.excellent)
    const scored = st.scored
    const quality = st.quality
    const qRate = scored > 0 ? (quality / scored) * 100 : 0
    const blendedCpql = quality > 0 ? spend / quality : 0

    // Reconciliation: campaign attributed sums
    const campStreakLeads = sum(camps, (c) => c.streakLeads)
    const campQuality = sum(camps, (c) => c.quality)
    const unScored = scored - campStreakLeads
    const unQuality = quality - campQuality

    return {
      camps, spend, clicks, lpViews, landingLeads, excellent,
      scored, quality, qRate, blendedCpql, unScored, unQuality,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, monthKey])

  const cpc = view.clicks > 0 ? view.spend / view.clicks : 0
  const lpRate = view.clicks > 0 ? (view.lpViews / view.clicks) * 100 : 0
  const convRate = view.lpViews > 0 ? (view.landingLeads / view.lpViews) * 100 : 0
  const scoredRate = view.landingLeads > 0 ? (view.scored / view.landingLeads) * 100 : 0

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 space-y-6 max-w-7xl">
        <PageHeader
          icon={<Facebook className="h-7 w-7 text-white" fill="white" strokeWidth={0} />}
          iconBg="#1877F2"
          title="Facebook Ads"
          eyebrow="Goolets · MTD"
          subtitle="Month-to-date deep dive — campaign → ad set → ad, Streak-scored quality."
          through={data.generated}
        />

        <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <MarketToggle value={market} onChange={setMarket} />
          <MonthPicker value={monthKey} onChange={setMonthKey} />
        </div>

        {/* Closed */}
        <Eyebrow>{isCurrent ? 'Closed this month' : `Closed in ${selected.label}`}</Eyebrow>
        <BookingsStrip cell={data.bookings.fb[market]} periodLabel={isCurrent ? undefined : selected.label} />

        {/* Headline KPIs — Streak truth */}
        <Eyebrow sub="Streak truth — all scored leads, blended cost">Headline</Eyebrow>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Spend" value={eur(view.spend)} />
          <KpiTile label="Leads" value={intFmt(view.scored)} sub="Streak scored" />
          <KpiTile label="Quality Leads" value={intFmt(view.quality)} sub="AI ≥ 50" />
          <KpiTile label="QL Rate" value={pct0(view.qRate)} sub="of CRM-scored" />
          <KpiTile label="Account CPQL" value={eur2(view.blendedCpql)} sub="blended" accent />
        </div>

        {/* Funnel */}
        <Eyebrow sub="volume + step conversion">Full funnel</Eyebrow>
        <Funnel
          steps={[
            { label: 'Spend', value: eur(view.spend) },
            { label: 'Clicks', value: intFmt(view.clicks) },
            { label: 'LP Views', value: intFmt(view.lpViews) },
            { label: 'Landing Leads', value: intFmt(view.landingLeads) },
            { label: 'CRM-scored', value: intFmt(view.scored) },
            { label: 'Quality', value: intFmt(view.quality) },
          ]}
          conns={[
            { label: 'CPC', rate: cpc > 0 ? eur2(cpc) : '–' },
            { label: 'LP rate', rate: pct0(lpRate) },
            { label: 'conv', rate: pct0(convRate) },
            { label: 'scored', rate: pct0(scoredRate) },
            { label: 'QL%', rate: pct0(view.qRate) },
          ]}
        />

        {/* Zone scorecards */}
        <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
          <CpqlZoneCard cpql={view.blendedCpql} blendedNote="blended account CPQL" />
          <QualityRateCard qRate={view.qRate} scored={view.scored} />
          <NeutralStatCard label="Excellent leads" value={intFmt(view.excellent)} sub="AI ≥ 70 · across campaigns" />
        </div>

        {/* Campaign → ad set → ad */}
        <Eyebrow sub={`${view.camps.length} campaigns · collapsed — click to open`}>Campaign by campaign</Eyebrow>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
          <SearchBar value={search} onChange={setSearch} placeholder="Search campaigns, ad sets, ads…" />
          <SortChips options={FB_SORT_OPTIONS} field={sortField} dir={sortDir} onSort={onSort} />
        </div>
        <CampaignAccordion
          key={search.trim() ? 'search' : 'browse'}
          campaigns={view.camps}
          adsets={data.adsets}
          ads={data.ads}
          search={search}
          sortField={sortField}
          sortDir={sortDir}
        />

        {/* Unattributed / no-UTM — pinned last */}
        <UnattributedRow
          scored={view.unScored}
          quality={view.unQuality}
          note="No campaign UTM — fix ad naming to attribute"
          sources={data.fbUnmatchedSources}
          sourcesNote={
            market === 'all'
              ? undefined
              : 'These source variants are not market-attributable — full list shown for the fix.'
          }
        />

        {/* Footer meta */}
        <FooterMeta
          driveMatched={data.meta.driveMatched}
          unmatchedCount={data.fbUnmatchedSources.length}
          corruptDropped={data.meta.corruptRowsDropped.length}
          month={data.month}
          generated={data.generated}
        />
      </div>
    </div>
  )
}
