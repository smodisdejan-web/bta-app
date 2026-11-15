// Fails loudly (exit 1) when streak_sync / streak_full carry a Stage name the alias map does not
// know — Streak stages are being renamed (13.11.2026) and more changes are announced.
//   npx tsx scripts/check-streak-stages.ts
import { __fetchRowsForTests } from '../src/lib/business-funnel'
import { stageKeyOf } from '../src/lib/streak-stages'
import { SHEETS_TABS } from '../src/lib/config'
;(async () => {
  let bad = 0
  for (const tab of [SHEETS_TABS.STREAK_SYNC, SHEETS_TABS.STREAK_FULL]) {
    const rows = await __fetchRowsForTests(tab)
    const seen = new Map<string, { n: number; key: string }>()
    for (const r of rows) { const s = String(r.Stage ?? '').trim(); const x = seen.get(s) || { n: 0, key: stageKeyOf(s) }; x.n++; seen.set(s, x) }
    console.log(`${tab}: ${rows.length} rows, ${seen.size} stage names`)
    for (const [s, x] of [...seen].sort((a, b) => b[1].n - a[1].n)) {
      const flag = x.key === 'unknown' && s !== '' ? '  ✗ UNKNOWN' : ''
      if (flag) bad++
      console.log(`  ${String(x.n).padStart(6)}  ${s || '(empty)'} → ${x.key}${flag}`)
    }
  }
  if (bad) { console.error(`\n${bad} unknown Streak stage name(s): add them to src/lib/streak-stages.ts`); process.exit(1) }
  console.log('\nall stage names known')
})().catch((e) => { console.error(e); process.exit(1) })
