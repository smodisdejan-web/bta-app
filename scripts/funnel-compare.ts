import { loadFunnelNode } from '../src/lib/funnel-nodes'
import { resolveRange } from '../src/lib/business-funnel'
;(async () => {
  for (const rk of ['this_month', '3m', 'ytd']) {
    const r = await loadFunnelNode({ node: 'master', range: resolveRange(rk, '', ''), channel: 'all' })
    for (const c of r.children.filter((c: any) => /turkey|asset/.test(c.id))) console.log(rk.padEnd(10), c.id.padEnd(14), JSON.stringify(c.values))
  }
})()
