import { NextResponse } from 'next/server'
import { loadTurkeyCampaign, TURKEY_CONFIG, type TurkeyCampaignResult } from '@/lib/turkey-campaign'

export const dynamic = 'force-dynamic'

// Slim CEO-level summary for the Goolets Content Portal "Published" tab.
// Same upstream loader as /api/turkey-campaign (10-min in-memory cache lives there),
// we just pick the fields a 5-second glance needs.

const TTL_MS = 10 * 60 * 1000
let cache: { at: number; data: unknown } | null = null

// ── GA4 web traffic for the Turkey funnel (Goolets Content Portal funnel tab, 2026-06-26) ──
// Seeds confirmed by Dejan: turkey / belgin / tosca / esma (+ arabella). Croatia pages excluded.
// Floored to the campaign window (May 1, 2026) to match the Streak funnel above.
const GA4_WEB_URL =
  'https://script.google.com/macros/s/AKfycby4WR2b5WyZ7qKcJvNUtYjGQPPVpJzFWAnF5SyJntvtNGwGaob-hCu4hAdECHmnRVfn/exec?tab=ga4_landing_pages'
const TURKEY_LP_RX = /turkey|belgin|tosca|esma|arabella/i
const GA4_FLOOR = '20260501'
function srcBucket(sm: string): string {
  const s = (sm || '').toLowerCase()
  if (/paid|cpc|ppc/.test(s)) {
    if (/face|insta|fb|meta|social/.test(s)) return 'Paid Social'
    if (/google|search|bing/.test(s)) return 'Paid Search'
    return 'Paid'
  }
  if (/organic/.test(s)) return 'Organic'
  if (/email/.test(s)) return 'Email'
  if (/referr/.test(s)) return 'Referral'
  if (/direct|\(none\)/.test(s)) return 'Direct'
  return 'Other'
}
async function buildTurkeyWeb() {
  try {
    const res = await fetch(GA4_WEB_URL, { cache: 'no-store' })
    const rows: any[] = await res.json()
    const t = rows.filter((x) => {
      const lp = String(x.landingPage || '')
      const d = String(x.date || '').replace(/[^0-9]/g, '').slice(0, 8)
      return TURKEY_LP_RX.test(lp) && !/croatia/i.test(lp) && d >= GA4_FLOOR
    })
    let sessions = 0, users = 0, conversions = 0
    const srcMap = new Map<string, number>()
    const pageMap = new Map<string, { s: number; c: number }>()
    for (const x of t) {
      const s = Number(x.sessions) || 0, u = Number(x.totalUsers) || 0, c = Number(x.conversions) || 0
      sessions += s; users += u; conversions += c
      const b = srcBucket(x.sessionSourceMedium)
      srcMap.set(b, (srcMap.get(b) || 0) + s)
      const p = pageMap.get(x.landingPage) || { s: 0, c: 0 }
      p.s += s; p.c += c; pageMap.set(x.landingPage, p)
    }
    const COLORS: Record<string, string> = {
      'Paid Social': '#B39262', 'Paid Search': '#2D8A4E', Organic: '#2C5F8A',
      Direct: '#6B4C8A', Referral: '#9a7c4f', Email: '#C4960C', Paid: '#b07b3a', Other: '#C4BFB5',
    }
    const sources = [...srcMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, s]) => ({ name, pct: sessions > 0 ? Math.round((s / sessions) * 100) : 0, color: COLORS[name] || '#C4BFB5' }))
    const top_pages = [...pageMap.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 6)
      .map(([page, v]) => ({ page, sessions: v.s, cvr: v.s > 0 ? (v.c / v.s) * 100 : 0 }))
    return { sessions, users, conversions, cvr: sessions > 0 ? (conversions / sessions) * 100 : 0, sources, top_pages }
  } catch (e) {
    console.error('[turkey-kpis] ga4 web failed', e)
    return null
  }
}

function zoneFor(total: number) {
  const t = TURKEY_CONFIG.thresholds
  if (total < t.warning) return 'bonus' // <€80K = nagrada
  if (total < t.target) return 'happy'  // €80K–€100K
  if (total < t.max) return 'ok'        // €100K–€140K
  return 'over'                          // >€140K
}

function summarize(d: TurkeyCampaignResult) {
  // Aggregate weeks across all yachts (Tosca 15 + Belgin 10 = 25).
  const target = d.fills.reduce((s, y) => s + y.target, 0)
  const booked = d.fills.reduce((s, y) => s + y.newFills, 0)
  const spend = d.costToFill.spent
  const cap = TURKEY_CONFIG.thresholds.target

  const blue1Rvc = d.columns.blue1.rvc || 0
  const blue2Rvc = d.columns.blue2.rvc || 0
  const blue = blue1Rvc + blue2Rvc
  const red = d.columns.red1.spend || 0

  // Per-yacht breakdown — Aymen wants explicit Tosca X/15, Belgin Y/10 with spend + rvc + ROI.
  const yachts = d.fills.map((y) => {
    const yachtRvc =
      y.id === 'tosca'  ? d.columns.blue1.tosca.rvc  :
      y.id === 'belgin' ? d.columns.blue1.belgin.rvc :
      y.attributedRvc || 0
    const yachtBookings =
      y.id === 'tosca'  ? d.columns.blue1.tosca.bookings  :
      y.id === 'belgin' ? d.columns.blue1.belgin.bookings :
      y.attributedBookings || 0
    const directSpend = y.directSpend || 0
    return {
      id: y.id,
      name: y.name,
      weeks: { booked: y.newFills, target: y.target, pct: y.target > 0 ? (y.newFills / y.target) * 100 : 0 },
      spend: directSpend,
      rvc: yachtRvc,
      bookings: yachtBookings,
      roi: directSpend > 0 ? yachtRvc / directSpend : null,
    }
  })

  // Cross-pollination = bookings on OTHER yachts driven by Turkey campaign leads.
  // Mitja's "Blue2" — RVC + bookings that didn't fall to Tosca/Belgin directly.
  const crossPollination = {
    rvc: blue2Rvc,
    bookings: d.columns.blue2.bookings || 0,
  }

  // Funnel rates — CEO wants the staircase visual (Leads → QL% → QL → YQL% → YQL → Close% → Bookings → AvgDeal → Revenue).
  const safePct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0)
  const revenue = (d.economics.totalBookings || 0) * (d.economics.earningsPerBooking || 0)

  return {
    as_of: d.generatedAt,
    title: 'Turkey 2026',
    deep_dive_url: 'https://gooletsaiagent.vercel.app/turkey-campaign',
    spend: {
      amount: spend,
      cap,
      pct: cap > 0 ? (spend / cap) * 100 : 0,
    },
    weeks: {
      booked,
      target,
      pct: target > 0 ? (booked / target) * 100 : 0,
    },
    cost_to_fill: {
      total: spend,
      per_week: booked > 0 ? spend / booked : null,
      zone: zoneFor(spend),
    },
    funnel: {
      // Top-of-funnel ad metrics (mirrors bta-app FULL FUNNEL screenshot)
      spend,
      impressions: d.traffic.impressions || 0,
      clicks: d.traffic.clicks || 0,
      cpm: d.traffic.impressions > 0 ? (spend / d.traffic.impressions) * 1000 : 0,
      ctr: safePct(d.traffic.clicks || 0, d.traffic.impressions || 0),
      leadRate: safePct(d.funnel.leads, d.traffic.clicks || 0),
      // Mid-to-bottom funnel
      leads: d.funnel.leads,
      ql: d.funnel.ql,
      yql: d.funnel.yachtQl,
      bookings: d.funnel.bookings,
      qlRate: safePct(d.funnel.ql, d.funnel.leads),
      yqlRate: safePct(d.funnel.yachtQl, d.funnel.ql),
      closeRate: safePct(d.funnel.bookings, d.funnel.yachtQl),
      avgDeal: d.economics.earningsPerBooking || 0,
      revenue,
    },
    balance: {
      blue,
      red,
      ratio: d.columns.ratio,
      status: d.columns.status, // 'push' | 'watch' | 'pull'
    },
    yachts,
    cross_pollination: crossPollination,
    // Per-yacht funnel split (Aymen mirror of bta-app "PER-YACHT BREAKDOWN" table).
    // 3 rows: tosca, belgin, turkey/generic-LP — each shows leads → ql → yqlAll with YQL%.
    per_yacht_funnel: d.perYachtQl.map((y) => ({
      id: y.id,
      name: y.name,                    // "TOSCA" | "BELGIN SULTAN" | "Turkey (generic LP)"
      leads: y.leads,
      ql: y.ql,
      yacht_ql: y.yachtQl,
      yacht_ql_pct: y.yachtQlRatio || 0, // safeDiv already returns *100 (percent), not fraction
    })),
  }
}

export async function GET(req: Request) {
  // Permissive CORS so the portal (different origin) can fetch directly.
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  try {
    if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json(cache.data, { headers })
    }
    const data = await loadTurkeyCampaign()
    // 0 leads = an upstream sheet fetch came back empty this compute (not real data).
    // Never cache/serve zeros — serve last-good instead (see /api/turkey-campaign for the same guard).
    if ((data?.funnel?.leads ?? 0) <= 0 || (data?.columns?.red1?.fbSpend ?? 0) <= 0) {
      console.warn('[turkey-kpis] partial compute (0 leads or 0 FB spend) — serving last-good, not caching')
      if (cache) return NextResponse.json(cache.data, { headers })
      const summary0: Record<string, unknown> = summarize(data)
      return NextResponse.json(summary0, { headers })
    }
    const summary: Record<string, unknown> = summarize(data)
    summary.web = await buildTurkeyWeb() // GA4 sessions/users/CVR + source split + top LPs (null if GA4 unavailable)
    cache = { at: Date.now(), data: summary }
    return NextResponse.json(summary, { headers })
  } catch (err) {
    console.error('[turkey-kpis] failed', err)
    if (cache) return NextResponse.json(cache.data, { headers })
    return NextResponse.json({ error: 'Failed to load Turkey KPI summary' }, { status: 500, headers })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
