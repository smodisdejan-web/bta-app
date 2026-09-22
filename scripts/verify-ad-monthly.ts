/**
 * Verify the MONTH-GRANULAR ad table (src/lib/fb-ads-monthly.ts) + its per-ad QL join.
 *
 * Same shape as verify-ad-ql.ts (which checks the OLD frozen `fb_ads_level` tab), so the two can
 * be read side by side: the number that matters is matched share, i.e. how much of a window's
 * Meta Streak leads the table can place on exactly one ad. The old tab answers every window with
 * June–July's 262 ads; this one answers each window with the ads that were actually live in it.
 *
 * Run:  npx tsx scripts/verify-ad-monthly.ts [start] [end]
 *       npx tsx scripts/verify-ad-monthly.ts            (runs 2026-09-01..21 and 2026-08-01..31)
 *
 * Reads Streak through the same Apps Script Web App the dashboard uses — no credentials, nothing
 * is written anywhere.
 */

import { fetchStreakLeadsUnion } from '../src/lib/streak-leads'
import { fetchSheet } from '../src/lib/sheetsData'
import { getAdTableWithQl, BUILT_AT, AVAILABLE_MONTHS, getMonthEntry } from '../src/lib/fb-ads-monthly'
import type { StreakLeadRow } from '../src/lib/sheetsData'

const eur = (v: number) => `€${v.toFixed(2)}`
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function runWindow(streakRows: StreakLeadRow[], start: string, end: string) {
  const { ads, coverage } = getAdTableWithQl({ start, end, streakRows })

  console.log('')
  console.log(`═══ WINDOW ${start} → ${end} ═══════════════════════════`)
  console.log(`Months used      : ${coverage.monthsUsed.join(', ') || '(none)'}`)
  console.log(`Partial months   : ${coverage.partialMonths.join(', ') || '(none)'}`)
  console.log(`Incomplete months: ${coverage.incompleteMonths.join(', ') || '(none)'}`)
  console.log(`Missing months   : ${coverage.missingMonths.join(', ') || '(none)'}`)
  console.log(`Days not covered : ${coverage.uncoveredDays}`)
  console.log(`Ad rows          : ${ads.length}   spend ${eur(ads.reduce((s, a) => s + a.spend, 0))}`)

  console.log('')
  console.log('── COVERAGE ─────────────────────────────────────────────')
  console.log(`FB Streak leads in window : ${coverage.fbLeadsInWindow}`)
  console.log(`Matched to a single ad    : ${coverage.matchedLeads}`)
  console.log(`Matched share             : ${pct(coverage.matchedShare)}`)

  const withQl = ads.filter((a) => a.ql > 0).sort((a, b) => b.ql - a.ql || b.spend - a.spend)
  console.log('')
  console.log(`── TOP 10 ADS BY QL (${withQl.length} ads carry QL) ───────────────`)
  console.log('  QL  Leads      Spend       CPQL   QL%   Ad / ad set / campaign')
  for (const a of withQl.slice(0, 10)) {
    console.log(
      `${String(a.ql).padStart(4)} ${String(a.leadsStreak).padStart(6)} ${eur(a.spend).padStart(10)} ` +
        `${(a.cpql == null ? '—' : eur(a.cpql)).padStart(10)} ${(a.qualityRate == null ? '—' : pct(a.qualityRate)).padStart(5)}   ` +
        `${a.adName} / ${a.adset} / ${a.campaign}`
    )
  }

  console.log('')
  console.log('── TOP 10 UNMATCHED SOURCE PLACEMENTS ───────────────────')
  console.log('  Leads   QL   SOURCE PLACEMENT')
  for (const u of coverage.unmatchedBySource.slice(0, 10)) {
    console.log(`${String(u.leads).padStart(7)} ${String(u.ql).padStart(4)}   ${u.source || '(empty)'}`)
  }
}

async function main() {
  console.log(`fb-ads-monthly.json built ${BUILT_AT}`)
  for (const m of AVAILABLE_MONTHS) {
    const e = getMonthEntry(m)
    if (!e) continue
    console.log(
      `  ${m}  ${e.window.since}..${e.window.until}  ${e.adCount} ads  ${eur(e.spend)}  ` +
        `${e.source}${e.complete ? '' : `  [incomplete: ${e.note}]`}`
    )
  }

  console.log('')
  console.log('Fetching streak_full ∪ streak_sync ...')
  const streakRows = await fetchStreakLeadsUnion(fetchSheet)
  console.log(`streak rows: ${streakRows.length}`)

  const argStart = process.argv[2]
  const argEnd = process.argv[3]
  const windows: Array<[string, string]> = argStart && argEnd ? [[argStart, argEnd]] : [
    ['2026-09-01', '2026-09-21'],
    ['2026-08-01', '2026-08-31'],
  ]
  for (const [s, e] of windows) runWindow(streakRows, s, e)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
