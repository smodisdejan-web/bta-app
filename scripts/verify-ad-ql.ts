/**
 * Verify the per-ad Quality Lead join (src/lib/ad-ql-join.ts) against LIVE data.
 *
 * Prints the coverage number first, because that is the number that decides whether the
 * per-ad CPQL column is honest enough to ship: total Meta Streak leads in the window, how
 * many landed on exactly one ad, the top ads by QL, and the placements that landed nowhere.
 *
 * Run:  npx tsx scripts/verify-ad-ql.ts [start] [end]     (default 2026-09-01 → 2026-09-21)
 *
 * Reads through the same Apps Script Web App the dashboard uses (DEFAULT_WEB_APP_URL in
 * lib/config.ts), so it needs no credentials and sees exactly what users see.
 * Nothing is written anywhere.
 */

import { fetchFbAdsLevel } from '../src/lib/facebook-ads-level'
import { fetchStreakLeadsUnion } from '../src/lib/streak-leads'
import { fetchSheet } from '../src/lib/sheetsData'
import { joinAdQl } from '../src/lib/ad-ql-join'

const START = process.argv[2] || '2026-09-01'
const END = process.argv[3] || '2026-09-21'

const eur = (v: number) => `€${v.toFixed(2)}`
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

async function main() {
  console.log(`Window ${START} → ${END}`)
  console.log('Fetching fb_ads_level + streak_full ∪ streak_sync ...')
  const [ads, streakRows] = await Promise.all([fetchFbAdsLevel(), fetchStreakLeadsUnion(fetchSheet)])
  console.log(`fb_ads_level rows: ${ads.length}   streak rows: ${streakRows.length}`)

  const { ads: joined, coverage } = joinAdQl({ ads, streakRows, start: START, end: END })

  console.log('')
  console.log('── COVERAGE ─────────────────────────────────────────────')
  console.log(`FB Streak leads in window : ${coverage.fbLeadsInWindow}`)
  console.log(`Matched to a single ad    : ${coverage.matchedLeads}`)
  console.log(`Matched share             : ${pct(coverage.matchedShare)}`)

  const withQl = joined.filter((a) => a.ql > 0).sort((a, b) => b.ql - a.ql || b.spend - a.spend)
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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
