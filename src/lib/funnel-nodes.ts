// src/lib/funnel-nodes.ts
//
// Node layer of the Business Health Funnel (2026-11-13, part 1).
//
//   node = master | funnel:<key> | umbrella:<slug> | campaign:<platform>:<key>[|<funnel>]
//
// Every node answers with the SAME shape as /api/funnel (steps, efficiency, benchmarks, notes …)
// plus: node, funnels, children, remainder, previous, coverage, freshness.
// Children + remainder = node for every additive metric (spend, impressions, clicks, leads, QL,
// bookings, revenue; LP views on master → funnels). Nothing is spread: a row that cannot be
// placed lower stays in the remainder.
//
// One assignment per dataset load (memoised on the Datasets object): every Meta campaign-day row,
// Google row, Streak lead, booking and GA4 path gets ONE funnel and (where possible) ONE campaign,
// with the precedence documented in lib/funnel-groups.ts. The BOFU campaign is split by ad set
// from fb_adset_daily_api; days the feed does not cover use the MTD ad set shares of
// src/data/bofu-adset-mtd.json (flagged `estimate`), and days outside both stay unsplit in
// EB Croatia (flagged).

import {
  CAMPAIGNS,
  UMBRELLA_ORDER,
  adSlug,
  aggregate,
  aggregateScope,
  bookingChannel,
  getFunnelDatasets,
  isFlatChannelLead,
  leadChannel,
  loadBusinessFunnel,
  nk,
  todayLjubljana,
  type AggOpts,
  type Channel,
  type Datasets,
  type MetaShare,
  type NodeScope,
  type RawStepValues,
  type ResolvedRange,
} from './business-funnel'
import { matchSourceToCampaignCandidates } from './fuzzy-match'
import {
  BOFU_CAMPAIGN,
  BOFU_CAMPAIGN_ID,
  BOFU_FUNNEL_GENERIC,
  BOFU_FUNNEL_YACHT,
  BOFU_YACHT_ADSET,
  BOFU_YACHT_LANDING,
  BOFU_YACHT_SP,
  CAMPAIGN_FUNNEL,
  FUNNELS,
  FUNNEL_BY_KEY,
  LP_FUNNEL_OVERRIDES,
  UMBRELLA_FUNNEL,
  type FunnelKey,
} from './funnel-groups'
import bofuMtd from '../data/bofu-adset-mtd.json'

type FunnelResponse = Awaited<ReturnType<typeof loadBusinessFunnel>>

// ─── Public types ───────────────────────────────────────────────────────────

export type NodeType = 'master' | 'funnel' | 'umbrella' | 'campaign'

export interface NodeValues {
  impressions: number | null
  clicks: number | null
  lpViews: number | null
  leads: number | null
  ql: number | null
  bookings: number | null
  revenue: number | null
  spend: number | null
  roas: number | null
}

export interface NodeEstimate {
  spend: boolean
  impressions: boolean
  clicks: boolean
}

export interface NodeChild {
  id: string
  type: NodeType
  label: string
  platform: 'meta' | 'google' | null
  nonKpi: boolean
  drillable: boolean
  values: NodeValues
  /** How each value was obtained: exact | approx (allocated from shares) | n/a */
  quality: { spend: 'exact' | 'approx'; lpViews: 'exact' | 'n/a'; leads: 'exact' | 'n/a' }
  /** true = the value is ALLOCATED (BOFU ad set split from MTD shares), not measured. */
  estimate: NodeEstimate
}

export interface NodeInfo {
  id: string
  type: NodeType
  label: string
  path: { id: string; label: string }[]
}

// ─── Assignment ─────────────────────────────────────────────────────────────

type BofuMode = 'feed' | 'approx' | 'unsplit'

interface Part {
  funnel: FunnelKey
  /** child id of this slice (campaign node, qualified with |funnel for the split BOFU campaign) */
  child: string
  share: MetaShare
  estimate: boolean
}

interface Assignment {
  metaParts: (campaign: string, day: string) => Part[]
  bofuMode: (day: string) => BofuMode
  googleFunnel: (campaign: string) => FunnelKey | null
  leadFunnel: (FunnelKey | null)[]
  /** campaign child id, qualified for BOFU; null = could not be placed on one campaign */
  leadChild: (string | null)[]
  /** unqualified campaign id */
  leadCampaign: (string | null)[]
  bookingFunnel: (FunnelKey | null)[]
  bookingChild: (string | null)[]
  bookingCampaign: (string | null)[]
  lpFunnel: (path: string) => FunnelKey | null
  /** child id → { label, platform } */
  labels: Map<string, { label: string; platform: 'meta' | 'google' }>
  bofuLeadsBy: { utm: number; sp: number; default: number }
}

const ONE: MetaShare = { impressions: 1, clicks: 1, clicksAll: 1, spend: 1 }
const BOFU_KEY = nk(BOFU_CAMPAIGN)
const isBofu = (name: string) => nk(name) === BOFU_KEY

export const campaignId = (platform: 'meta' | 'google', name: string) => `campaign:${platform}:${nk(name).replace(/ /g, '-')}`
const qualify = (id: string, f: FunnelKey) => `${id}|${f}`

const memo = new WeakMap<Datasets, Assignment>()

function assignmentOf(ds: Datasets): Assignment {
  const hit = memo.get(ds)
  if (hit) return hit
  const labels = new Map<string, { label: string; platform: 'meta' | 'google' }>()
  const label = (id: string, name: string, platform: 'meta' | 'google') => {
    if (!labels.has(id)) labels.set(id, { label: name, platform })
  }

  // ── BOFU ad set split per day ──
  const feedDay = new Map<string, { y: MetaShare; t: MetaShare }>()
  for (const r of ds.adsets.rows) {
    if (r.campaignId !== BOFU_CAMPAIGN_ID) continue
    let e = feedDay.get(r.day)
    if (!e) feedDay.set(r.day, (e = { y: { impressions: 0, clicks: 0, clicksAll: 0, spend: 0 }, t: { impressions: 0, clicks: 0, clicksAll: 0, spend: 0 } }))
    const yacht = BOFU_YACHT_ADSET.test(r.adset)
    for (const k of ['impressions', 'clicks', 'clicksAll', 'spend'] as const) {
      const v = k === 'impressions' ? r.impressions : k === 'clicks' ? r.clicks : k === 'clicksAll' ? r.clicksAll : r.spend
      e.t[k] += v
      if (yacht) e.y[k] += v
    }
  }
  const mtd = bofuMtd as { since: string; until: string; adsets: { name: string; spend: number; impressions: number; linkClicks: number }[] }
  const mtdShare: MetaShare | null = (() => {
    const t = { impressions: 0, clicks: 0, spend: 0 }
    const y = { impressions: 0, clicks: 0, spend: 0 }
    for (const a of mtd.adsets || []) {
      const yacht = BOFU_YACHT_ADSET.test(a.name)
      t.impressions += a.impressions; t.clicks += a.linkClicks; t.spend += a.spend
      if (yacht) { y.impressions += a.impressions; y.clicks += a.linkClicks; y.spend += a.spend }
    }
    if (!(t.spend > 0)) return null
    const d = (a: number, b: number, fb: number) => (b > 0 ? a / b : fb)
    const s = y.spend / t.spend
    return { impressions: d(y.impressions, t.impressions, s), clicks: d(y.clicks, t.clicks, s), clicksAll: d(y.clicks, t.clicks, s), spend: s }
  })()
  const bofuMode = (day: string): BofuMode => {
    if (feedDay.has(day)) return 'feed'
    if (mtdShare && day >= mtd.since && day <= (mtd.until || mtd.since).slice(0, 7) + '-31') return 'approx'
    return 'unsplit'
  }
  const bofuShare = (day: string): { y: MetaShare; mode: BofuMode } => {
    const f = feedDay.get(day)
    if (f) {
      const d = (k: keyof MetaShare) => (f.t[k] > 0 ? f.y[k] / f.t[k] : f.t.spend > 0 ? f.y.spend / f.t.spend : 0)
      return { y: { impressions: d('impressions'), clicks: d('clicks'), clicksAll: d('clicksAll'), spend: d('spend') }, mode: 'feed' }
    }
    if (bofuMode(day) === 'approx' && mtdShare) return { y: mtdShare, mode: 'approx' }
    return { y: { impressions: 0, clicks: 0, clicksAll: 0, spend: 0 }, mode: 'unsplit' }
  }

  const partsCache = new Map<string, Part[]>()
  const metaParts = (campaign: string, day: string): Part[] => {
    const key = `${campaign}|${day}`
    const c = partsCache.get(key)
    if (c) return c
    let out: Part[] = []
    const slug = adSlug('meta', campaign)
    if (slug) {
      const id = campaignId('meta', campaign)
      label(id, campaign, 'meta')
      const ov = CAMPAIGN_FUNNEL.get(nk(campaign))
      if (ov) out = [{ funnel: ov, child: id, share: ONE, estimate: false }]
      else if (isBofu(campaign)) {
        const { y, mode } = bofuShare(day)
        const g: MetaShare = { impressions: 1 - y.impressions, clicks: 1 - y.clicks, clicksAll: 1 - y.clicksAll, spend: 1 - y.spend }
        const est = mode === 'approx'
        label(qualify(id, BOFU_FUNNEL_YACHT), `${campaign} · single-yacht ad sets`, 'meta')
        label(qualify(id, BOFU_FUNNEL_GENERIC), `${campaign} · generic ad sets`, 'meta')
        out = [
          { funnel: BOFU_FUNNEL_YACHT, child: qualify(id, BOFU_FUNNEL_YACHT), share: y, estimate: est },
          { funnel: BOFU_FUNNEL_GENERIC, child: qualify(id, BOFU_FUNNEL_GENERIC), share: g, estimate: est },
        ]
      } else {
        const f = UMBRELLA_FUNNEL[slug]
        if (f) out = [{ funnel: f, child: id, share: ONE, estimate: false }]
      }
    }
    partsCache.set(key, out)
    return out
  }

  const googleNames = new Map<string, string>()
  for (const r of ds.google.rows) if (!googleNames.has(nk(r.campaign))) googleNames.set(nk(r.campaign), r.campaign)
  const googleFunnel = (campaign: string): FunnelKey | null => {
    const slug = adSlug('google', campaign)
    if (!slug) return null
    label(campaignId('google', campaign), campaign, 'google')
    return UMBRELLA_FUNNEL[slug] ?? null
  }

  // Meta campaign names + spend windows (for pinning a lead to one of several candidates by day).
  const metaNames = new Map<string, string>()
  const win = new Map<string, { a: string; b: string }>()
  for (const r of [...ds.fbSpend.rows, ...ds.fb.rows]) {
    if (!(r.spend > 0)) continue
    if (!metaNames.has(nk(r.campaign))) metaNames.set(nk(r.campaign), r.campaign)
    const w = win.get(r.campaign)
    if (!w) win.set(r.campaign, { a: r.day, b: r.day })
    else { if (r.day < w.a) w.a = r.day; if (r.day > w.b) w.b = r.day }
  }
  const allMeta = [...metaNames.values()]
  const pin = (cands: string[], day: string): string => {
    if (cands.length === 1) return cands[0]
    const live = cands.filter((n) => { const w = win.get(n); return !!w && day >= w.a && day <= w.b })
    if (live.length === 1) return live[0]
    const pool = live.length ? live : cands
    return pool.slice().sort((x, y) => (win.get(x)?.a || '9').localeCompare(win.get(y)?.a || '9') || x.localeCompare(y))[0]
  }

  const bofuLeadsBy = { utm: 0, sp: 0, default: 0 }
  const leadFunnel: (FunnelKey | null)[] = []
  const leadChild: (string | null)[] = []
  const leadCampaign: (string | null)[] = []
  ds.streak.rows.forEach((l, i) => {
    const slug = ds.leadSlugs[i]
    if (isFlatChannelLead(l) || !slug) { leadFunnel.push(null); leadChild.push(null); leadCampaign.push(null); return }
    let name: string | null = null
    let platform: 'meta' | 'google' = 'meta'
    let utmRows = null as null | { campaign: string; adset: string }[]
    if (l.isGoogle) {
      platform = 'google'
      name = googleNames.get(nk(l.detail)) || null
    } else {
      utmRows = ds.utmRows.get(nk(l.sp)) || null
      const fromUtm = [...new Set((utmRows || []).map((u) => metaNames.get(nk(u.campaign)) || u.campaign).filter(Boolean))]
      if (fromUtm.length) name = pin(fromUtm, l.day)
      else {
        const cands = matchSourceToCampaignCandidates(l.sp, allMeta).filter((n) => adSlug('meta', n) === slug)
        if (cands.length) name = pin(cands, l.day)
        else {
          const exact = metaNames.get(nk(l.sp))
          if (exact) name = exact
        }
      }
    }
    const id = name ? campaignId(platform, name) : null
    if (id && name) label(id, name, platform)
    let funnel: FunnelKey | null = (name && platform === 'meta' ? CAMPAIGN_FUNNEL.get(nk(name)) : undefined) ?? null
    let child = id
    if (!funnel && ((name && isBofu(name)) || (!name && slug === 'bofu'))) {
      const rows = (utmRows || []).filter((u) => isBofu(u.campaign))
      let yacht: boolean
      if (rows.length && rows.every((u) => BOFU_YACHT_ADSET.test(u.adset))) { yacht = true; bofuLeadsBy.utm++ }
      else if (rows.length && rows.every((u) => !BOFU_YACHT_ADSET.test(u.adset))) { yacht = false; bofuLeadsBy.utm++ }
      else if (BOFU_YACHT_SP.test(l.sp)) { yacht = true; bofuLeadsBy.sp++ }
      else { yacht = false; bofuLeadsBy.default++ }
      funnel = yacht ? BOFU_FUNNEL_YACHT : BOFU_FUNNEL_GENERIC
      child = id ? qualify(id, funnel) : null
    }
    if (!funnel) funnel = UMBRELLA_FUNNEL[slug] ?? null
    leadFunnel.push(funnel)
    leadChild.push(child)
    leadCampaign.push(id)
  })

  const bookingFunnel: (FunnelKey | null)[] = []
  const bookingChild: (string | null)[] = []
  const bookingCampaign: (string | null)[] = []
  ds.bookings.rows.forEach((b, i) => {
    const slug = ds.bookingSlugs[i]
    if (!slug) { bookingFunnel.push(null); bookingChild.push(null); bookingCampaign.push(null); return }
    const ch = bookingChannel(b)
    const platform: 'meta' | 'google' = ch === 'google' ? 'google' : 'meta'
    const name = b.campaign.trim()
    const id = name ? campaignId(platform, name) : null
    if (id) label(id, name, platform)
    let funnel: FunnelKey | null = (name && platform === 'meta' ? CAMPAIGN_FUNNEL.get(nk(name)) : undefined) ?? null
    let child = id
    if (!funnel && name && isBofu(name)) {
      const lp = b.landingPage || ''
      funnel = BOFU_YACHT_LANDING.test(lp) ? BOFU_FUNNEL_YACHT : BOFU_FUNNEL_GENERIC
      child = id ? qualify(id, funnel) : null
    }
    if (!funnel) funnel = UMBRELLA_FUNNEL[slug] ?? null
    bookingFunnel.push(funnel)
    bookingChild.push(child)
    bookingCampaign.push(id)
  })

  const ordered = UMBRELLA_ORDER.map((s) => CAMPAIGNS.find((c) => c.slug === s)!).filter(Boolean)
  const lpCache = new Map<string, FunnelKey | null>()
  const lpFunnel = (path: string): FunnelKey | null => {
    const c = lpCache.get(path)
    if (c !== undefined) return c
    let out: FunnelKey | null = null
    for (const [re, f] of LP_FUNNEL_OVERRIDES) if (re.test(path)) { out = f; break }
    if (!out) for (const u of ordered) if (u.lp && u.lp.test(path)) { out = UMBRELLA_FUNNEL[u.slug] ?? null; break }
    lpCache.set(path, out)
    return out
  }

  const a: Assignment = {
    metaParts, bofuMode, googleFunnel, leadFunnel, leadChild, leadCampaign,
    bookingFunnel, bookingChild, bookingCampaign, lpFunnel, labels, bofuLeadsBy,
  }
  memo.set(ds, a)
  return a
}

// ─── Scopes ─────────────────────────────────────────────────────────────────

const sumShares = (parts: Part[]): MetaShare | null => {
  if (!parts.length) return null
  const s = { impressions: 0, clicks: 0, clicksAll: 0, spend: 0 }
  for (const p of parts) { s.impressions += p.share.impressions; s.clicks += p.share.clicks; s.clicksAll += p.share.clicksAll; s.spend += p.share.spend }
  return s
}

function funnelPlatforms(key: FunnelKey) {
  const f = FUNNEL_BY_KEY.get(key)!
  const defs = f.umbrellas.map((u) => CAMPAIGNS.find((c) => c.slug === u)!).filter(Boolean)
  const hasMeta = defs.some((d) => !!(d.metaNames?.length || d.fb)) || key === 'asset'
  const hasGoogle = defs.some((d) => !!(d.googleNames?.length || d.google))
  return { hasMeta, hasGoogle }
}

export function funnelScope(ds: Datasets, key: FunnelKey): NodeScope {
  const A = assignmentOf(ds)
  const f = FUNNEL_BY_KEY.get(key)!
  const { hasMeta, hasGoogle } = funnelPlatforms(key)
  return {
    id: `funnel:${key}`,
    label: f.label,
    metaShare: (c, d) => sumShares(A.metaParts(c, d).filter((p) => p.funnel === key)),
    google: (c) => A.googleFunnel(c) === key,
    lead: (i) => A.leadFunnel[i] === key,
    booking: (i) => A.bookingFunnel[i] === key,
    lpPath:
      f.nonFunnel || !(f.umbrellas.some((u) => CAMPAIGNS.find((c) => c.slug === u)?.lp) || LP_FUNNEL_OVERRIDES.some(([, k]) => k === key))
        ? null
        : (p) => A.lpFunnel(p) === key,
    lpChannels: [...(hasMeta ? ['meta' as const] : []), ...(hasGoogle ? ['google' as const] : [])],
    hasMeta,
    hasGoogle,
  }
}

function parseCampaignId(id: string): { base: string; platform: 'meta' | 'google'; qual: FunnelKey | null } | null {
  const m = /^campaign:(meta|google):([a-z0-9-]+)(?:\|([a-z_]+))?$/.exec(id)
  if (!m) return null
  const qual = (m[3] as FunnelKey) || null
  if (qual && !FUNNEL_BY_KEY.has(qual)) return null
  return { base: `campaign:${m[1]}:${m[2]}`, platform: m[1] as 'meta' | 'google', qual }
}

export function campaignScope(ds: Datasets, id: string): NodeScope | null {
  const p = parseCampaignId(id)
  if (!p) return null
  const A = assignmentOf(ds)
  // make sure labels exist for every spend row
  for (const r of ds.fbSpend.rows) A.metaParts(r.campaign, r.day)
  for (const r of ds.google.rows) A.googleFunnel(r.campaign)
  const lab = A.labels.get(id) || A.labels.get(p.base)
  if (!lab) return null
  return {
    id,
    label: lab.label,
    metaShare: (c, d) => {
      if (p.platform !== 'meta' || campaignId('meta', c) !== p.base) return null
      return p.qual ? sumShares(A.metaParts(c, d).filter((x) => x.funnel === p.qual)) : ONE
    },
    google: (c) => p.platform === 'google' && campaignId('google', c) === p.base,
    lead: (i) => A.leadCampaign[i] === p.base && (!p.qual || A.leadFunnel[i] === p.qual),
    booking: (i) => A.bookingCampaign[i] === p.base && (!p.qual || A.bookingFunnel[i] === p.qual),
    lpPath: null,
    lpChannels: [],
    hasMeta: p.platform === 'meta',
    hasGoogle: p.platform === 'google',
  }
}

// ─── Values / rollups ───────────────────────────────────────────────────────

type Acc = { impressions: number; clicks: number; lpViews: number | null; leads: number; ql: number; bookings: number; revenue: number; spend: number; est: boolean }
const acc = (): Acc => ({ impressions: 0, clicks: 0, lpViews: null, leads: 0, ql: 0, bookings: 0, revenue: 0, spend: 0, est: false })

const chanIn = (view: Channel, ch: 'meta' | 'google') => view === 'all' || view === ch

/** Campaign children of a node: rows are kept when `keep` says so and keyed by `childOf`. */
function rollupCampaigns(
  ds: Datasets,
  from: string,
  to: string,
  channel: Channel,
  bo: AggOpts,
  sel: {
    meta: (campaign: string, day: string) => { child: string; share: MetaShare; estimate: boolean }[]
    google: (campaign: string) => string | null
    lead: (i: number) => { keep: boolean; child: string | null }
    booking: (i: number) => { keep: boolean; child: string | null }
  }
): Map<string, Acc> {
  const out = new Map<string, Acc>()
  const get = (k: string) => { let a = out.get(k); if (!a) out.set(k, (a = acc())); return a }
  const inR = (d: string) => d >= from && d <= to
  if (chanIn(channel, 'meta')) {
    const useApi = ds.fbSpend.rows.length > 0
    for (const r of ds.fb.rows) {
      if (!inR(r.day)) continue
      for (const p of sel.meta(r.campaign, r.day)) {
        const a = get(p.child)
        a.impressions += r.impressions * p.share.impressions
        a.clicks += r.clicks * p.share.clicks
        if (!useApi) a.spend += r.spend * p.share.spend
        if (p.estimate) a.est = true
      }
    }
    if (useApi) for (const r of ds.fbSpend.rows) {
      if (!inR(r.day)) continue
      for (const p of sel.meta(r.campaign, r.day)) {
        const a = get(p.child)
        a.spend += r.spend * p.share.spend
        if (p.estimate) a.est = true
      }
    }
  }
  if (chanIn(channel, 'google')) for (const r of ds.google.rows) {
    if (!inR(r.day)) continue
    const k = sel.google(r.campaign)
    if (!k) continue
    const a = get(k)
    a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend
  }
  ds.streak.rows.forEach((l, i) => {
    if (!inR(l.day)) return
    if (channel !== 'all' && leadChannel(l) !== channel) return
    const s = sel.lead(i)
    if (!s.keep || !s.child) return
    const a = get(s.child)
    a.leads++
    if (l.ai >= 50) a.ql++
  })
  ds.bookings.rows.forEach((b, i) => {
    if (b.month < bo.fromM || b.month > bo.toM) return
    if (channel !== 'all' && bookingChannel(b) !== channel) return
    const s = sel.booking(i)
    if (!s.keep || !s.child) return
    const a = get(s.child)
    a.bookings++
    a.revenue += b.rvc
  })
  return out
}

const r2 = (x: number) => Math.round(x * 100) / 100

function valuesOf(a: { impressions: number | null; clicks: number | null; lpViews: number | null; leads: number | null; ql: number | null; bookings: number | null; revenue: number | null; spend: number | null }, roasOk: boolean, leadsNa: boolean): NodeValues {
  return {
    impressions: a.impressions == null ? null : Math.round(a.impressions),
    clicks: a.clicks == null ? null : Math.round(a.clicks),
    lpViews: a.lpViews,
    leads: leadsNa ? null : a.leads,
    ql: leadsNa ? null : a.ql,
    bookings: a.bookings,
    revenue: a.revenue == null ? null : r2(a.revenue),
    spend: a.spend == null ? null : r2(a.spend),
    roas: roasOk && a.spend && a.spend > 0 && a.revenue != null ? a.revenue / a.spend : null,
  }
}

const rawToValues = (v: RawStepValues, roasOk: boolean, leadsNa = false, qlAll = true): NodeValues =>
  valuesOf({ impressions: v.impressions, clicks: v.clicks, lpViews: v.lpViews, leads: v.leads, ql: qlAll ? v.qlAll : v.ql, bookings: v.bookings, revenue: v.revenue, spend: v.spend }, roasOk, leadsNa)

const ADDITIVE: (keyof NodeValues)[] = ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings', 'revenue', 'spend']

function remainderOf(node: NodeValues, children: NodeChild[], rawChildren: NodeValues[]): NodeValues {
  const out: any = {}
  for (const k of ADDITIVE) {
    const nv = node[k]
    if (nv == null) { out[k] = null; continue }
    const kids = rawChildren.map((c) => c[k])
    // No child measures this metric (e.g. LP views per campaign): nothing to reconcile at this level.
    if (kids.every((x) => x == null)) { out[k] = null; continue }
    const s = kids.reduce((n: number, x) => n + (x ?? 0), 0)
    const d = nv - s
    out[k] = Math.abs(d) < 1e-6 ? 0 : k === 'spend' || k === 'revenue' ? r2(d) : Math.round(d)
  }
  out.roas = null
  void children
  return out
}

// ─── Freshness ──────────────────────────────────────────────────────────────

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

function freshnessOf(resp: FunnelResponse, ds: Datasets) {
  const today = todayLjubljana()
  const yesterday = addDays(today, -1)
  const cov = (resp.meta as any).coverage || {}
  const src = (key: string, label: string, through: string | null, staleIf: (t: string) => boolean) => ({
    key, label, dataThrough: through || null, stale: !through || staleIf(through),
  })
  const daily = (t: string) => t < yesterday
  const prevMonthEnd = monthEnd(addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7))
  // utm_mapping has no dates: report how much of this month's Meta leads it resolves instead.
  const monthStart = `${today.slice(0, 7)}-01`
  let metaLeads = 0, mapped = 0
  for (const l of ds.streak.rows) {
    if (l.day < monthStart || l.isGoogle || isFlatChannelLead(l)) continue
    metaLeads++
    if (ds.utmRows.has(nk(l.sp))) mapped++
  }
  const unmapped = metaLeads ? (metaLeads - mapped) / metaLeads : 0
  let utmRowCount = 0
  for (const v of ds.utmRows.values()) utmRowCount += v.length
  return {
    today,
    effectiveWindow: (resp.meta as any).effectiveWindow,
    sources: [
      src('meta', 'Meta Ads (fb_daily_api + fb_ads_api)', cov.fb?.to ?? null, daily),
      src('google', 'Google Ads (daily_api)', cov.google?.to ?? null, daily),
      src('ga4', 'GA4 landing pages', cov.ga4?.to ?? null, daily),
      src('streak', 'Streak leads (streak_full ∪ streak_sync)', cov.streak?.to ?? null, daily),
      src('bookings', 'Bookings (bookings_api, month-granular)', cov.bookings?.to ?? null, (t) => t < prevMonthEnd),
      src('adsets', 'Meta ad set × day (fb_adset_daily_api, BOFU)', ds.adsets.coverage.max || null, daily),
      {
        key: 'utm_mapping',
        label: 'UTM mapping (utm_mapping)',
        dataThrough: null,
        rows: utmRowCount,
        thisMonthMetaLeads: metaLeads,
        thisMonthUnmappedShare: unmapped,
        stale: unmapped > 0.03,
      },
    ],
  }
}

// ─── Node builder ───────────────────────────────────────────────────────────

const FUNNEL_LIST = FUNNELS.map((f) => ({ key: f.key, id: `funnel:${f.key}`, label: f.label, nonFunnel: !!f.nonFunnel, leadsNa: !!f.leadsNa }))

export function parseNode(node: string): { type: NodeType; key: string } | null {
  const n = (node || 'master').trim()
  if (n === 'master') return { type: 'master', key: 'master' }
  let m = /^funnel:([a-z_]+)$/.exec(n)
  if (m) return FUNNEL_BY_KEY.has(m[1] as FunnelKey) ? { type: 'funnel', key: m[1] } : null
  m = /^umbrella:([a-z]+)$/.exec(n)
  if (m) return CAMPAIGNS.some((c) => c.slug === m![1]) ? { type: 'umbrella', key: m[1] } : null
  if (parseCampaignId(n)) return { type: 'campaign', key: n }
  return null
}

export interface NodeOpts {
  node: string
  range: ResolvedRange
  channel: Channel
  /** an already-built master/umbrella response (from the shared cache) — avoids a rebuild */
  base?: FunnelResponse
}

export async function loadFunnelNode(o: NodeOpts) {
  const parsed = parseNode(o.node)
  if (!parsed) throw new Error(`Unknown node "${o.node}"`)
  const ds = await getFunnelDatasets()
  const A = assignmentOf(ds)
  for (const r of ds.fbSpend.rows) A.metaParts(r.campaign, r.day)
  for (const r of ds.google.rows) A.googleFunnel(r.campaign)

  let scope: NodeScope | null = null
  if (parsed.type === 'funnel') scope = funnelScope(ds, parsed.key as FunnelKey)
  if (parsed.type === 'campaign') {
    scope = campaignScope(ds, parsed.key)
    if (!scope) throw new Error(`Unknown campaign node "${o.node}"`)
  }
  const resp: FunnelResponse =
    o.base ||
    (await loadBusinessFunnel({
      start: o.range.from,
      end: o.range.to,
      campaign: parsed.type === 'umbrella' ? parsed.key : 'master',
      channel: o.channel,
      range: o.range,
      scope: scope || undefined,
    }))

  const meta: any = resp.meta
  const from: string = meta.effectiveWindow.from
  const to: string = meta.effectiveWindow.to
  const bo: AggOpts = { fromM: meta.bookingsWindow.from.slice(0, 7), toM: meta.bookingsWindow.to.slice(0, 7) }
  const roasOk = resp.efficiency.roas !== null || (resp.efficiency.spend === 0)
  const def = parsed.type === 'umbrella' ? CAMPAIGNS.find((c) => c.slug === parsed.key)! : null
  const fdef = parsed.type === 'funnel' ? FUNNEL_BY_KEY.get(parsed.key as FunnelKey)! : null
  const leadsNa = !!fdef?.leadsNa || (parsed.type === 'campaign' && false)
  const aggNode = (f: string, t: string, ob: AggOpts): RawStepValues =>
    scope ? aggregateScope(ds, scope, f, t, o.channel, ob) : aggregate(ds, def, f, t, o.channel, ob)
  const cur = aggNode(from, to, bo)
  const nodeValues = rawToValues(cur, roasOk, leadsNa, true)
  const notes: string[] = []

  // ── children ──
  const children: NodeChild[] = []
  const rawKids: NodeValues[] = []
  let bofuDays = { feed: 0, approx: 0, unsplit: 0 }
  for (let d = from; d <= to; d = addDays(d, 1)) bofuDays[A.bofuMode(d)]++

  const pushChild = (c: Omit<NodeChild, 'values'> & { raw: NodeValues }) => {
    const { raw, ...rest } = c
    rawKids.push(raw)
    children.push({ ...rest, values: raw })
  }

  if (parsed.type === 'master') {
    for (const f of FUNNELS) {
      const sc = funnelScope(ds, f.key)
      const v = aggregateScope(ds, sc, from, to, o.channel, bo)
      const raw = rawToValues(v, roasOk, false, true)
      const shown = f.leadsNa ? { ...raw, leads: null, ql: null } : raw
      rawKids.push(raw)
      const touchesBofu = f.key === BOFU_FUNNEL_YACHT || f.key === BOFU_FUNNEL_GENERIC
      const est = touchesBofu && bofuDays.approx > 0
      children.push({
        id: `funnel:${f.key}`, type: 'funnel', label: f.label, platform: null, nonKpi: !!f.nonFunnel, drillable: true,
        values: shown,
        quality: { spend: est ? 'approx' : 'exact', lpViews: f.nonFunnel ? 'n/a' : 'exact', leads: f.leadsNa ? 'n/a' : 'exact' },
        estimate: { spend: est, impressions: est, clicks: est },
      })
    }
  } else if (parsed.type === 'funnel' || parsed.type === 'umbrella') {
    const key = parsed.key
    const sel =
      parsed.type === 'funnel'
        ? {
            meta: (c: string, d: string) => A.metaParts(c, d).filter((p) => p.funnel === key),
            google: (c: string) => (A.googleFunnel(c) === key ? campaignId('google', c) : null),
            lead: (i: number) => ({ keep: A.leadFunnel[i] === key, child: A.leadChild[i] }),
            booking: (i: number) => ({ keep: A.bookingFunnel[i] === key, child: A.bookingChild[i] }),
          }
        : {
            meta: (c: string, _d: string) => (adSlug('meta', c) === key ? [{ child: campaignId('meta', c), share: ONE, estimate: false }] : []),
            google: (c: string) => (adSlug('google', c) === key ? campaignId('google', c) : null),
            lead: (i: number) => ({ keep: ds.leadSlugs[i] === key, child: A.leadCampaign[i] }),
            booking: (i: number) => ({ keep: ds.bookingSlugs[i] === key, child: A.bookingCampaign[i] }),
          }
    const roll = rollupCampaigns(ds, from, to, o.channel, bo, sel)
    for (const [id, a] of roll) {
      const lab = A.labels.get(id)
      const raw = valuesOf({ ...a, lpViews: null }, roasOk, false)
      const shown = leadsNa ? { ...raw, leads: null, ql: null } : raw
      rawKids.push(raw)
      const baseName = lab?.label?.split(' · ')[0] || ''
      const c0 = CAMPAIGNS.find((c) => c.slug === adSlug(lab?.platform || 'meta', baseName))
      children.push({
        id, type: 'campaign', label: lab?.label || id, platform: lab?.platform || null, nonKpi: !!c0?.nonKpi, drillable: true,
        values: shown,
        quality: { spend: a.est ? 'approx' : 'exact', lpViews: 'n/a', leads: leadsNa ? 'n/a' : 'exact' },
        estimate: { spend: a.est, impressions: a.est, clicks: a.est },
      })
    }
    children.sort((x, y) => (y.values.spend || 0) - (x.values.spend || 0))
    // keep rawKids aligned with the sorted children
    rawKids.length = 0
    for (const c of children) rawKids.push({ ...c.values, leads: c.values.leads ?? null, ql: c.values.ql ?? null })
    if (leadsNa) for (let i = 0; i < rawKids.length; i++) { rawKids[i].leads = null; rawKids[i].ql = null }
  }
  void pushChild

  // ── remainder ──
  // Master: the QL step EXCLUDES the AI-inflated ASSET umbrella, children count it. The remainder
  // is therefore reconciled against qualityLeadsIncludingAsset — never against the step value.
  const reconcileBase: NodeValues =
    parsed.type === 'master' ? rawToValues(cur, roasOk, false, true) : nodeValues
  const remainder = children.length || parsed.type !== 'campaign'
    ? { label: '(not attributed lower)', values: remainderOf(reconcileBase, children, rawKids) }
    : null
  if (parsed.type === 'master') {
    const qlStep = resp.steps.find((s) => s.key === 'ql')
    notes.push(
      `Children + remainder reconcile against steps[ql].qualityLeadsIncludingAsset (${qlStep?.qualityLeadsIncludingAsset ?? 'n/a'}), not against the QL step value (${qlStep?.value ?? 'n/a'}): the master QL step excludes the ASSET / RareOps umbrella (AI score inflated), every child counts its own QL in full.`
    )
  }
  if (leadsNa && fdef?.leadsNa) notes.push(fdef.leadsNa)
  if (bofuDays.approx || bofuDays.unsplit) {
    notes.push(
      `BOFU ad set split: ${bofuDays.feed} day(s) from fb_adset_daily_api, ${bofuDays.approx} day(s) allocated from MTD ad set shares (estimate:true), ${bofuDays.unsplit} day(s) without ad set data kept whole in EB Croatia.`
    )
  }
  if (A.bofuLeadsBy.default) {
    notes.push(`BOFU leads by ad set: ${A.bofuLeadsBy.utm} via utm_mapping ad set, ${A.bofuLeadsBy.sp} via the placement token, ${A.bofuLeadsBy.default} with no ad set signal counted as generic (EB Croatia). Counts are over the whole Streak feed, not this window.`)
  }

  // ── coverage (share placed on a child) ──
  const share = (k: 'leads' | 'ql' | 'bookings' | 'spend') => {
    const total = reconcileBase[k]
    const rem = remainder?.values[k]
    if (total == null || !(total > 0) || rem == null) return { total: total ?? null, attributedLower: null, remainder: rem ?? null, share: null }
    return { total, attributedLower: k === 'spend' ? r2(total - rem) : total - rem, remainder: rem, share: (total - rem) / total }
  }
  const coverage = children.length
    ? { level: children[0].type, leads: share('leads'), ql: share('ql'), bookings: share('bookings'), spend: share('spend') }
    : null

  // ── previous period (same length, immediately before the effective window) ──
  const pw = meta.benchmark?.window
  let previous: { from: string; to: string; values: NodeValues } | null = null
  if (pw?.from && pw?.to) {
    const pv = aggNode(pw.from, pw.to, { fromM: pw.from.slice(0, 7), toM: pw.to.slice(0, 7) })
    // ROAS only when the previous window is whole months (bookings are month-granular at source).
    const whole = pw.from.endsWith('-01') && pw.to === monthEnd(pw.to.slice(0, 7))
    previous = { from: pw.from, to: pw.to, values: rawToValues(pv, whole, leadsNa, true) }
  }
  const stepKeyMap: Record<string, keyof NodeValues> = { impressions: 'impressions', clicks: 'clicks', lpViews: 'lpViews', leads: 'leads', ql: 'ql', bookings: 'bookings' }
  const steps = resp.steps.map((s) => {
    const k = stepKeyMap[s.key]
    let prevVal = previous && k ? previous.values[k] : null
    if (parsed.type === 'master' && s.key === 'ql' && previous) {
      const pv = aggregate(ds, null, pw.from, pw.to, o.channel, { fromM: pw.from.slice(0, 7), toM: pw.to.slice(0, 7) })
      prevVal = pv.ql
    }
    const st: any = { ...s, previousValue: prevVal }
    if (leadsNa && (s.key === 'leads' || s.key === 'ql')) { st.value = null; st.cvrFromPrev = null; st.status = null; st.previousValue = null }
    if (s.key === 'bookings' && previous) st.previousRevenue = previous.values.revenue
    return st
  })

  // ── node info / path ──
  const funnelOfCampaign = (id: string): FunnelKey | null => {
    const p = parseCampaignId(id)
    if (!p) return null
    if (p.qual) return p.qual
    for (const r of ds.fbSpend.rows) if (campaignId('meta', r.campaign) === p.base) return A.metaParts(r.campaign, r.day)[0]?.funnel ?? null
    for (const r of ds.google.rows) if (campaignId('google', r.campaign) === p.base) return A.googleFunnel(r.campaign)
    return null
  }
  const path: { id: string; label: string }[] = [{ id: 'master', label: 'All campaigns · Master' }]
  let label = 'All campaigns · Master'
  if (parsed.type === 'funnel') { label = fdef!.label; path.push({ id: `funnel:${fdef!.key}`, label }) }
  if (parsed.type === 'umbrella') {
    const fk = UMBRELLA_FUNNEL[parsed.key]
    if (fk) path.push({ id: `funnel:${fk}`, label: FUNNEL_BY_KEY.get(fk)!.label })
    label = def!.name
    path.push({ id: `umbrella:${def!.slug}`, label })
  }
  if (parsed.type === 'campaign') {
    const fk = funnelOfCampaign(parsed.key)
    if (fk) path.push({ id: `funnel:${fk}`, label: FUNNEL_BY_KEY.get(fk)!.label })
    label = scope!.label
    path.push({ id: parsed.key, label })
  }
  const node: NodeInfo = { id: parsed.type === 'master' ? 'master' : o.node, type: parsed.type, label, path }

  return {
    ...resp,
    meta: { ...meta, node: node.id, notes: [...(meta.notes || []), ...notes] },
    steps,
    node,
    funnels: FUNNEL_LIST,
    values: parsed.type === 'master' ? { ...nodeValues, qlStep: resp.steps.find((s) => s.key === 'ql')?.value ?? null } : nodeValues,
    children,
    remainder,
    coverage,
    previous,
    freshness: freshnessOf(resp, ds),
    bofuSplit: { days: bofuDays, leadsBy: A.bofuLeadsBy },
  }
}

export type FunnelNodeResponse = Awaited<ReturnType<typeof loadFunnelNode>>

// ─── Search index ───────────────────────────────────────────────────────────

export async function loadFunnelIndex(o: { range: ResolvedRange; channel: Channel }) {
  const master = await loadFunnelNode({ node: 'master', range: o.range, channel: o.channel })
  const items: { id: string; type: NodeType; label: string; path: string[]; platform: 'meta' | 'google' | null; funnel: FunnelKey | null; spend: number | null; leads: number | null }[] = []
  items.push({ id: 'master', type: 'master', label: 'All campaigns · Master', path: [], platform: null, funnel: null, spend: master.values.spend, leads: master.values.leads })
  for (const f of master.children) {
    items.push({ id: f.id, type: 'funnel', label: f.label, path: ['All campaigns · Master'], platform: null, funnel: f.id.slice(7) as FunnelKey, spend: f.values.spend, leads: f.values.leads })
  }
  // campaigns: one pass per funnel (children of each funnel node, same window, no extra reads)
  const ds = await getFunnelDatasets()
  const A = assignmentOf(ds)
  const meta: any = master.meta
  const from = meta.effectiveWindow.from, to = meta.effectiveWindow.to
  const bo: AggOpts = { fromM: meta.bookingsWindow.from.slice(0, 7), toM: meta.bookingsWindow.to.slice(0, 7) }
  for (const f of FUNNELS) {
    const roll = rollupCampaigns(ds, from, to, o.channel, bo, {
      meta: (c, d) => A.metaParts(c, d).filter((p) => p.funnel === f.key),
      google: (c) => (A.googleFunnel(c) === f.key ? campaignId('google', c) : null),
      lead: (i) => ({ keep: A.leadFunnel[i] === f.key, child: A.leadChild[i] }),
      booking: (i) => ({ keep: A.bookingFunnel[i] === f.key, child: A.bookingChild[i] }),
    })
    for (const [id, a] of roll) {
      const lab = A.labels.get(id)
      items.push({ id, type: 'campaign', label: lab?.label || id, path: ['All campaigns · Master', f.label], platform: lab?.platform || null, funnel: f.key, spend: r2(a.spend), leads: f.leadsNa ? null : a.leads })
    }
  }
  for (const c of CAMPAIGNS) {
    const fk = UMBRELLA_FUNNEL[c.slug] ?? null
    items.push({ id: `umbrella:${c.slug}`, type: 'umbrella', label: c.name, path: ['All campaigns · Master', ...(fk ? [FUNNEL_BY_KEY.get(fk)!.label] : [])], platform: null, funnel: fk, spend: null, leads: null })
  }
  return { meta: { range: o.range, channel: o.channel, effectiveWindow: meta.effectiveWindow, generatedAt: new Date().toISOString() }, items }
}
