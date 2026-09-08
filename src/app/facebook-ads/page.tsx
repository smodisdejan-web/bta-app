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

    // THREE things get carved out of the lead programme, for three different reasons:
    //  nonLead     — the objective cannot produce a lead (engagement boosts, hiring ads).
    //                Blending their spend into the account CPQL charged the lead programme for
    //                money that was never chasing a lead — EUR 1.5k of EUR 54k in Aug 2026.
    //  notGoolets  — runs in the Goolets ad account but is not Goolets marketing (Dejan's
    //                personal-brand IG boost). Not a Goolets number at all.
    //  leadMagnet  — a REAL conversion (calculator unlock, registration) that never reaches
    //                Streak. Charging its spend to a CPQL it can never contribute a QL to
    //                inflates CPQL for every other campaign, so it is priced on its own CPL.
    const notGooletsCamps = camps.filter((c) => c.nonLeadReason === 'not-goolets')
    const nonLeadCamps = camps.filter((c) => c.nonLeadReason && c.nonLeadReason !== 'not-goolets')
    const magnetCamps = camps.filter((c) => !c.nonLeadReason && c.altLeadValue != null)
    const leadCamps = camps.filter((c) => !c.nonLeadReason && c.altLeadValue == null)

    // Headline (streak truth per market)
    const spend = sum(leadCamps, (c) => c.spend)
    const nonLeadSpend = sum(nonLeadCamps, (c) => c.spend)
    const notGooletsSpend = sum(notGooletsCamps, (c) => c.spend)
    const magnetSpend = sum(magnetCamps, (c) => c.spend)
    const magnetLeads = sum(magnetCamps, (c) => c.altLeadValue || 0)
    const clicks = sum(leadCamps, (c) => c.clicks)
    const linkClicks = sum(leadCamps, (c) => c.linkClicks || 0)
    const lpViews = sum(leadCamps, (c) => c.lpViews)
    const landingLeads = sum(leadCamps, (c) => c.landingLeads)
    // Streak truth, like Leads and QL beside it. Summing the per-campaign counts only saw
    // leads a RULE maps to a campaign and read 57 against Streak's real 58 (fixed 8.9.2026).
    // Archived months predate `excellent` in streakTotals — fall back to the campaign sum.
    const excellent = st.excellent != null ? st.excellent : sum(camps, (c) => c.excellent)
    const scored = st.scored
    const quality = st.quality
    const qRate = scored > 0 ? (quality / scored) * 100 : 0
    const blendedCpql = quality > 0 ? spend / quality : 0

    // Per-market CPQL, so the "All markets" headline can state what it is blending.
    const cpqlOf = (mkt: 'Croatia/Other' | 'Turkey') => {
      const cs = data.fbCampaigns.filter(
        (c) => c.market === mkt && !c.nonLeadReason && c.altLeadValue == null
      )
      const q = data.streakTotals.fb[mkt]?.quality || 0
      return q > 0 ? sum(cs, (c) => c.spend) / q : 0
    }
    const cpqlCroatia = cpqlOf('Croatia/Other')
    const cpqlTurkey = cpqlOf('Turkey')

    // Reconciliation: campaign attributed sums
    const campStreakLeads = sum(camps, (c) => c.streakLeads)
    const campQuality = sum(camps, (c) => c.quality)
    const unScored = scored - campStreakLeads
    const unQuality = quality - campQuality

    return {
      camps, spend, nonLeadSpend, nonLeadCount: nonLeadCamps.length,
      notGooletsSpend, notGooletsCount: notGooletsCamps.length,
      magnetCamps, magnetSpend, magnetLeads,
      clicks, linkClicks, lpViews, landingLeads, excellent,
      scored, quality, qRate, blendedCpql, unScored, unQuality,
      cpqlCroatia, cpqlTurkey,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, monthKey])

  // Link clicks, not Meta's all-clicks. All-clicks counts reactions, profile taps and
  // caption expansions: 176k against 91k link clicks in Aug 2026, so an all-clicks CPC
  // read EUR 0.31 when a session actually cost EUR 0.61.
  const cpc = view.linkClicks > 0 ? view.spend / view.linkClicks : 0
  const lpRate = view.linkClicks > 0 ? (view.lpViews / view.linkClicks) * 100 : 0
  const convRate = view.lpViews > 0 ? (view.landingLeads / view.lpViews) * 100 : 0

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 space-y-6 max-w-7xl">
        <PageHeader
          icon={<Facebook className="h-7 w-7 text-white" fill="white" strokeWidth={0} />}
          iconBg="#1877F2"
          title="Facebook Ads"
          eyebrow="Goolets · MTD"
          subtitle="Month-to-date deep dive — campaign → ad set → ad, Streak-scored quality."
          window={data.window}
          builtAt={data.builtAt}
          generated={data.generated}
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
          <KpiTile label="Spend" value={eur(view.spend)} sub="lead campaigns only" />
          <KpiTile label="Leads" value={intFmt(view.scored)} sub="Streak scored" />
          <KpiTile label="Quality Leads" value={intFmt(view.quality)} sub="AI ≥ 50" />
          <KpiTile label="QL Rate" value={pct0(view.qRate)} sub="of CRM-scored" />
          <KpiTile label="Account CPQL" value={eur2(view.blendedCpql)} sub="blended" accent />
        </div>

        {/* What the headline deliberately leaves out, and what "All markets" is blending.
            Both used to be invisible: EUR 68 of Dejan's personal boost sat inside the account
            spend, and the "All" CPQL quietly averaged Turkey (EUR 1,358 / 8 QL) into Croatia. */}
        <div className="rounded-lg border bg-white px-4 py-3 text-[11.5px] text-gray-500 leading-relaxed">
          <span className="font-semibold text-gray-700">Headline spend excludes:</span>{' '}
          {view.magnetSpend > 0 && (
            <>
              <strong className="text-gray-700">{eur(view.magnetSpend)} lead magnets</strong>{' '}
              ({intFmt(view.magnetLeads)} Meta-attributed conversions, no Streak QL — priced on their own CPL, excl. from CPQL)
              {(view.nonLeadSpend > 0 || view.notGooletsSpend > 0) && ' · '}
            </>
          )}
          {view.nonLeadSpend > 0 && (
            <>
              <strong className="text-gray-700">{eur(view.nonLeadSpend)} non-lead</strong>{' '}
              ({view.nonLeadCount} engagement / recruitment campaign{view.nonLeadCount === 1 ? '' : 's'})
              {view.notGooletsSpend > 0 && ' · '}
            </>
          )}
          {view.notGooletsSpend > 0 && (
            <>
              <strong className="text-gray-700">{eur(view.notGooletsSpend)} not Goolets</strong>{' '}
              (Dejan&rsquo;s personal-brand IG boost, billed through this ad account)
            </>
          )}
          {market === 'all' && view.cpqlTurkey > 0 && (
            <div className="mt-1.5 pt-1.5 border-t">
              <span className="font-semibold text-gray-700">&ldquo;All markets&rdquo; blends Turkey in.</span>{' '}
              Croatia / Other alone is <strong className="text-gray-700">{eur2(view.cpqlCroatia)}</strong> CPQL;
              Turkey is <strong className="text-gray-700">{eur2(view.cpqlTurkey)}</strong>. Turkey has its own targets —
              use the market toggle before comparing this number to a Croatia goal.
            </div>
          )}
        </div>

        {/* Funnel */}
        <Eyebrow sub="volume + step conversion">Full funnel</Eyebrow>
        <Funnel
          steps={[
            { label: 'Spend', value: eur(view.spend) },
            { label: 'Link clicks', value: intFmt(view.linkClicks), sub: `${intFmt(view.clicks)} all clicks` },
            { label: 'LP Views', value: intFmt(view.lpViews) },
            { label: 'Landing Leads', value: intFmt(view.landingLeads), sub: 'Meta pixel' },
            { label: 'CRM-scored', value: intFmt(view.scored), sub: 'Streak' },
            { label: 'Quality', value: intFmt(view.quality) },
          ]}
          conns={[
            { label: 'link CPC', rate: cpc > 0 ? eur2(cpc) : '–' },
            { label: 'LP rate', rate: pct0(lpRate) },
            { label: 'conv', rate: pct0(convRate) },
            // Deliberately rate-less: pixel leads and Streak leads are two different
            // measurement systems, so their ratio is not a step conversion.
            { label: 'pixel → CRM', rate: null },
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
