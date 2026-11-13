// Verify the node API against production + its own invariants.
//   npx tsx scripts/verify-funnel-nodes.ts [--ranges this_month,last_month,3m,ytd] [--prod https://gooletsaiagent.vercel.app]
// 1. Regression: legacy master + 16 umbrellas, local (this branch) vs production, per range.
//    Expected diffs only: lpViews (umbrella LP views restricted to the platforms it spends on,
//    ASSET lp regex) and bofu leads (sp ^bofu_). Everything else must be identical.
// 2. Invariants: master node — Σ funnels + remainder = master (QL vs qualityLeadsIncludingAsset);
//    every funnel node = its master child; Σ campaign children + remainder = funnel.
// 3. BOFU: Σ ad sets (fb_adset_daily_api) = campaign (fb_daily_api) per day.
import { CAMPAIGNS, getFunnelDatasets, loadBusinessFunnel, resolveRange } from '../src/lib/business-funnel'
import { loadFunnelNode } from '../src/lib/funnel-nodes'
import { FUNNELS, BOFU_CAMPAIGN, BOFU_CAMPAIGN_ID } from '../src/lib/funnel-groups'

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const RANGES = arg('ranges', 'this_month,last_month,3m,ytd').split(',')
const PROD = arg('prod', 'https://gooletsaiagent.vercel.app')
const SKIP_PROD = process.argv.includes('--no-prod')
const STEP_KEYS = ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings']
const EXPECTED = new Set(['lpViews'])
let failures = 0
const fail = (m: string) => { failures++; console.log('  ✗ ' + m) }
const near = (a: any, b: any, tol = 0.01) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol)

async function prodGet(range: string, campaign: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${PROD}/api/funnel?range=${range}&campaign=${campaign}&nocache=1`, { cache: 'no-store' })
      if (r.ok) return await r.json()
    } catch {}
    await new Promise((s) => setTimeout(s, 3000))
  }
  throw new Error(`prod ${range} ${campaign} failed`)
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const q = items.slice()
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()!) }))
}

;(async () => {
  const ds = await getFunnelDatasets()
  console.log('== 3. BOFU: Σ ad sets = campaign per day')
  {
    const camp = new Map<string, number>(), ad = new Map<string, number>()
    for (const r of ds.fbSpend.rows) if (r.campaign === BOFU_CAMPAIGN) camp.set(r.day, (camp.get(r.day) || 0) + r.spend)
    for (const r of ds.adsets.rows) if (r.campaignId === BOFU_CAMPAIGN_ID) ad.set(r.day, (ad.get(r.day) || 0) + r.spend)
    let days = 0, bad: string[] = [], sc = 0, sa = 0
    for (const [d, v] of ad) { const c = camp.get(d) ?? 0; days++; sc += c; sa += v; if (Math.abs(c - v) > 2) bad.push(`${d} campaign ${c.toFixed(2)} ad sets ${v.toFixed(2)}`) }
    console.log(`  ${days} days · campaign €${sc.toFixed(2)} · ad sets €${sa.toFixed(2)} · Δ ${(sa - sc).toFixed(2)} (${sc ? (((sa - sc) / sc) * 100).toFixed(3) : 0} %) · days off by > €2: ${bad.length}`)
    bad.slice(0, 5).forEach((b) => console.log('    ' + b))
  }

  for (const rk of RANGES) {
    const range = resolveRange(rk, '', '')
    console.log(`\n==== ${rk} ${range.from}…${range.to}`)
    // ── 2. invariants
    const m = await loadFunnelNode({ node: 'master', range, channel: 'all' })
    const keys = ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings', 'revenue', 'spend'] as const
    console.log('  master', JSON.stringify(m.values))
    for (const c of m.children) console.log(`    ${c.id.padEnd(24)} spend ${c.values.spend} leads ${c.values.leads} ql ${c.values.ql} bk ${c.values.bookings} rvc ${c.values.revenue} lp ${c.values.lpViews}${c.estimate.spend ? ' (estimate)' : ''}`)
    console.log('    remainder              ', JSON.stringify(m.remainder?.values))
    const qlIncl = m.steps.find((s: any) => s.key === 'ql')?.qualityLeadsIncludingAsset
    for (const k of keys) {
      const total = k === 'ql' ? qlIncl : (m.values as any)[k]
      const s = m.children.reduce((n: number, c: any) => n + ((c.values as any)[k] ?? (k === 'leads' || k === 'ql' ? 0 : 0)), 0)
      const lm = 0 // lead magnet leads are shown null; its raw Streak count sits in the remainder math
      const rem = (m.remainder?.values as any)?.[k] ?? 0
      if (!near(total, s + rem + lm, k === 'spend' || k === 'revenue' ? 0.05 : 0.5)) fail(`${rk} master ${k}: total ${total} ≠ Σ funnels ${s} + remainder ${rem}`)
    }
    const qlStep = m.steps.find((s: any) => s.key === 'ql')?.value
    console.log(`  QL: step ${qlStep} (excl. ASSET) · qualityLeadsIncludingAsset ${qlIncl} · Σ funnels + remainder reconciles to the latter`)
    for (const f of FUNNELS) {
      const n = await loadFunnelNode({ node: `funnel:${f.key}`, range, channel: 'all' })
      const mc = m.children.find((c: any) => c.id === `funnel:${f.key}`)!
      for (const k of keys) {
        if (f.leadsNa && (k === 'leads' || k === 'ql')) continue
        if (!near((n.values as any)[k], (mc.values as any)[k], 0.05)) fail(`${rk} funnel:${f.key} ${k}: node ${(n.values as any)[k]} ≠ master child ${(mc.values as any)[k]}`)
        if (k === 'lpViews') continue
        const s = n.children.reduce((x: number, c: any) => x + ((c.values as any)[k] ?? 0), 0)
        const rem = (n.remainder?.values as any)?.[k] ?? 0
        const tot = (n.values as any)[k]
        if (tot != null && !near(tot, s + rem, k === 'spend' || k === 'revenue' ? 0.05 : 0.5)) fail(`${rk} funnel:${f.key} ${k}: ${tot} ≠ Σ campaigns ${s} + remainder ${rem}`)
      }
      const cov = n.coverage
      console.log(`    funnel:${f.key.padEnd(17)} campaigns ${String(n.children.length).padStart(3)} · leads on a campaign ${cov?.leads.share == null ? 'n/a' : (cov.leads.share * 100).toFixed(1) + ' %'} · bookings ${cov?.bookings.share == null ? 'n/a' : (cov.bookings.share * 100).toFixed(1) + ' %'}`)
    }
  }

  if (SKIP_PROD) { console.log(`\nfailures: ${failures}`); process.exit(failures ? 1 : 0) }
  // ── 1. regression vs production
  console.log('\n== 1. Regression vs production (legacy ?campaign=)')
  const jobs: { rk: string; c: string }[] = []
  for (const rk of RANGES) for (const c of ['master', ...CAMPAIGNS.map((x) => x.slug)]) jobs.push({ rk, c })
  const lpDiff: string[] = []
  await pool(jobs, 4, async ({ rk, c }) => {
    const range = resolveRange(rk, '', '')
    const [p, l] = await Promise.all([prodGet(rk, c), loadBusinessFunnel({ start: range.from, end: range.to, campaign: c, channel: 'all', range })])
    const pv: any = Object.fromEntries(p.steps.map((s: any) => [s.key, s.value]))
    const lv: any = Object.fromEntries(l.steps.map((s: any) => [s.key, s.value]))
    for (const k of STEP_KEYS) {
      if (near(pv[k], lv[k], 0.5)) continue
      const line = `${rk.padEnd(10)} ${c.padEnd(12)} ${k.padEnd(8)} prod ${pv[k]} → branch ${lv[k]}`
      if (EXPECTED.has(k) || (c === 'bofu' && k === 'leads')) lpDiff.push(line)
      else fail('UNEXPECTED ' + line)
    }
    if (!near(p.efficiency.spend, l.efficiency.spend, 0.05)) fail(`UNEXPECTED ${rk} ${c} spend prod ${p.efficiency.spend} → branch ${l.efficiency.spend}`)
  })
  console.log('  intended diffs (before = production, after = branch):')
  lpDiff.sort().forEach((x) => console.log('   ', x))
  console.log(`\nfailures: ${failures}`)
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
