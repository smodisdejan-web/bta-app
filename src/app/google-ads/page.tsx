'use client'

import React, { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import rawData from '@/data/mtd-data.json'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import {
  type MtdData, type MarketKey, type GCampaign,
  inMarket, eur, eur2, pct0, pct1, intFmt, cpqlColor,
  PageHeader, MarketToggle, BookingsStrip, KpiTile, Funnel,
  CpqlZoneCard, QualityRateCard, NeutralStatCard, Eyebrow, FooterMeta, MarketBadge,
} from '@/components/mtd/mtd-shared'
import { UnattributedRow } from '@/components/mtd/UnattributedRow'

const data = rawData as unknown as MtdData

function sum<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((a, x) => a + (f(x) || 0), 0)
}

export default function GoogleAdsPage() {
  const [market, setMarket] = useState<MarketKey>('all')

  const view = useMemo(() => {
    const camps: GCampaign[] = data.gCampaigns.filter((c) => inMarket(c.market, market))
    const st = data.streakTotals.google[market]

    const spend = sum(camps, (c) => c.spend)
    const clicks = sum(camps, (c) => c.clicks)
    const impressions = sum(camps, (c) => c.impressions)
    const conv = sum(camps, (c) => c.conv)
    const scored = st.scored
    const quality = st.quality
    const qRate = scored > 0 ? (quality / scored) * 100 : 0
    const blendedCpql = quality > 0 ? spend / quality : 0

    const campStreakLeads = sum(camps, (c) => c.streakLeads)
    const unScored = scored - campStreakLeads
    const unQuality = quality - sum(camps, (c) => c.quality)

    return { camps, spend, clicks, impressions, conv, scored, quality, qRate, blendedCpql, unScored, unQuality }
  }, [market])

  const cpm = view.impressions > 0 ? (view.spend / view.impressions) * 1000 : 0
  const ctr = view.impressions > 0 ? (view.clicks / view.impressions) * 100 : 0
  const costPerConv = view.conv > 0 ? view.spend / view.conv : 0
  const scoredRate = view.conv > 0 ? (view.scored / view.conv) * 100 : 0

  const sortedCamps = useMemo(() => [...view.camps].sort((a, b) => b.spend - a.spend), [view.camps])

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 space-y-6 max-w-7xl">
        <PageHeader
          icon={<Sparkles className="h-7 w-7 text-white" />}
          iconBg="#B39262"
          title="Google Ads"
          eyebrow="Goolets · MTD"
          subtitle="Month-to-date deep dive — campaign level, Streak-scored quality."
          through={data.generated}
        />

        <MarketToggle value={market} onChange={setMarket} />

        {/* Closed this month */}
        <Eyebrow>Closed this month</Eyebrow>
        <BookingsStrip cell={data.bookings.google[market]} />

        {/* Headline KPIs */}
        <Eyebrow sub="Streak truth — all scored leads, blended cost">Headline</Eyebrow>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Spend" value={eur(view.spend)} />
          <KpiTile label="Conversions" value={intFmt(view.conv)} sub="Google conv." />
          <KpiTile label="Leads" value={intFmt(view.scored)} sub="Streak scored" />
          <KpiTile label="Quality Leads" value={intFmt(view.quality)} sub="AI ≥ 50" />
          <KpiTile label="Account CPQL" value={eur2(view.blendedCpql)} sub="blended" accent />
        </div>

        {/* Funnel */}
        <Eyebrow sub="volume + step conversion">Funnel</Eyebrow>
        <Funnel
          steps={[
            { label: 'Spend', value: eur(view.spend) },
            { label: 'Impressions', value: intFmt(view.impressions) },
            { label: 'Clicks', value: intFmt(view.clicks) },
            { label: 'Conversions', value: intFmt(view.conv) },
            { label: 'Leads', value: intFmt(view.scored) },
            { label: 'Quality', value: intFmt(view.quality) },
          ]}
          conns={[
            { label: 'CPM', rate: cpm > 0 ? eur2(cpm) : '–' },
            { label: 'CTR', rate: pct1(ctr) },
            { label: 'cost/conv', rate: costPerConv > 0 ? eur2(costPerConv) : '–' },
            { label: 'scored', rate: pct0(scoredRate) },
            { label: 'QL%', rate: pct0(view.qRate) },
          ]}
        />

        {/* Zone scorecards */}
        <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
          <CpqlZoneCard cpql={view.blendedCpql} blendedNote="blended account CPQL" />
          <QualityRateCard qRate={view.qRate} scored={view.scored} />
          <NeutralStatCard label="Campaigns" value={intFmt(view.camps.length)} sub="live this market" />
        </div>

        {/* Campaign table */}
        <Eyebrow sub={`${view.camps.length} campaigns`}>Campaigns</Eyebrow>
        <Card className="overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Campaign</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Quality</TableHead>
                  <TableHead className="text-right">QL%</TableHead>
                  <TableHead className="text-right">CPQL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCamps.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">No campaigns</TableCell></TableRow>
                ) : sortedCamps.map((c) => {
                  const turkey = c.market === 'Turkey'
                  const qlGood = c.qRate >= 45
                  return (
                    <TableRow key={c.name} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{c.name}</span>
                          <MarketBadge market={c.market} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-600">{c.type}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{eur(c.spend)}</TableCell>
                      <TableCell className="text-right tabular-nums text-gray-600">{intFmt(c.clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{intFmt(c.streakLeads)}</TableCell>
                      <TableCell className="text-right tabular-nums">{intFmt(c.quality)}</TableCell>
                      <TableCell className="text-right tabular-nums" style={qlGood && !turkey ? { color: '#047857', fontWeight: 600 } : undefined}>
                        {pct0(c.qRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums" style={{ color: cpqlColor(c.cpql, turkey) }}>
                        {c.cpql > 0 ? eur2(c.cpql) : '–'}
                        <div className="text-[9px] text-gray-400 font-sans">on tracked QL</div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Unattributed / no-UTM — pinned last */}
        <UnattributedRow
          scored={view.unScored}
          quality={view.unQuality}
          note={`No campaign UTM — fix ad naming to attribute · Streak Google leads ${data.meta.gLeads} vs matched ${data.meta.gMatched}`}
        />

        {/* Footer meta */}
        <FooterMeta
          corruptDropped={data.meta.corruptRowsDropped.length}
          month={data.month}
          generated={data.generated}
        />
      </div>
    </div>
  )
}
