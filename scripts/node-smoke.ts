import { loadFunnelNode } from '../src/lib/funnel-nodes'
import { resolveRange } from '../src/lib/business-funnel'
const node = process.argv[2] || 'master'
const range = resolveRange(process.argv[3] || 'this_month', '', '')
;(async () => {
  const t = Date.now()
  const r = await loadFunnelNode({ node, range, channel: 'all' })
  console.log(node, range.from, range.to, (Date.now() - t) + 'ms')
  console.log('values', JSON.stringify(r.values))
  for (const c of r.children) console.log(' ', c.id.padEnd(70), JSON.stringify(c.values), c.estimate.spend ? 'EST' : '')
  console.log('remainder', JSON.stringify(r.remainder?.values))
  console.log('coverage', JSON.stringify(r.coverage))
  console.log('previous', JSON.stringify(r.previous))
  console.log('bofu', JSON.stringify(r.bofuSplit))
  console.log('fresh', JSON.stringify(r.freshness.sources.map((s: any) => [s.key, s.dataThrough, s.stale])))
})().catch((e) => { console.error(e); process.exit(1) })
