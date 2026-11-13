import { loadFunnelNode } from '../src/lib/funnel-nodes'
import { resolveRange } from '../src/lib/business-funnel'
const [node = 'master', rk = 'this_month', level] = process.argv.slice(2)
;(async () => {
  const r: any = await loadFunnelNode({ node, range: resolveRange(rk, '', ''), channel: 'all', level: (level as any) || undefined })
  console.log(node, rk, level, 'levels', r.levels, 'level', r.level, 'node', JSON.stringify(r.node.path.map((p: any) => p.label)))
  console.log(' values', JSON.stringify(r.values))
  for (const c of r.children.slice(0, 8)) console.log('  ', c.type, c.id.slice(0, 60), JSON.stringify(c.values), c.quality.leads, c.movedBy || '', (c.path || []).join(' › ').slice(0, 80))
  console.log(' children', r.children.length, 'remainder', JSON.stringify(r.remainder?.values))
  console.log(' coverage', JSON.stringify(r.coverage))
  if (r.singleYachtMoves) { console.log(' moves', r.singleYachtMoves.length); for (const m of r.singleYachtMoves.slice(0, 40)) console.log('   ', m.type, m.rule, m.from, '→', m.to, m.spend, '|', m.campaign.slice(0, 40), '|', (m.adset || '').slice(0, 30), '|', m.label.slice(0, 50)) }
})().catch((e) => { console.error(e); process.exit(1) })
