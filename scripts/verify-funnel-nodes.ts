// Verify the node API against production + its own invariants.
//   npx tsx scripts/verify-funnel-nodes.ts [--ranges this_month,last_month,3m,ytd] [--prod https://gooletsaiagent.vercel.app]
// 1. Regression: legacy master + 16 umbrellas, local (this branch) vs production, per range.
//    Expected diffs only: lpViews (umbrella LP views restricted to the platforms it spends on,
//    ASSET lp regex) and bofu leads (sp ^bofu_). Everything else must be identical.
// 2. Invariants: master node — Σ funnels + remainder = master (QL vs qualityLeadsIncludingAsset);
//    every funnel node = its master child; Σ campaign children + remainder = funnel.
// 3. BOFU: Σ ad sets (fb_adset_daily_api) = campaign (fb_daily_api) per day.
import { CAMPAIGNS, getFunnelDatasets, loadBusinessFunnel, resolveRange } from '../src/lib/business-funnel'
import { loadFunnelNode, lpOfNode, copyPartsForVerify } from '../src/lib/funnel-nodes'
import { FUNNELS, BOFU_CAMPAIGN, BOFU_CAMPAIGN_ID, LEAD_FORM_LP } from '../src/lib/funnel-groups'

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

  console.log('== 3b. Σ ad sets = campaign and Σ ads = ad set, per day (all Meta campaigns)')
  {
    const camp = new Map<string, number>(), as = new Map<string, number>(), asById = new Map<string, number>(), adByAs = new Map<string, number>()
    for (const r of ds.fbSpend.rows) camp.set(`${r.campaign}|${r.day}`, (camp.get(`${r.campaign}|${r.day}`) || 0) + r.spend)
    for (const r of ds.adsets.rows) { as.set(`${r.campaign}|${r.day}`, (as.get(`${r.campaign}|${r.day}`) || 0) + r.spend); asById.set(`${r.adsetId}|${r.day}`, (asById.get(`${r.adsetId}|${r.day}`) || 0) + r.spend) }
    for (const r of ds.ads.rows) adByAs.set(`${r.adsetId}|${r.day}`, (adByAs.get(`${r.adsetId}|${r.day}`) || 0) + r.spend)
    let n = 0, off = 0, sc = 0, sa = 0
    for (const [k, v] of as) { n++; const c = camp.get(k) ?? 0; sc += c; sa += v; if (Math.abs(c - v) > 2) off++ }
    console.log(`  ad sets: ${n} campaign-days · campaign €${sc.toFixed(2)} · ad sets €${sa.toFixed(2)} · off by > €2: ${off}`)
    let m = 0, off2 = 0, s1 = 0, s2 = 0
    for (const [k, v] of adByAs) { m++; const c = asById.get(k) ?? 0; s1 += c; s2 += v; if (Math.abs(c - v) > 2) off2++ }
    console.log(`  ads: ${m} ad-set-days · ad sets €${s1.toFixed(2)} · ads €${s2.toFixed(2)} · off by > €2: ${off2} (the funnel only uses complete campaign-days)`)
  }

  for (const rk of RANGES) {
    const range = resolveRange(rk, '', '')
    console.log(`\n==== ${rk} ${range.from}…${range.to}`)
    // ── 2. invariants
    const m = await loadFunnelNode({ node: 'master', range, channel: 'all' })
    const keys = ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings', 'revenue', 'spend', 'activeOpps'] as const
    console.log('  master', JSON.stringify(m.values))
    { const bd = (m as any).bofuSplit?.days; if (bd?.unsplit) fail(`${rk} BOFU split: ${bd.unsplit} real hole day(s) (pending ${bd.pending}, noDelivery ${bd.noDelivery})`); else console.log(`  BOFU days ${JSON.stringify(bd)}`) }
    { const lmr: any = m.children.find((c: any) => c.id === 'funnel:lead_magnet'); if (!lmr || lmr.values.emails == null) fail(`${rk} master lead_magnet row has no emails`) }
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
    for (const lv of ['campaign', 'adset', 'ad', 'lp'] as const) {
      const n = await loadFunnelNode({ node: 'master', range, channel: 'all', level: lv })
      for (const k of keys) {
        if (k === 'lpViews') continue
        const total = k === 'ql' ? qlIncl : (m.values as any)[k]
        const sm = n.children.reduce((x: number, c: any) => x + ((c.values as any)[k] ?? 0), 0) + ((n.remainder?.values as any)?.[k] ?? 0)
        if (!near(total, sm, k === 'spend' || k === 'revenue' ? 0.05 : 0.5)) fail(`${rk} master level=${lv} ${k}: ${total} ≠ Σ ${sm}`)
      }
      if (lv === 'lp') {
        // canonical LP keys only: host/path/ with no query, fragment, {ValueTrack}, whitespace, double slash, undefined / null / (not set) segment
        const okKey = (k: string) => k === LEAD_FORM_LP || (/^[a-z0-9.-]+\/([^/\s?#{}&=]+\/)*$/.test(k) && !k.split('/').some((x) => ['undefined', 'null', 'nan', '(not set)'].includes(x)))
        const junk = n.children.map((c: any) => lpOfNode(c.id)).filter((k: string) => !okKey(k))
        if (junk.length) fail(`${rk} level=lp junk LP keys: ${junk.slice(0, 5).join(' | ')}`)
        if (new Set(n.children.map((c: any) => c.id)).size !== n.children.length) fail(`${rk} level=lp duplicate LP ids`)
      }
      const cv: any = n.coverage
      console.log(`  level=${lv.padEnd(8)} items ${String(n.children.length).padStart(4)} · leads ${cv?.leads.share == null ? 'n/a' : (cv.leads.share * 100).toFixed(1) + ' %'} · QL ${cv?.ql.share == null ? 'n/a' : (cv.ql.share * 100).toFixed(1) + ' %'} · bookings ${cv?.bookings.share == null ? 'n/a' : (cv.bookings.share * 100).toFixed(1) + ' %'} · spend ${cv?.spend.share == null ? 'n/a' : (cv.spend.share * 100).toFixed(1) + ' %'}`)
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

  // ── 4. Visitors: a campaign / ad set NODE equals its ROW one level up (GA4 by utm, same quality)
  console.log('\n== 4. Visitors row = node (campaign rows of every funnel, ad set rows of the top Meta campaigns)')
  for (const rk of RANGES.slice(0, 2)) {
    const range = resolveRange(rk, '', '')
    let n = 0, approx = 0
    const metaCamps: string[] = []
    for (const f of FUNNELS) {
      const fn = await loadFunnelNode({ node: `funnel:${f.key}`, range, channel: 'all', level: 'campaign' })
      for (const c of fn.children) {
        const nd: any = await loadFunnelNode({ node: c.id, range, channel: 'all' })
        n++
        if (nd.values.lpViews !== c.values.lpViews) fail(`${rk} ${c.id} lpViews: row ${c.values.lpViews} ≠ node ${nd.values.lpViews}`)
        if (nd.quality?.lpViews !== c.quality.lpViews) fail(`${rk} ${c.id} quality.lpViews: row ${c.quality.lpViews} ≠ node ${nd.quality?.lpViews}`)
        const st = nd.steps.find((s: any) => s.key === 'lpViews')
        if (st && st.value !== nd.values.lpViews) fail(`${rk} ${c.id} steps[lpViews] ${st.value} ≠ values.lpViews ${nd.values.lpViews}`)
        if (c.quality.lpViews === 'approx') { approx++; console.log(`    approx · ${f.key} · ${c.label} · clicks ${c.values.clicks} · visitors ${c.values.lpViews}`) }
        if (c.platform === 'meta' && (c.values.spend || 0) > 0) metaCamps.push(c.id)
      }
    }
    let m = 0
    for (const cid of metaCamps.slice(0, 6)) {
      const cn = await loadFunnelNode({ node: cid, range, channel: 'all', level: 'adset' })
      for (const a of cn.children.slice(0, 5)) {
        const an: any = await loadFunnelNode({ node: a.id, range, channel: 'all' })
        m++
        if (an.values.lpViews !== a.values.lpViews) fail(`${rk} ${a.id} lpViews: row ${a.values.lpViews} ≠ node ${an.values.lpViews}`)
        if (an.quality?.lpViews !== a.quality.lpViews) fail(`${rk} ${a.id} quality.lpViews: row ${a.quality.lpViews} ≠ node ${an.quality?.lpViews}`)
      }
      const s = cn.children.reduce((x: number, c: any) => x + (c.values.lpViews ?? 0), 0)
      const tot = (cn.values as any).lpViews
      if (tot != null && !near(tot, s + ((cn.remainder?.values as any)?.lpViews ?? 0), 0.5)) fail(`${rk} ${cid} lpViews ${tot} ≠ Σ ad sets ${s} + remainder`)
    }
    console.log(`  ${rk}: ${n} campaign nodes, ${m} ad set nodes checked · ${approx} campaign row(s) quality.lpViews approx`)
  }

  // ── 5. Real HTTP route (local dev server of this branch): level=lp + index
  const LOCAL = arg('local', 'http://localhost:3011')
  if (!process.argv.includes('--no-http')) {
    console.log(`\n== 5. HTTP ${LOCAL}/api/funnel …&level=lp and /api/funnel/index?levels=all`)
    const get = async (path: string) => {
      const r = await fetch(`${LOCAL}${path}`, { cache: 'no-store' })
      const body: any = await r.json().catch(() => null)
      return { status: r.status, body }
    }
    const rk = RANGES[0]
    const fe = await loadFunnelNode({ node: 'funnel:eb_croatia', range: resolveRange(rk, '', ''), channel: 'all', level: 'campaign' })
    const camp = fe.children.find((c: any) => c.platform === 'meta' && (c.values.spend || 0) > 0)!
    const cAd = await loadFunnelNode({ node: camp.id, range: resolveRange(rk, '', ''), channel: 'all', level: 'adset' })
    const adset = cAd.children.find((c: any) => (c.values.spend || 0) > 0)!
    const lpIds = new Set<string>()
    for (const node of ['master', 'funnel:eb_croatia', camp.id, adset.id]) {
      const { status, body } = await get(`/api/funnel?range=${rk}&node=${encodeURIComponent(node)}&level=lp&nocache=1`)
      if (status !== 200) { fail(`HTTP ${status} for node=${node}&level=lp: ${JSON.stringify(body).slice(0, 200)}`); continue }
      for (const c of body.children) lpIds.add(c.id)
      const tot = body.values.spend, s = body.children.reduce((x: number, c: any) => x + (c.values.spend ?? 0), 0) + (body.remainder?.values.spend ?? 0)
      if (!near(tot, s, 0.05)) fail(`HTTP ${node} level=lp spend ${tot} ≠ Σ ${s}`)
      if (node !== 'master' && node !== 'funnel:eb_croatia') {
        const row = node === camp.id ? camp : adset
        if (body.values.lpViews !== row.values.lpViews) fail(`HTTP node ${node} lpViews ${body.values.lpViews} ≠ row ${row.values.lpViews}`)
      }
      console.log(`  200 · node=${node.slice(0, 50).padEnd(50)} level=lp · ${String(body.children.length).padStart(3)} LPs · lpViews ${body.values.lpViews} (${body.quality?.lpViews}) · spend Σ+remainder = node`)
    }
    const bad = await get(`/api/funnel?range=${rk}&node=master&level=bogus`)
    if (bad.status !== 400) fail(`level=bogus should be 400, got ${bad.status}`)
    const idx = await get(`/api/funnel/index?range=${rk}&levels=all&nocache=1`)
    if (idx.status !== 200) fail(`index HTTP ${idx.status}`)
    else {
      const ids = new Set<string>(idx.body.items.map((i: any) => i.id))
      const missing = [...lpIds].filter((id) => !ids.has(id))
      if (missing.length) fail(`index misses ${missing.length} LP(s) shown in a level=lp list: ${missing.slice(0, 5).join(', ')}`)
      const ifm = 'lp:' + encodeURIComponent('meta-instant-form/')
      if (lpIds.has(ifm) && !ids.has(ifm)) fail('index misses meta-instant-form/')
      console.log(`  index levels=all: ${idx.body.items.filter((i: any) => i.type === 'lp').length} LPs · every LP from the 4 lists present: ${missing.length === 0} · meta-instant-form/ ${ids.has(ifm) ? 'present' : 'absent'}`)
    }
  }

  // ── 9. Lead magnet step model: Σ rows + remainder = node for e-mails / later leads
  console.log('\n== 9. Lead magnet (stepModel lead_magnet)')
  for (const rk of RANGES) {
    const n: any = await loadFunnelNode({ node: 'funnel:lead_magnet', range: resolveRange(rk, '', ''), channel: 'all', level: 'campaign' })
    if (n.node.stepModel !== 'lead_magnet' || !n.lmSteps) { fail(`${rk} lead_magnet stepModel / lmSteps missing`); continue }
    for (const k of ['emails', 'laterLeads', 'laterQl']) {
      const sum = n.children.reduce((x: number, c: any) => x + (c.values[k] ?? 0), 0) + (n.remainder?.values[k] ?? 0)
      if (sum !== n.values[k]) fail(`${rk} lead_magnet ${k} ${n.values[k]} ≠ Σ ${sum}`)
    }
    const m: any = await loadFunnelNode({ node: 'master', range: resolveRange(rk, '', ''), channel: 'all' })
    if (m.values.emails != null || m.lmSteps) fail(`${rk} master must not carry lead-magnet steps`)
    console.log(`  ${rk}: e-mails ${n.values.emails} · later inquiries ${n.values.laterLeads} · QL ${n.values.laterQl} · master untouched`)
  }

  // ── 8. Sales stages: Σ rows + remainder = node per stage bucket
  console.log('\n== 8. salesStages / values.stage (current Streak stage)')
  for (const rk of RANGES) {
    const range = resolveRange(rk, '', '')
    let checked = 0
    for (const [node, lv] of [['master', 'funnel'], ['master', 'campaign'], ['funnel:eb_croatia', 'campaign'], ['funnel:eb_croatia', 'adset'], ['master', 'lp'], ['master', 'copy']] as const) {
      const n: any = await loadFunnelNode({ node, range, channel: 'all', level: lv })
      const st = n.values.stage; if (!st) { fail(`${rk} ${node} values.stage missing`); continue }
      for (const k of Object.keys(st)) {
        const sum = n.children.reduce((x: number, c: any) => x + (c.values.stage?.[k] ?? 0), 0) + (n.remainder?.values.stage?.[k] ?? 0)
        if (!near(st[k], sum, 0.01)) fail(`${rk} ${node} level=${lv} stage.${k} ${st[k]} ≠ Σ ${sum}`)
        checked++
      }
      for (const k of Object.keys(n.values.stageEver || {})) {
        const sum = n.children.reduce((x: number, c: any) => x + (c.values.stageEver?.[k] ?? 0), 0) + (n.remainder?.values.stageEver?.[k] ?? 0)
        if (!near(n.values.stageEver[k], sum, 0.01)) fail(`${rk} ${node} level=${lv} stageEver.${k} ${n.values.stageEver[k]} ≠ Σ ${sum}`)
        checked++
      }
      { const sum = n.children.reduce((x: number, c: any) => x + (c.values.activeOppsEver ?? 0), 0) + (n.remainder?.values.activeOppsEver ?? 0)
        if (!near(n.values.activeOppsEver, sum, 0.01)) fail(`${rk} ${node} level=${lv} activeOppsEver ${n.values.activeOppsEver} ≠ Σ ${sum}`) }
      const tot = Object.values(st).reduce((x: number, v: any) => x + v, 0) as number
      const leadsTot = node === 'master' ? n.values.leads : n.values.leads
      if (!near(tot, leadsTot, 0.5)) fail(`${rk} ${node} Σ stage buckets ${tot} ≠ leads ${leadsTot}`)
      if (!n.steps.find((x: any) => x.key === 'bookings')?.salesStages) fail(`${rk} ${node} steps[bookings].salesStages missing`)
    }
    const m: any = await loadFunnelNode({ node: 'master', range, channel: 'all' })
    console.log(`  ${rk}: ${checked} stage sums checked · master unqualifiedShare ${m.values.unqualifiedShare == null ? 'n/a' : (m.values.unqualifiedShare * 100).toFixed(1) + ' %'} (${m.values.unqualified}/${m.values.humanStaged}) · stages ${JSON.stringify(m.values.stage)}`)
  }

  // ── 7. Video: hook / hold rate (Σ children video counts vs node)
  console.log('\n== 7. Video counts (hookRate = 3-s views / video-ad impressions)')
  for (const rk of RANGES) {
    const range = resolveRange(rk, '', '')
    const out: string[] = []
    for (const [node, lv] of [['master', 'funnel'], ['master', 'campaign'], ['master', 'ad'], ['funnel:eb_croatia', 'campaign'], ['master', 'lp'], ['master', 'copy']] as const) {
      const n: any = await loadFunnelNode({ node, range, channel: 'all', level: lv })
      const tot = n.video?.views3s ?? 0
      const sum = n.children.reduce((x: number, c: any) => x + (c.video?.views3s ?? 0), 0)
      if (sum > tot + 1) fail(`${rk} ${node} level=${lv} Σ children 3-s views ${sum} > node ${tot}`)
      if ((lv === 'campaign' && node === 'master') || lv === 'ad') { if (Math.abs(sum - tot) > Math.max(1, tot * 0.001)) fail(`${rk} ${node} level=${lv} Σ 3-s views ${sum} ≠ node ${tot}`) }
      for (const c of n.children) {
        const v = c.video
        if (v && v.videoImpressions > 0 && c.values.hookRate == null) fail(`${rk} ${c.id} hookRate null with video impressions`)
        if (v && v.videoImpressions === 0 && c.values.hookRate != null) fail(`${rk} ${c.id} hookRate on an image-only row`)
      }
      out.push(`${node}/${lv} Σ ${Math.round(sum)} of ${Math.round(tot)} (${tot ? ((sum / tot) * 100).toFixed(1) : 'n/a'} %)`)
    }
    const m: any = await loadFunnelNode({ node: 'master', range, channel: 'all' })
    console.log(`  ${rk}: hookRate ${m.values.hookRate == null ? 'n/a' : (m.values.hookRate * 100).toFixed(1) + ' %'} · holdRate ${m.values.holdRate == null ? 'n/a' : (m.values.holdRate * 100).toFixed(1) + ' %'} · video share of Meta spend ${m.values.videoSpendShare == null ? 'n/a' : (m.values.videoSpendShare * 100).toFixed(1) + ' %'} · ${out.join(' · ')}`)
  }

  // ── 6. Ad copy (part 4)
  console.log('\n== 6. level=copy and copy nodes')
  for (const rk of RANGES) {
    const range = resolveRange(rk, '', '')
    const keys6 = ['impressions', 'clicks', 'leads', 'ql', 'bookings', 'revenue', 'spend'] as const
    const m = await loadFunnelNode({ node: 'master', range, channel: 'all', level: 'copy' })
    const qlIncl = m.steps.find((s: any) => s.key === 'ql')?.qualityLeadsIncludingAsset
    for (const k of keys6) {
      const total = k === 'ql' ? qlIncl : (m.values as any)[k]
      const sm = m.children.reduce((x: number, c: any) => x + (c.values[k] ?? 0), 0) + ((m.remainder?.values as any)?.[k] ?? 0)
      if (!near(total, sm, k === 'spend' || k === 'revenue' ? 0.05 : 0.5)) fail(`${rk} master level=copy ${k}: ${total} ≠ Σ ${sm}`)
    }
    // remainder.parts sum exactly to the remainder (master, a funnel, a campaign)
    for (const nd of [m, await loadFunnelNode({ node: 'funnel:eb_croatia', range, channel: 'all', level: 'copy' })]) {
      const parts: any[] = (nd.remainder as any)?.parts || []
      if (parts.length !== 4) fail(`${rk} ${nd.node.id} level=copy remainder.parts missing (${parts.length})`)
      for (const k of keys6) {
        const r = (nd.remainder?.values as any)?.[k]
        if (r == null) continue
        const sp = parts.reduce((x, p) => x + (p.values[k] ?? 0), 0)
        if (!near(r, sp, 0.01)) fail(`${rk} ${nd.node.id} remainder ${k} ${r} ≠ Σ parts ${sp}`)
      }
      if (rk === RANGES[0]) console.log(`  ${nd.node.id} remainder.parts spend: ${parts.map((p) => `${p.key} ${Math.round(p.values.spend)}`).join(' · ')} · leads: ${parts.map((p) => `${p.key} ${Math.round(p.values.leads * 10) / 10}`).join(' · ')}`)
    }
    // Σ parts of each ad = the ad (ad level row)
    const parts = await copyPartsForVerify(range, 'all', (m.meta as any).effectiveWindow)
    const adL = await loadFunnelNode({ node: 'master', range, channel: 'all', level: 'ad' })
    const byAd = new Map<string, any>()
    for (const p of parts.parts) { const x = byAd.get(p.adId) || { n: 0, multi: p.multi }; x.n++; for (const k of ['impressions', 'clicks', 'spend', 'leads', 'ql', 'bookings', 'revenue'] as const) x[k] = (x[k] || 0) + p.values[k]; byAd.set(p.adId, x) }
    let multiAds = 0, checked = 0
    for (const c of adL.children) {
      const x = byAd.get(c.id.replace(/^ad:meta:/, '')); if (!x || !x.multi) continue
      multiAds++
      // only ads whose every part has a resolved text are whole; others keep a part in the remainder
      const full = parts.parts.filter((p) => p.adId === c.id.replace(/^ad:meta:/, '')).length === x.n
      if (!full) continue
      for (const k of ['spend', 'leads', 'bookings'] as const) if (x[k] > (c.values as any)[k] + 0.06) fail(`${rk} ${c.id} Σ parts ${k} ${x[k]} > ad ${(c.values as any)[k]}`)
      checked++
    }
    // a multi-text ad whose texts all resolve: Σ parts = ad exactly
    let exact = 0
    const lost = new Set<string>()
    const fl = parts.flags
    for (const c of adL.children) {
      const id = c.id.replace(/^ad:meta:/, ''); const x = byAd.get(id); if (!x || !x.multi) continue
      const near2 = (k: 'spend' | 'leads' | 'impressions') => Math.abs(x[k] - ((c.values as any)[k] ?? 0)) <= (k === 'spend' ? 0.05 : 0.5)
      if (near2('spend') && near2('leads') && near2('impressions')) exact++; else lost.add(id)
    }
    const share = (v: number, t: number) => (t ? ((v / t) * 100).toFixed(1) + ' %' : 'n/a')
    const cov: any = m.coverage
    const multiSpend = parts.parts.filter((p) => p.multi).reduce((n, p) => n + p.values.spend, 0)
    const multiLeads = parts.parts.filter((p) => p.multi).reduce((n, p) => n + p.values.leads, 0)
    console.log(`  ${rk}: ${m.children.length} texts · multi-text ads ${multiAds} (Σ parts = ad on ${exact}, a part in the remainder on ${lost.size}) · multi-text share of Meta copy spend ${share(multiSpend, parts.parts.reduce((n, p) => n + p.values.spend, 0))}, of copy leads ${share(multiLeads, parts.parts.reduce((n, p) => n + p.values.leads, 0))} · coverage spend ${cov?.spend.share == null ? 'n/a' : (cov.spend.share * 100).toFixed(1) + ' %'} leads ${cov?.leads.share == null ? 'n/a' : (cov.leads.share * 100).toFixed(1) + ' %'} · remainder flags ${JSON.stringify(fl)}`)
    void checked
    // copy node = its row
    for (const row of [...m.children.slice(0, 5), ...m.children.filter((c: any) => c.leadsBelowBookings).slice(0, 3)]) {
      const n: any = await loadFunnelNode({ node: row.id, range, channel: 'all' })
      for (const k of keys6) if (!near(n.values[k], (row.values as any)[k], k === 'spend' || k === 'revenue' ? 0.05 : 0.01)) fail(`${rk} ${row.id} ${k}: node ${n.values[k]} ≠ row ${(row.values as any)[k]}`)
      const rw: any = row
      if (!!n.node.leadsBelowBookings !== !!rw.leadsBelowBookings) fail(`${rk} ${row.id} leadsBelowBookings node ${n.node.leadsBelowBookings} ≠ row ${rw.leadsBelowBookings}`)
      if (JSON.stringify(n.estimate) !== JSON.stringify(rw.estimate)) fail(`${rk} ${row.id} estimate node ≠ row`)
      for (const g of ['measured', 'estimated'] as const) for (const [k, v] of Object.entries(rw.split?.[g] || {})) if (!near(n.split?.[g]?.[k], v, 0.01)) fail(`${rk} ${row.id} split.${g}.${k} node ${n.split?.[g]?.[k]} ≠ row ${v}`)
      for (const lv of ['ad', 'adset', 'campaign', 'lp'] as const) {
        const l: any = await loadFunnelNode({ node: row.id, range, channel: 'all', level: lv })
        for (const k of keys6) {
          const sm = l.children.reduce((x: number, c: any) => x + (c.values[k] ?? 0), 0) + (l.remainder?.values[k] ?? 0)
          if (!near(l.values[k], sm, k === 'spend' || k === 'revenue' ? 0.05 : 0.01)) fail(`${rk} ${row.id} level=${lv} ${k}: ${l.values[k]} ≠ Σ ${sm}`)
        }
      }
    }
  }
  if (!process.argv.includes('--no-http')) {
    const LOCAL6 = arg('local', 'http://localhost:3011')
    const rk = RANGES[0]
    // retry: the dev server drops idle keep-alive sockets (ECONNRESET) after the long direct checks above
    const get = async (p: string) => {
      for (let i = 0; ; i++) {
        try { const r = await fetch(`${LOCAL6}${p}`, { cache: 'no-store' }); return { status: r.status, body: (await r.json().catch(() => null)) as any } }
        catch (e) { if (i >= 2) throw e; await new Promise((s) => setTimeout(s, 1000)) }
      }
    }
    const fe = await loadFunnelNode({ node: 'funnel:eb_croatia', range: resolveRange(rk, '', ''), channel: 'all', level: 'campaign' })
    const camp = fe.children.find((c: any) => c.platform === 'meta' && (c.values.spend || 0) > 0)!
    const cAd = await loadFunnelNode({ node: camp.id, range: resolveRange(rk, '', ''), channel: 'all', level: 'adset' })
    const adset = cAd.children.find((c: any) => (c.values.spend || 0) > 0)!
    const ml = await loadFunnelNode({ node: 'master', range: resolveRange(rk, '', ''), channel: 'all', level: 'lp' })
    const lp = ml.children.find((c: any) => (c.values.spend || 0) > 0)!
    const ids = new Set<string>()
    for (const node of ['master', 'funnel:eb_croatia', camp.id, adset.id, lp.id]) {
      const { status, body } = await get(`/api/funnel?range=${rk}&node=${encodeURIComponent(node)}&level=copy&nocache=1`)
      if (status !== 200) { fail(`HTTP ${status} node=${node}&level=copy ${JSON.stringify(body).slice(0, 160)}`); continue }
      for (const c of body.children) ids.add(c.id)
      const s = body.children.reduce((x: number, c: any) => x + (c.values.spend ?? 0), 0) + (body.remainder?.values.spend ?? 0)
      if (!near(body.values.spend, s, 0.05)) fail(`HTTP ${node} level=copy spend ${body.values.spend} ≠ Σ ${s}`)
      if (body.coverage?.level !== 'copy' && body.children.length) fail(`HTTP ${node} coverage.level ${body.coverage?.level}`)
      console.log(`  200 · node=${node.slice(0, 50).padEnd(50)} level=copy · ${String(body.children.length).padStart(3)} texts · spend Σ+remainder = node`)
    }
    const top = [...ids][0]
    if (top) {
      const n = await get(`/api/funnel?range=${rk}&node=${encodeURIComponent(top)}&nocache=1`)
      if (n.status !== 200 || n.body?.node?.type !== 'copy' || !n.body?.node?.text) fail(`HTTP copy node ${top}: ${n.status}`)
      const nl = await get(`/api/funnel?range=${rk}&node=${encodeURIComponent(top)}&level=lp&nocache=1`)
      if (nl.status !== 200) fail(`HTTP copy node level=lp ${nl.status}`)
    }
    const t = await get(`/api/funnel?range=${rk}&node=master&level=copy&copyField=title`)
    if (t.status !== 400) fail(`copyField=title should be 400 (not available yet), got ${t.status}`)
    const idx = await get(`/api/funnel/index?range=${rk}&levels=all&nocache=1`)
    const iids = new Set<string>((idx.body?.items || []).map((i: any) => i.id))
    const miss = [...ids].filter((i) => !iids.has(i))
    if (miss.length) fail(`index misses ${miss.length} copy id(s)`)
    console.log(`  index levels=all: ${(idx.body?.items || []).filter((i: any) => i.type === 'copy').length} copy entries · every listed text present: ${!miss.length}`)
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
