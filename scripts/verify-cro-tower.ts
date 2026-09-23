/**
 * scripts/verify-cro-tower.ts
 *
 * Builds /api/cro-tower for August 2026 (period=month&anchor=2026-08) straight from the library
 * and checks the headline against the anchors agreed for phase 1:
 *
 *   visitors, 4 main domains      ≈ 145,236   (ga4_host_lp, sum of sessions)
 *   goolets.net inquiries          raw 2,441 all forms (create_month) → report what the exclusion list gives
 *   QL, all channels               1,282       (streak_all is_ql)
 *   paid QL                        1,003       must equal business-funnel's paid QL for August
 *   bookings / RVC                 must equal what /api/funnel (loadBusinessFunnel) reports for August
 *
 * Also prints the unmapped channel share per taxonomy and the QL → HubSpot email match rate.
 *
 *   npx tsx scripts/verify-cro-tower.ts [period] [anchor]
 */

import { buildCroTower, type CroTowerResponse } from '../src/lib/cro-tower'
import { loadBusinessFunnel } from '../src/lib/business-funnel'

const period = process.argv[2] || 'month'
const anchor = process.argv[3] || '2026-08'

const fmt = (v: number | null | undefined, d = 0) =>
  v == null ? 'null' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

type Check = { name: string; actual: number | null; anchor: number | null; tolerancePct: number; note?: string }

async function main() {
  const t0 = Date.now()
  const r: CroTowerResponse = await buildCroTower({ period, anchor, nocache: true })
  const t1 = Date.now()
  console.log(`\nCRO tower ${period} ${anchor} → ${r.meta.range.from} … ${r.meta.range.to} (${r.meta.range.label}); prev ${r.meta.prevRange?.from} … ${r.meta.prevRange?.to}; built in ${((t1 - t0) / 1000).toFixed(1)} s\n`)

  // The funnel exactly as /api/funnel builds it for the same window.
  const f = await loadBusinessFunnel({ start: r.meta.range.from, end: r.meta.range.to, campaign: 'master', channel: 'all' })
  const step = (k: string) => f.steps.find((s) => s.key === k)
  const fQl = step('ql')?.value ?? null
  const fBk = step('bookings')?.value ?? null
  const fRv = step('bookings')?.revenue ?? null

  const goolets = r.domains.rows.find((d) => d.key === 'goolets.net')!
  const isAug = period === 'month' && anchor === '2026-08'
  // paid QL from streak_all (source_category PAID_*) is not exposed on the response; count it
  // from the channel rows instead: Paid social + Paid search QL.
  const chQl = (k: string) => r.channels.rows.find((c) => c.key === k)?.ql.value ?? null
  const paidQlFromStreakAll = (chQl('Paid social') ?? 0) + (chQl('Paid search') ?? 0)

  const week = period === 'week' // bookings are month-granular: null on week by design
  const checks: Check[] = [
    { name: 'Visitors, 4 main domains', actual: r.hero.visitors.value, anchor: isAug ? 145236 : null, tolerancePct: 0.5 },
    { name: 'goolets.net inquiries (after exclusions)', actual: goolets.inquiries.value, anchor: isAug ? 2441 : null, tolerancePct: 100, note: 'anchor = raw, all forms' },
    { name: 'QL, all channels (streak_all)', actual: r.hero.ql.value, anchor: isAug ? 1282 : null, tolerancePct: 0 },
    { name: 'Paid QL (streak_all PAID_*)', actual: paidQlFromStreakAll, anchor: isAug ? 1003 : null, tolerancePct: 0 },
    { name: 'Paid QL (business-funnel, excl. ASSET)', actual: r.strip.cpql.paidQl, anchor: fQl, tolerancePct: 0, note: 'must equal /api/funnel' },
    // Hard only for the August anchor (the spec); other windows differ slightly because the funnel
    // excludes ASSET by campaign umbrella and streak_all by its own is_asset flag → info there.
    { name: 'Paid QL streak_all vs business-funnel', actual: paidQlFromStreakAll, anchor: fQl, tolerancePct: isAug ? 0 : 100 },
    { name: 'Bookings (paid)', actual: r.funnel.steps.find((s) => s.key === 'bookings')!.metric.value, anchor: week ? null : fBk, tolerancePct: 0, note: week ? 'null on week by design' : '/api/funnel' },
    { name: 'RVC € (paid)', actual: r.funnel.steps.find((s) => s.key === 'bookings')!.revenue!.value, anchor: week ? null : fRv, tolerancePct: 0, note: week ? 'null on week by design' : '/api/funnel' },
    { name: 'Booking rows attributed = funnel bookings', actual: r.meta.reconciliation.bookingsFromRows, anchor: r.meta.reconciliation.bookingsFromFunnel, tolerancePct: 0 },
  ]

  console.log('check'.padEnd(44), 'actual'.padStart(12), 'anchor'.padStart(12), 'delta'.padStart(10), '  status')
  let fails = 0
  for (const c of checks) {
    const delta = c.actual != null && c.anchor != null ? c.actual - c.anchor : null
    const dPct = delta != null && c.anchor ? (delta / c.anchor) * 100 : null
    const ok = c.anchor == null ? null : dPct == null ? delta === 0 : Math.abs(dPct) <= c.tolerancePct
    if (ok === false && c.tolerancePct < 100) fails++
    console.log(
      c.name.padEnd(44),
      fmt(c.actual).padStart(12),
      fmt(c.anchor).padStart(12),
      (delta == null ? '' : `${delta >= 0 ? '+' : ''}${fmt(delta)}${dPct != null ? ` (${dPct.toFixed(2)}%)` : ''}`).padStart(10),
      ' ',
      c.tolerancePct >= 100 ? 'info' : ok == null ? 'n/a' : ok ? 'OK' : 'FAIL',
      c.note ? `  · ${c.note}` : ''
    )
  }

  console.log('\nHeadline')
  console.log(`  Visitor → QL CR       ${fmt(r.hero.visitorToQlPct.value, 3)} %  (prev ${fmt(r.hero.visitorToQlPct.prev, 3)} %, Δ ${r.hero.visitorToQlPct.deltaPct} %)`)
  for (const s of r.funnel.steps) {
    console.log(`  ${s.label.padEnd(20)} ${fmt(s.metric.value).padStart(9)}  prev ${fmt(s.metric.prev).padStart(9)}  Δ ${String(s.metric.deltaPct).padStart(6)} %  → next ${s.cvrToNextPct ? fmt(s.cvrToNextPct.value, 2) + ' %' : ''}`)
  }
  console.log(`  Spend €${fmt(r.strip.spend.value)} (Meta ${fmt(r.strip.spend.meta)} · Google ${fmt(r.strip.spend.google)} · Bing ${fmt(r.strip.spend.bing)} · ChatGPT ${fmt(r.strip.spend.chatgpt)})  ROAS ${fmt(r.strip.roas.value, 2)}  CPL ${fmt(r.strip.cpl.value, 2)}  CPQL ${fmt(r.strip.cpql.value, 2)}`)
  console.log(`  YTD paid revenue €${fmt(r.strip.ytdPaidRevenue.value)} (target ${r.strip.ytdPaidRevenue.target})`)
  console.log(`  Unattributed bookings ${r.funnel.unattributedBookings.count} / €${fmt(r.funnel.unattributedBookings.revenue)}`)

  console.log('\nDomains')
  for (const d of r.domains.rows) {
    console.log(`  ${d.label.padEnd(42)} V ${fmt(d.visitors.value).padStart(8)}  E ${fmt(d.engaged.value).padStart(7)}  I ${fmt(d.inquiries.value).padStart(5)}  QL ${fmt(d.ql.value).padStart(5)}  CR ${fmt(d.crPct.value, 2).padStart(5)}  BK ${fmt(d.bookings)}  €${fmt(d.revenue)}  ${d.flags.join(' | ')}`)
  }
  console.log(`  Ships: ${r.domains.ships.slice(0, 6).map((s) => `${s.host} ${s.visitors}`).join(', ')} …`)

  console.log('\nChannels')
  for (const c of r.channels.rows) {
    console.log(`  ${c.label.padEnd(16)} V ${fmt(c.visitors.value).padStart(8)}  I ${fmt(c.inquiries.value).padStart(5)}  QL ${fmt(c.ql.value).padStart(5)}  CR ${fmt(c.crPct.value, 2).padStart(5)}  spend ${fmt(c.spend)}  BK ${fmt(c.bookings)}  €${fmt(c.revenue)}  ROAS ${fmt(c.roas, 2)}`)
  }

  console.log('\nTop pages')
  for (const p of r.pages.rows) {
    console.log(`  ${p.key.padEnd(62)} V ${fmt(p.visitors).padStart(7)}  I ${fmt(p.inquiries).padStart(4)}  QL ${String(p.ql ?? 'n/a').padStart(4)}  BK ${p.bookings ?? 'n/a'}`)
  }

  const u = r.meta.unmapped
  console.log('\nUnmapped channel share')
  console.log(`  GA4 visitors   ${fmt(u.ga4.visitors)} (${u.ga4.share} %)  top: ${u.ga4.top.slice(0, 4).map((x) => `${x.key}=${x.visitors}`).join('; ')}`)
  console.log(`  HubSpot inq.   ${fmt(u.hubspot.inquiries)} (${u.hubspot.share} %)  top: ${u.hubspot.top.slice(0, 4).map((x) => `${x.key}=${x.inquiries}`).join('; ')}`)
  console.log(`  Streak QL      ${fmt(u.streak.ql)} (${u.streak.share} %)  top: ${u.streak.top.slice(0, 4).map((x) => `${x.key}=${x.ql}`).join('; ')}`)
  const m = r.meta.matchRates
  console.log('\nMatch rates')
  console.log(`  QL email → HubSpot     ${m.qlEmailToHubspot.matched} / ${m.qlEmailToHubspot.total} = ${m.qlEmailToHubspot.ratePct} %`)
  console.log(`  Bookings → domain      ${m.bookingsToDomain.matched} / ${m.bookingsToDomain.total} = ${m.bookingsToDomain.ratePct} %`)
  console.log('\nInquiry exclusions:', r.meta.inquiryExclusions.map((x) => `${x.key}${x.proposed ? '*' : ''}=${x.count}`).join(', '), ' (* = proposed)')
  console.log('Inquiries outside whitelist:', r.meta.inquiriesOutsideWhitelist.count, r.meta.inquiriesOutsideWhitelist.topHosts.map((h) => `${h.host}=${h.count}`).join(', '))
  console.log('\nFreshness')
  for (const t of r.meta.freshness) console.log(`  ${t.tab.padEnd(22)} rows ${String(t.rows).padStart(7)}  ${t.minDate} … ${t.maxDate}  ${t.servedFrom}  covers=${t.coversPeriod}${t.error ? '  ERROR ' + t.error : ''}`)
  console.log('\nFlags')
  for (const x of r.meta.flags) console.log('  -', x)
  console.log(`\nSeries (${r.hero.series.unit}): ${r.hero.series.points.map((p) => `${p.start}:${p.crPct}`).join('  ')}`)

  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll hard checks passed')
  process.exit(fails ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
