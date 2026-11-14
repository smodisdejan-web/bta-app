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
  ensureCopyFeeds,
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
  lpKeyOf,
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
  itemFunnel,
  abOf,
  LEAD_FORM_LP,
  type FunnelKey,
  type ItemRule,
} from './funnel-groups'
import bofuMtd from '../data/bofu-adset-mtd.json'
import { createHash } from 'crypto'

type FunnelResponse = Awaited<ReturnType<typeof loadBusinessFunnel>>

// ─── Public types ───────────────────────────────────────────────────────────

export type NodeType = 'master' | 'funnel' | 'umbrella' | 'campaign' | 'adset' | 'ad' | 'lp' | 'copy'
export type NodeLevel = 'funnel' | 'campaign' | 'adset' | 'ad' | 'lp' | 'copy'

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
  /** copy level: true when part of the value is split from a multi-text ad by its text's share of link clicks */
  leads?: boolean
  ql?: boolean
  bookings?: boolean
  revenue?: boolean
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
  quality: { spend: 'exact' | 'approx' | 'n/a'; lpViews: 'exact' | 'approx' | 'n/a'; leads: 'exact' | 'partial' | 'n/a' }
  /** labels of the ancestors (funnel › campaign › ad set) — set on level lists and on ad set / ad children */
  path?: string[]
  /** single-yacht rule that placed this item when it is not its campaign's funnel */
  movedBy?: 'adset' | 'ad'
  /** landing page rows: full URL */
  url?: string
  /** landing page rows: declared A/B pair */
  abGroup?: string
  abVariant?: 'A' | 'B'
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

interface ItemFrac {
  adsetId: string
  adset: string
  adId: string | null
  ad: string | null
  funnel: FunnelKey | null
  rule: ItemRule
  /** this item's share of the campaign-day (per metric) */
  share: MetaShare
}

export interface ItemInfo {
  id: string
  name: string
  campaign: string
  campaignBase: string
  adsetId: string
  adset: string
  funnel: FunnelKey | null
  rule: ItemRule
}

interface Assignment {
  metaParts: (campaign: string, day: string) => Part[]
  /** ad (preferred) or ad set fractions of a Meta campaign-day; null = no item feed for it */
  items: (campaign: string, day: string) => ItemFrac[] | null
  bofuMode: (day: string) => BofuMode
  googleFunnel: (campaign: string) => FunnelKey | null
  leadFunnel: (FunnelKey | null)[]
  /** campaign child id, qualified for split campaigns; null = could not be placed on one campaign */
  leadChild: (string | null)[]
  /** unqualified campaign id */
  leadCampaign: (string | null)[]
  leadAdset: (string | null)[]
  leadAd: (string | null)[]
  /** how the lead reached its campaign: utm (unique utm_mapping campaign) | detail (Google) | fuzzy */
  leadCampaignBy: ('utm' | 'detail' | 'fuzzy' | null)[]
  bookingFunnel: (FunnelKey | null)[]
  bookingChild: (string | null)[]
  bookingCampaign: (string | null)[]
  bookingAdset: (string | null)[]
  bookingAd: (string | null)[]
  lpFunnel: (path: string) => FunnelKey | null
  /** child id → { label, platform } */
  labels: Map<string, { label: string; platform: 'meta' | 'google' }>
  /** campaign bases whose items sit in more than one funnel (ids qualified with |funnel) */
  splitCampaigns: Set<string>
  /** ad set ids whose ads sit in more than one funnel (ids qualified with |funnel) */
  splitAdsets: Set<string>
  adsets: Map<string, ItemInfo>
  ads: Map<string, ItemInfo>
  bofuLeadsBy: { utm: number; sp: number; default: number }
  /** leads whose candidate ads sit in different funnels (kept in the campaign's base funnel) */
  funnelAmbiguousLeads: number
  /** landing page (host+path/) of each lead (HubSpot first_url via e-mail), null = unknown */
  leadLp: (string | null)[]
  /** landing page of each booking (Acq landing via bookings_ads, else bookings_api.landing_page) */
  bookingLp: (string | null)[]
  /** GA4 paid session rows with their funnel / campaign / ad set / ad context */
  ga4: { day: string; lp: string; channel: 'meta' | 'google' | 'other'; sessions: number; funnel: FunnelKey | null; campaignBase: string | null; slug: string | null; adsetId: string | null; adId: string | null }[]
  /** ad → landing page */
  adLp: (adId: string | null) => string | null
  /** landing page labels / urls / ad sources */
  lpUrl: Map<string, string>
  googleLpImprFactor: (campaign: string, day: string) => number
}

const ONE: MetaShare = { impressions: 1, clicks: 1, clicksAll: 1, spend: 1 }
const ZERO: MetaShare = { impressions: 0, clicks: 0, clicksAll: 0, spend: 0 }
const BOFU_KEY = nk(BOFU_CAMPAIGN)
const isBofu = (name: string) => nk(name) === BOFU_KEY

export const campaignId = (platform: 'meta' | 'google', name: string) => `campaign:${platform}:${nk(name).replace(/ /g, '-')}`
export const adsetNodeId = (id: string) => `adset:meta:${id}`
export const adNodeId = (id: string) => `ad:meta:${id}`
const qualify = (id: string, f: FunnelKey) => `${id}|${f}`

const memo = new WeakMap<Datasets, Assignment>()

function assignmentOf(ds: Datasets): Assignment {
  const hit = memo.get(ds)
  if (hit) return hit
  const labels = new Map<string, { label: string; platform: 'meta' | 'google' }>()
  const label = (id: string, name: string, platform: 'meta' | 'google') => {
    if (!labels.has(id)) labels.set(id, { label: name, platform })
  }
  const baseFunnelOf = (campaign: string): FunnelKey | null => {
    const slug = adSlug('meta', campaign)
    return slug ? UMBRELLA_FUNNEL[slug] ?? null : null
  }

  // ── Item feeds: ad × day preferred, ad set × day where the ad feed has no rows ──
  type Raw = { adsetId: string; adset: string; adId: string | null; ad: string | null; m: MetaShare }
  const byKey = new Map<string, Raw[]>()
  const adDays = new Set<string>()
  // The ad feed is used for a campaign-day only when it is COMPLETE there (Σ ads = campaign feed
  // spend within €1 / 0,5 %); otherwise that day falls back to the ad set feed. A partial ad pull
  // can therefore never move spend between items.
  const campDaySpend = new Map<string, number>()
  for (const r of ds.fbSpend.rows.length ? ds.fbSpend.rows : ds.fb.rows) {
    const k = `${nk(r.campaign)}|${r.day}`
    campDaySpend.set(k, (campDaySpend.get(k) || 0) + r.spend)
  }
  const adByKey = new Map<string, Raw[]>()
  for (const r of ds.ads.rows) {
    const k = `${nk(r.campaign)}|${r.day}`
    let l = adByKey.get(k)
    if (!l) adByKey.set(k, (l = []))
    l.push({ adsetId: r.adsetId, adset: r.adset, adId: r.adId, ad: r.ad, m: { impressions: r.impressions, clicks: r.clicks, clicksAll: r.clicksAll, spend: r.spend } })
  }
  for (const [k, l] of adByKey) {
    const s = l.reduce((n, r) => n + r.m.spend, 0)
    const c = campDaySpend.get(k) ?? 0
    if (Math.abs(s - c) <= Math.max(1, c * 0.005)) { byKey.set(k, l); adDays.add(k) }
  }
  for (const r of ds.adsets.rows) {
    const k = `${nk(r.campaign)}|${r.day}`
    if (adDays.has(k)) continue
    let l = byKey.get(k)
    if (!l) byKey.set(k, (l = []))
    l.push({ adsetId: r.adsetId, adset: r.adset, adId: null, ad: null, m: { impressions: r.impressions, clicks: r.clicks, clicksAll: r.clicksAll, spend: r.spend } })
  }
  const campName = new Map<string, string>()
  for (const r of [...ds.fbSpend.rows, ...ds.fb.rows]) if (!campName.has(nk(r.campaign))) campName.set(nk(r.campaign), r.campaign)
  for (const r of [...ds.ads.rows, ...ds.adsets.rows]) if (!campName.has(nk(r.campaign))) campName.set(nk(r.campaign), r.campaign)

  const adsetsInfo = new Map<string, ItemInfo>()
  const adsInfo = new Map<string, ItemInfo>()
  const funnelsOfCampaign = new Map<string, Set<string>>()
  const funnelsOfAdset = new Map<string, Set<string>>()
  const itemsCache = new Map<string, ItemFrac[]>()
  const fracOf = (m: MetaShare, t: MetaShare, n: number): MetaShare => {
    const f = (k: keyof MetaShare) => (t[k] > 0 ? m[k] / t[k] : t.spend > 0 ? m.spend / t.spend : 1 / n)
    return { impressions: f('impressions'), clicks: f('clicks'), clicksAll: f('clicksAll'), spend: f('spend') }
  }
  for (const [k, list] of byKey) {
    const campaign = campName.get(k.split('|')[0]) || k.split('|')[0]
    const base = baseFunnelOf(campaign)
    const cBase = campaignId('meta', campaign)
    const t = list.reduce((a, r) => ({ impressions: a.impressions + r.m.impressions, clicks: a.clicks + r.m.clicks, clicksAll: a.clicksAll + r.m.clicksAll, spend: a.spend + r.m.spend }), { ...ZERO })
    const out: ItemFrac[] = []
    for (const r of list) {
      const asRule = itemFunnel(campaign, r.adset, null, base)
      const it = r.adId ? itemFunnel(campaign, r.adset, r.ad, base) : asRule
      out.push({ adsetId: r.adsetId, adset: r.adset, adId: r.adId, ad: r.ad, funnel: it.funnel, rule: it.rule, share: fracOf(r.m, t, list.length) })
      if (r.m.spend > 0 || r.m.impressions > 0) {
        let fs = funnelsOfCampaign.get(cBase); if (!fs) funnelsOfCampaign.set(cBase, (fs = new Set())); fs.add(String(it.funnel))
        let fa = funnelsOfAdset.get(r.adsetId); if (!fa) funnelsOfAdset.set(r.adsetId, (fa = new Set())); fa.add(String(it.funnel))
      }
      if (!adsetsInfo.has(r.adsetId)) adsetsInfo.set(r.adsetId, { id: adsetNodeId(r.adsetId), name: r.adset, campaign, campaignBase: cBase, adsetId: r.adsetId, adset: r.adset, funnel: asRule.funnel, rule: asRule.rule })
      if (r.adId && !adsInfo.has(r.adId)) adsInfo.set(r.adId, { id: adNodeId(r.adId), name: r.ad || r.adId, campaign, campaignBase: cBase, adsetId: r.adsetId, adset: r.adset, funnel: it.funnel, rule: it.rule })
    }
    itemsCache.set(k, out)
  }
  const splitCampaigns = new Set<string>([...funnelsOfCampaign].filter(([, s]) => s.size > 1).map(([c]) => c))
  splitCampaigns.add(campaignId('meta', BOFU_CAMPAIGN))
  const splitAdsets = new Set<string>([...funnelsOfAdset].filter(([, s]) => s.size > 1).map(([a]) => a))
  const items = (campaign: string, day: string) => itemsCache.get(`${nk(campaign)}|${day}`) || null

  // ── BOFU fallback for days without any item feed: MTD ad set shares (estimate) ──
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
    if (items(BOFU_CAMPAIGN, day)) return 'feed'
    if (mtdShare && day >= mtd.since && day <= (mtd.until || mtd.since).slice(0, 7) + '-31') return 'approx'
    return 'unsplit'
  }

  const childOf = (cBase: string, f: FunnelKey | null) => (f && splitCampaigns.has(cBase) ? qualify(cBase, f) : cBase)
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
      const its = ov ? null : items(campaign, day)
      if (ov) out = [{ funnel: ov, child: childOf(id, ov), share: ONE, estimate: false }]
      else if (its && its.length) {
        const by = new Map<FunnelKey, MetaShare>()
        for (const it of its) {
          if (!it.funnel) continue
          const s = by.get(it.funnel) || { ...ZERO }
          s.impressions += it.share.impressions; s.clicks += it.share.clicks; s.clicksAll += it.share.clicksAll; s.spend += it.share.spend
          by.set(it.funnel, s)
        }
        out = [...by].map(([f, s]) => ({ funnel: f, child: childOf(id, f), share: s, estimate: false }))
      } else if (isBofu(campaign)) {
        const mode = bofuMode(day)
        const y = mode === 'approx' && mtdShare ? mtdShare : ZERO
        const g: MetaShare = { impressions: 1 - y.impressions, clicks: 1 - y.clicks, clicksAll: 1 - y.clicksAll, spend: 1 - y.spend }
        const est = mode === 'approx'
        out = [
          { funnel: BOFU_FUNNEL_YACHT, child: qualify(id, BOFU_FUNNEL_YACHT), share: y, estimate: est },
          { funnel: BOFU_FUNNEL_GENERIC, child: qualify(id, BOFU_FUNNEL_GENERIC), share: g, estimate: est },
        ]
      } else {
        const f = UMBRELLA_FUNNEL[slug]
        if (f) out = [{ funnel: f, child: childOf(id, f), share: ONE, estimate: false }]
      }
      for (const p of out) {
        if (p.child !== id) label(p.child, isBofu(campaign) ? `BOFU - Landing Attainable Luxury · ${p.funnel === BOFU_FUNNEL_YACHT ? 'Bella, Riva, Ohana' : 'generic'}` : `${campaign} · ${FUNNEL_BY_KEY.get(p.funnel)?.label || p.funnel}`, 'meta')
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
  let funnelAmbiguous = 0
  const leadFunnel: (FunnelKey | null)[] = []
  const leadChild: (string | null)[] = []
  const leadCampaign: (string | null)[] = []
  const leadAdset: (string | null)[] = []
  const leadAd: (string | null)[] = []
  const leadCampaignBy: ('utm' | 'detail' | 'fuzzy' | null)[] = []
  ds.streak.rows.forEach((l, i) => {
    const slug = ds.leadSlugs[i]
    if (isFlatChannelLead(l) || !slug) {
      leadFunnel.push(null); leadChild.push(null); leadCampaign.push(null); leadAdset.push(null); leadAd.push(null); leadCampaignBy.push(null)
      return
    }
    let name: string | null = null
    let platform: 'meta' | 'google' = 'meta'
    let by: 'utm' | 'detail' | 'fuzzy' | null = null
    let utmRows = null as null | { campaign: string; adset: string; ad: string; adId: string; adsetId: string }[]
    if (l.isGoogle) {
      platform = 'google'
      name = googleNames.get(nk(l.detail)) || null
      if (name) by = 'detail'
    } else {
      utmRows = ds.utmRows.get(nk(l.sp)) || null
      const fromUtm = [...new Set((utmRows || []).map((u) => metaNames.get(nk(u.campaign)) || u.campaign).filter(Boolean))]
      if (fromUtm.length) { name = pin(fromUtm, l.day); by = 'utm' }
      else {
        const cands = matchSourceToCampaignCandidates(l.sp, allMeta).filter((n) => adSlug('meta', n) === slug)
        if (cands.length) { name = pin(cands, l.day); by = 'fuzzy' }
        else {
          const exact = metaNames.get(nk(l.sp))
          if (exact) { name = exact; by = 'fuzzy' }
        }
      }
    }
    const id = name ? campaignId(platform, name) : null
    if (id && name) label(id, name, platform)
    // ad set / ad: the utm_mapping rows of THIS campaign; unique = attributed, several = one level up
    let adsetId: string | null = null
    let adId: string | null = null
    let adsetName: string | null = null
    let adName: string | null = null
    if (name && utmRows && platform === 'meta') {
      const mine = utmRows.filter((u) => nk(u.campaign) === nk(name!))
      const adIds = [...new Set(mine.map((u) => u.adId).filter(Boolean))]
      const adsetIds = [...new Set(mine.map((u) => u.adsetId).filter(Boolean))]
      if (adsetIds.length === 1) { adsetId = adsetIds[0]; adsetName = mine.find((u) => u.adsetId === adsetId)!.adset }
      if (adIds.length === 1 && adsetId) { adId = adIds[0]; adName = mine.find((u) => u.adId === adId)!.ad }
    }
    let funnel: FunnelKey | null = null
    // Candidate ads of this utm inside the campaign: when they all sit in ONE funnel the lead does
    // too, even if the ad itself is ambiguous; when they disagree the lead keeps the campaign's
    // base funnel and is counted as funnel-ambiguous (meta.notes).
    let candFunnels: Set<string> | null = null
    if (name && utmRows && platform === 'meta' && !adId) {
      const mine = utmRows.filter((u) => nk(u.campaign) === nk(name!))
      if (mine.length) candFunnels = new Set(mine.map((u) => String(itemFunnel(name!, u.adset, u.ad, UMBRELLA_FUNNEL[slug] ?? null).funnel)))
    }
    if (name && platform === 'meta' && (adsetId || CAMPAIGN_FUNNEL.has(nk(name)))) {
      funnel = itemFunnel(name, adsetName, adName, UMBRELLA_FUNNEL[slug] ?? null).funnel
      if (!adId && candFunnels && candFunnels.size === 1) funnel = [...candFunnels][0] as FunnelKey
      if (!adId && candFunnels && candFunnels.size > 1) funnelAmbiguous++
      if (isBofu(name)) bofuLeadsBy.utm++
    } else if (name && platform === 'meta' && candFunnels && candFunnels.size >= 1) {
      if (candFunnels.size === 1) funnel = [...candFunnels][0] as FunnelKey
      else funnelAmbiguous++
    }
    if (!funnel && ((name && isBofu(name)) || (!name && slug === 'bofu'))) {
      const yacht = BOFU_YACHT_SP.test(l.sp)
      if (yacht) bofuLeadsBy.sp++
      else bofuLeadsBy.default++
      funnel = yacht ? BOFU_FUNNEL_YACHT : BOFU_FUNNEL_GENERIC
    }
    if (!funnel) funnel = UMBRELLA_FUNNEL[slug] ?? null
    leadFunnel.push(funnel)
    leadChild.push(id ? childOf(id, funnel) : null)
    leadCampaign.push(id)
    leadAdset.push(adsetId)
    leadAd.push(adId)
    leadCampaignBy.push(by)
  })

  // Bookings: ad / ad set ids from the Acq sheet links (bookings_ads), joined on email + month.
  const baIndex = new Map<string, { adsetId: string; adId: string; adName: string }[]>()
  for (const r of ds.bookingAds) {
    if (r.storno || (!r.adId && !r.adsetId)) continue
    const k = `${r.email}|${r.month}`
    const l = baIndex.get(k) || []
    l.push({ adsetId: r.adsetId, adId: r.adId, adName: r.adName })
    baIndex.set(k, l)
  }
  const bookingFunnel: (FunnelKey | null)[] = []
  const bookingChild: (string | null)[] = []
  const bookingCampaign: (string | null)[] = []
  const bookingAdset: (string | null)[] = []
  const bookingAd: (string | null)[] = []
  ds.bookings.rows.forEach((b, i) => {
    const slug = ds.bookingSlugs[i]
    if (!slug) { bookingFunnel.push(null); bookingChild.push(null); bookingCampaign.push(null); bookingAdset.push(null); bookingAd.push(null); return }
    const ch = bookingChannel(b)
    const platform: 'meta' | 'google' = ch === 'google' ? 'google' : 'meta'
    const name = b.campaign.trim()
    const id = name ? campaignId(platform, name) : null
    if (id) label(id, name, platform)
    let adsetId: string | null = null
    let adId: string | null = null
    if (platform === 'meta' && b.email) {
      const hits = baIndex.get(`${b.email}|${b.month}`) || []
      if (hits.length === 1) { adsetId = hits[0].adsetId || null; adId = hits[0].adId || null }
    }
    let funnel: FunnelKey | null = null
    if (name && platform === 'meta' && (adId || adsetId)) {
      const ai = adId ? adsInfo.get(adId) : null
      const si = adsetId ? adsetsInfo.get(adsetId) : null
      funnel = itemFunnel(name, si?.adset || ai?.adset || null, ai?.name || null, UMBRELLA_FUNNEL[slug] ?? null).funnel
    } else if (name && platform === 'meta' && CAMPAIGN_FUNNEL.has(nk(name))) funnel = CAMPAIGN_FUNNEL.get(nk(name))!
    else if (name && isBofu(name)) funnel = BOFU_YACHT_LANDING.test(b.landingPage || '') ? BOFU_FUNNEL_YACHT : BOFU_FUNNEL_GENERIC
    if (!funnel) funnel = UMBRELLA_FUNNEL[slug] ?? null
    bookingFunnel.push(funnel)
    bookingChild.push(id ? childOf(id, funnel) : null)
    bookingCampaign.push(id)
    bookingAdset.push(adsetId)
    bookingAd.push(adId)
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

  // ── Landing pages (part 3) ──
  const adLp = (adId: string | null) => (adId ? ds.lp.adLanding.get(adId)?.lp || null : null)
  const lpUrl = new Map<string, string>()
  for (const v of ds.lp.adLanding.values()) if (!lpUrl.has(v.lp)) lpUrl.set(v.lp, v.url || `https://${v.lp}`)
  for (const v of ds.lp.googleLp) if (!lpUrl.has(v.lp)) lpUrl.set(v.lp, v.url.split('?')[0] || `https://${v.lp}`)
  // lead → e-mail (streak_full rows carry none: borrow it from the matching streak_sync row) → HubSpot first_url
  const emailByKey = ds.lp.streakEmail
  const hsByEmail = new Map<string, { lp: string; url: string; day: string }>()
  for (const c of ds.lp.hsContacts) {
    const cur = hsByEmail.get(c.email)
    if (!cur || (c.day && c.day < cur.day)) hsByEmail.set(c.email, { lp: c.lp, url: c.url, day: c.day })
  }
  for (const c of hsByEmail.values()) if (!lpUrl.has(c.lp)) lpUrl.set(c.lp, c.url || `https://${c.lp}`)
  const leadLp: (string | null)[] = ds.streak.rows.map((l, i) => {
    if (leadFunnel[i] === undefined) return null
    const email = l.email || emailByKey.get(`${l.day}|${l.sp}|${l.ai}`) || ''
    return email ? hsByEmail.get(email)?.lp || null : null
  })
  const baLanding = new Map<string, string>()
  for (const r of ds.bookingAds) {
    if (r.storno) continue
    const k = `${r.email}|${r.month}`
    const lp = /lead\s*form/i.test(r.landing) ? LEAD_FORM_LP : r.landing && /\//.test(r.landing) ? lpKeyOf(r.landing.split('/')[0], '/' + r.landing.split('/').slice(1).join('/')) : ''
    if (lp && !baLanding.has(k)) baLanding.set(k, lp)
  }
  const bookingLp: (string | null)[] = ds.bookings.rows.map((b) => {
    const fromAcq = b.email ? baLanding.get(`${b.email}|${b.month}`) : undefined
    if (fromAcq) return fromAcq
    const v = (b.landingPage || '').trim()
    if (!v) return null
    if (/lead\s*form/i.test(v)) return LEAD_FORM_LP
    if (v.startsWith('/')) return lpKeyOf('goolets.net', v)
    return lpKeyOf(v.split('/')[0], '/' + v.split('/').slice(1).join('/'))
  })
  lpUrl.set(LEAD_FORM_LP, 'Meta instant form (FB Lead Form)')
  // GA4 paid sessions → context (utm_campaign = Streak SOURCE PLACEMENT for Meta, the campaign name for Google)
  const gaCache = new Map<string, { funnel: FunnelKey | null; campaignBase: string | null; slug: string | null; adsetId: string | null; adId: string | null }>()
  const ga4 = ds.lp.ga4Utm.map((r) => {
    const s = r.sourceMedium
    const channel: 'meta' | 'google' | 'other' = /face|insta|fb|meta|social|\big\b/.test(s) ? 'meta' : /google|adwords/.test(s) ? 'google' : 'other'
    const k = `${channel}|${r.utmCampaign}|${r.utmContent}|${r.day.slice(0, 7)}`
    let c = gaCache.get(k)
    if (!c) {
      c = { funnel: null, campaignBase: null, slug: null, adsetId: null, adId: null }
      if (channel === 'google') {
        let name = r.utmCampaign
        try { name = decodeURIComponent(name.replace(/\+/g, ' ')) } catch {}
        const g = googleNames.get(nk(name))
        if (g) { c.campaignBase = campaignId('google', g); c.slug = adSlug('google', g); c.funnel = googleFunnel(g) }
      } else if (channel === 'meta') {
        const rows = ds.utmRows.get(nk(r.utmCampaign)) || []
        const names = [...new Set(rows.map((u) => metaNames.get(nk(u.campaign)) || u.campaign))]
        let name = names.length ? pin(names, r.day) : null
        if (!name) {
          const cands = matchSourceToCampaignCandidates(r.utmCampaign.toLowerCase(), allMeta)
          if (cands.length) name = pin(cands, r.day)
        }
        if (name) {
          c.campaignBase = campaignId('meta', name); c.slug = adSlug('meta', name)
          const mine = rows.filter((u) => nk(u.campaign) === nk(name!))
          const content = r.utmContent
          let ad = /^\d{6,}$/.test(content) && adsInfo.has(content) ? adsInfo.get(content)! : null
          if (!ad && content && content !== '(not set)') {
            const hits = [...adsInfo.values()].filter((x) => x.campaignBase === c!.campaignBase && nk(x.name) === nk(content))
            if (hits.length === 1) ad = hits[0]
          }
          const adsetIds = [...new Set(mine.map((u) => u.adsetId).filter(Boolean))]
          c.adId = ad ? ad.id.split(':')[2] : null
          c.adsetId = ad ? ad.adsetId : adsetIds.length === 1 ? adsetIds[0] : null
          const adsetName = c.adsetId ? adsetsInfo.get(c.adsetId)?.name || mine.find((u) => u.adsetId === c!.adsetId)?.adset || null : null
          const base = c.slug ? UMBRELLA_FUNNEL[c.slug] ?? null : null
          c.funnel = adsetName || CAMPAIGN_FUNNEL.has(nk(name)) ? itemFunnel(name, adsetName, null, base).funnel
            : isBofu(name) ? (BOFU_YACHT_SP.test(r.utmCampaign.toLowerCase()) ? BOFU_FUNNEL_YACHT : BOFU_FUNNEL_GENERIC) : base
        }
      }
      gaCache.set(k, c)
    }
    return { day: r.day, lp: r.lp, channel, sessions: r.sessions, ...c }
  })

  // landing_page_view can report more impressions than the campaign itself (one ad, several final
  // URLs): scale a campaign-day's LP impressions down to the campaign's own figure.
  const gDay = new Map<string, number>(), gLp = new Map<string, number>()
  for (const r of ds.google.rows) gDay.set(`${nk(r.campaign)}|${r.day}`, (gDay.get(`${nk(r.campaign)}|${r.day}`) || 0) + r.impressions)
  for (const r of ds.lp.googleLp) gLp.set(`${nk(r.campaign)}|${r.day}`, (gLp.get(`${nk(r.campaign)}|${r.day}`) || 0) + r.impressions)
  const googleLpImprFactor = (campaign: string, day: string) => {
    const k = `${nk(campaign)}|${day}`; const s = gLp.get(k) || 0; const d = gDay.get(k) ?? s
    return s > d && s > 0 ? d / s : 1
  }

  const a: Assignment = {
    googleLpImprFactor,
    leadLp, bookingLp, ga4, adLp, lpUrl,
    metaParts, items, bofuMode, googleFunnel, leadFunnel, leadChild, leadCampaign, leadAdset, leadAd, leadCampaignBy,
    bookingFunnel, bookingChild, bookingCampaign, bookingAdset, bookingAd, lpFunnel, labels,
    splitCampaigns, splitAdsets, adsets: adsetsInfo, ads: adsInfo, bofuLeadsBy, funnelAmbiguousLeads: funnelAmbiguous,
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


// ─── Ad set / ad nodes (part 2) ─────────────────────────────────────────────

function parseItemId(id: string): { kind: 'adset' | 'ad'; id: string; qual: FunnelKey | null } | null {
  const m = /^(adset|ad):meta:(\d+)(?:\|([a-z_]+))?$/.exec(id)
  if (!m) return null
  const qual = (m[3] as FunnelKey) || null
  if (qual && !FUNNEL_BY_KEY.has(qual)) return null
  return { kind: m[1] as 'adset' | 'ad', id: m[2], qual }
}

export function itemScope(ds: Datasets, node: string): NodeScope | null {
  const p = parseItemId(node)
  if (!p) return null
  const A = assignmentOf(ds)
  const info = p.kind === 'adset' ? A.adsets.get(p.id) : A.ads.get(p.id)
  if (!info) return null
  const match = (it: ItemFrac) => (p.kind === 'adset' ? it.adsetId === p.id : it.adId === p.id) && (!p.qual || it.funnel === p.qual)
  return {
    id: node,
    label: info.name,
    metaShare: (c, d) => {
      const its = A.items(c, d)
      if (!its) return null
      const s = { ...ZERO }
      let any = false
      for (const it of its) if (match(it)) { any = true; s.impressions += it.share.impressions; s.clicks += it.share.clicks; s.clicksAll += it.share.clicksAll; s.spend += it.share.spend }
      return any ? s : null
    },
    google: () => false,
    lead: (i) => (p.kind === 'adset' ? A.leadAdset[i] === p.id : A.leadAd[i] === p.id) && (!p.qual || A.leadFunnel[i] === p.qual),
    booking: (i) => (p.kind === 'adset' ? A.bookingAdset[i] === p.id : A.bookingAd[i] === p.id) && (!p.qual || A.bookingFunnel[i] === p.qual),
    lpPath: null,
    lpChannels: [],
    hasMeta: true,
    hasGoogle: false,
  }
}

interface Ctx { funnel: FunnelKey | null; campaignBase: string | null; slug: string | null; adsetId: string | null; adId: string | null; lp: string | null }
type ItemAcc = Acc & { label: string; platform: 'meta' | 'google' | null; path: string[]; leadsPartial: number; movedBy?: 'adset' | 'ad'; type: NodeType | 'lp'; url?: string; lpSeen: boolean; spendApprox: boolean; utmLoss: boolean }

/**
 * Hosts where utm parameters do not reach the GA4 property we read (separate site / redirect):
 * GA4-by-utm Visitors there undercount (CLG ≈ 21–55 % of clicks), so they are quality 'approx'.
 */
export const UTM_LOSS_HOSTS = ['croatialuxurygulet.com']
const isUtmLossLp = (lp: string | null | undefined) => !!lp && UTM_LOSS_HOSTS.some((h) => lp === h || lp.startsWith(h + '/') || lp.includes('.' + h + '/'))
/** Visitors / clicks band outside which GA4 sessions are not a like-for-like count of the clicks. */
export const LP_RATIO_BAND = { min: 0.6, max: 1.1, minClicks: 30 }
/**
 * quality.lpViews: 'n/a' without GA4 rows; 'approx' when the traffic lands on a UTM-loss host, or
 * when visitors / clicks is outside 60–110 % on ≥ 30 clicks (utm lost on the way, or GA4 counting
 * several sessions per click: returning visitors, reloads, in-app browser hand-offs); else 'exact'.
 */
export function lpViewsQuality(lpViews: number | null | undefined, clicks: number | null | undefined, utmLoss: boolean): 'exact' | 'approx' | 'n/a' {
  if (lpViews == null) return 'n/a'
  if (utmLoss) return 'approx'
  const c = clicks || 0
  if (c >= LP_RATIO_BAND.minClicks) { const r = lpViews / c; if (r < LP_RATIO_BAND.min || r > LP_RATIO_BAND.max) return 'approx' }
  return 'exact'
}

export type RollLevel = 'campaign' | 'adset' | 'ad' | 'lp' | 'node'

/**
 * Every row (Meta spend, Google spend, Streak lead, booking, GA4 paid session) with its context
 * (funnel, campaign, ad set, ad, landing page), filtered by `inNode` and keyed by `level`.
 * Meta spend = campaign feed × the item's share of that campaign-day, so Σ items + remainder = node.
 * `googleFromLp` takes Google spend from landing_page_view (needed whenever the landing page
 * matters) instead of daily_api.
 */
function rollupLevel(
  ds: Datasets, A: Assignment, from: string, to: string, channel: Channel, bo: AggOpts,
  level: RollLevel, inNode: (c: Ctx) => boolean, googleFromLp = level === 'lp'
): Map<string, ItemAcc> {
  const out = new Map<string, ItemAcc>()
  const inR = (d: string) => d >= from && d <= to
  const fl = (f: FunnelKey | null) => (f ? FUNNEL_BY_KEY.get(f)?.label || f : '')
  const campLabel = (base: string | null) => (base ? (A.labels.get(base)?.label || base) : '')
  const keyOf = (c: Ctx): { key: string; label: string; platform: 'meta' | 'google' | null; path: string[]; movedBy?: 'adset' | 'ad'; url?: string } | null => {
    if (level === 'node') return { key: 'node', label: '', platform: null, path: [] }
    if (level === 'lp') {
      if (!c.lp) return null
      return { key: c.lp, label: c.lp, platform: null, path: [], url: A.lpUrl.get(c.lp) || `https://${c.lp}` }
    }
    if (level === 'campaign') {
      if (!c.campaignBase) return null
      const key = A.splitCampaigns.has(c.campaignBase) && c.funnel ? qualify(c.campaignBase, c.funnel) : c.campaignBase
      const lab = A.labels.get(key) || A.labels.get(c.campaignBase)
      return { key, label: lab?.label || key, platform: lab?.platform || null, path: [fl(c.funnel)] }
    }
    if (level === 'adset') {
      if (!c.adsetId) return null
      const info = A.adsets.get(c.adsetId)
      const key = A.splitAdsets.has(c.adsetId) && c.funnel ? `${adsetNodeId(c.adsetId)}|${c.funnel}` : adsetNodeId(c.adsetId)
      const moved = info && info.rule === 'adset' ? 'adset' as const : undefined
      return { key, label: info?.name || c.adsetId, platform: 'meta', path: [fl(c.funnel), campLabel(c.campaignBase)], movedBy: moved }
    }
    if (!c.adId) return null
    const info = A.ads.get(c.adId)
    return { key: adNodeId(c.adId), label: info?.name || c.adId, platform: 'meta', path: [fl(c.funnel), campLabel(c.campaignBase), info?.adset || ''] }
  }
  const get = (k: NonNullable<ReturnType<typeof keyOf>>) => {
    let a = out.get(k.key)
    if (!a) out.set(k.key, (a = { ...acc(), label: k.label, platform: k.platform, path: k.path, leadsPartial: 0, movedBy: k.movedBy, type: level === 'node' ? 'campaign' : level, url: k.url, lpSeen: false, spendApprox: false, utmLoss: false }))
    return a
  }
  // Google campaigns whose landing_page_view shows a UTM-loss host (for the daily_api path)
  const gLoss = new Set<string>()
  for (const r of ds.lp.googleLp) if (inR(r.day) && isUtmLossLp(r.lp)) gLoss.add(campaignId('google', r.campaign))
  if (chanIn(channel, 'meta')) {
    const useApi = ds.fbSpend.rows.length > 0
    const add = (campaign: string, day: string, m: { impressions: number; clicks: number; spend: number }, withSpend: boolean, withCounts: boolean) => {
      const slug = adSlug('meta', campaign)
      const base = slug ? campaignId('meta', campaign) : null
      const its = A.items(campaign, day)
      if (!its) {
        // no item feed this day: ad set / ad / LP cannot see it (it stays in the remainder)
        if (level === 'adset' || level === 'ad' || level === 'lp') return
        for (const p of A.metaParts(campaign, day)) {
          const c: Ctx = { funnel: p.funnel, campaignBase: base, slug, adsetId: null, adId: null, lp: null }
          if (!inNode(c)) continue
          const k = keyOf(c); if (!k) continue
          const a = get(k)
          if (withCounts) { a.impressions += m.impressions * p.share.impressions; a.clicks += m.clicks * p.share.clicks }
          if (withSpend) a.spend += m.spend * p.share.spend
          if (p.estimate) a.est = true
        }
        return
      }
      for (const it of its) {
        const lp = A.adLp(it.adId)
        const c: Ctx = { funnel: it.funnel, campaignBase: base, slug, adsetId: it.adsetId, adId: it.adId, lp }
        if (!inNode(c)) continue
        const k = keyOf(c); if (!k) continue
        const a = get(k)
        if (withCounts) { a.impressions += m.impressions * it.share.impressions; a.clicks += m.clicks * it.share.clicks }
        if (withSpend) a.spend += m.spend * it.share.spend
        if (lp && it.adId && ds.lp.adLanding.get(it.adId)?.source !== 'ad_preview') a.spendApprox = true
        if (withSpend && m.spend > 0 && isUtmLossLp(lp)) a.utmLoss = true
      }
    }
    for (const r of ds.fb.rows) if (inR(r.day)) add(r.campaign, r.day, r, !useApi, true)
    if (useApi) for (const r of ds.fbSpend.rows) if (inR(r.day)) add(r.campaign, r.day, { impressions: 0, clicks: 0, spend: r.spend }, true, false)
  }
  if ((level === 'campaign' || level === 'lp' || level === 'node') && chanIn(channel, 'google')) {
    if (googleFromLp) for (const r of ds.lp.googleLp) {
      if (!inR(r.day)) continue
      const g = A.googleFunnel(r.campaign)
      const c: Ctx = { funnel: g, campaignBase: campaignId('google', r.campaign), slug: adSlug('google', r.campaign), adsetId: null, adId: null, lp: r.lp }
      if (!inNode(c)) continue
      const k = keyOf(c); if (!k) continue
      const a = get(k)
      a.impressions += r.impressions * A.googleLpImprFactor(r.campaign, r.day); a.clicks += r.clicks; a.spend += r.spend
      if (r.clicks > 0 && isUtmLossLp(r.lp)) a.utmLoss = true
    } else for (const r of ds.google.rows) {
      if (!inR(r.day)) continue
      const f = A.googleFunnel(r.campaign)
      const c: Ctx = { funnel: f, campaignBase: campaignId('google', r.campaign), slug: adSlug('google', r.campaign), adsetId: null, adId: null, lp: null }
      if (!inNode(c)) continue
      const k = keyOf(c); if (!k) continue
      const a = get(k)
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend
      if (r.clicks > 0 && gLoss.has(c.campaignBase!)) a.utmLoss = true
    }
  }
  ds.streak.rows.forEach((l, i) => {
    if (!inR(l.day)) return
    if (channel !== 'all' && leadChannel(l) !== channel) return
    const c: Ctx = { funnel: A.leadFunnel[i], campaignBase: A.leadCampaign[i], slug: ds.leadSlugs[i], adsetId: A.leadAdset[i], adId: A.leadAd[i], lp: A.leadLp[i] }
    if (!inNode(c)) return
    const k = keyOf(c); if (!k) return
    const a = get(k)
    a.leads++
    if (l.ai >= 50) a.ql++
    if (level === 'campaign' && A.leadCampaignBy[i] === 'fuzzy') a.leadsPartial++
    if (level === 'lp') a.leadsPartial++
  })
  ds.bookings.rows.forEach((b, i) => {
    if (b.month < bo.fromM || b.month > bo.toM) return
    if (channel !== 'all' && bookingChannel(b) !== channel) return
    const c: Ctx = { funnel: A.bookingFunnel[i], campaignBase: A.bookingCampaign[i], slug: ds.bookingSlugs[i], adsetId: A.bookingAdset[i], adId: A.bookingAd[i], lp: A.bookingLp[i] }
    if (!inNode(c)) return
    const k = keyOf(c); if (!k) return
    const a = get(k)
    a.bookings++
    a.revenue += b.rvc
  })
  // GA4 paid sessions (visitors), by the same context
  for (const g of A.ga4) {
    if (!inR(g.day)) continue
    if (channel !== 'all' && g.channel !== channel) continue
    const c: Ctx = { funnel: g.funnel, campaignBase: g.campaignBase, slug: g.slug, adsetId: g.adsetId, adId: g.adId, lp: g.lp }
    if (!inNode(c)) continue
    const k = keyOf(c); if (!k) continue
    const a = get(k)
    a.lpViews = (a.lpViews ?? 0) + g.sessions
    a.lpSeen = true
  }
  return out
}

function nodePredicate(type: NodeType, key: string): (c: Ctx) => boolean {
  if (type === 'master' || type === 'copy') return () => true
  if (type === 'lp') { const lp = lpOfNode(key); return (c) => c.lp === lp }
  if (type === 'funnel') return (c) => c.funnel === key
  if (type === 'umbrella') return (c) => c.slug === key
  if (type === 'campaign') {
    const p = parseCampaignId(key)!
    return (c) => c.campaignBase === p.base && (!p.qual || c.funnel === p.qual)
  }
  const p = parseItemId(key)!
  return p.kind === 'adset'
    ? (c) => c.adsetId === p.id && (!p.qual || c.funnel === p.qual)
    : (c) => c.adId === p.id
}

export const lpOfNode = (id: string) => { const k = id.replace(/^lp:/, ''); try { return decodeURIComponent(k) } catch { return k } }
export const lpNodeId = (lp: string) => `lp:${encodeURIComponent(lp)}`
function levelsFor(type: NodeType, key: string): NodeLevel[] {
  if (type === 'master') return ['funnel', 'campaign', 'adset', 'ad', 'lp', 'copy']
  if (type === 'funnel' || type === 'umbrella') return ['campaign', 'adset', 'ad', 'lp', 'copy']
  if (type === 'campaign') return /^campaign:meta:/.test(key) ? ['adset', 'ad', 'lp', 'copy'] : ['lp']
  if (type === 'adset') return ['ad', 'lp', 'copy']
  if (type === 'lp') return ['campaign', 'adset', 'ad', 'copy']
  if (type === 'copy') return ['ad', 'adset', 'campaign', 'lp']
  return []
}

// ─── Ad copy (part 4) ───────────────────────────────────────────────────────

/** Normalised primary text: NFC, \n line ends, runs of spaces/tabs → one space, lines trimmed, ≤ 1 blank line. */
export const normCopy = (t: string) =>
  String(t || '').normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
export const copyHash = (t: string) => createHash('sha1').update(normCopy(t), 'utf8').digest('hex').slice(0, 12)
export const copyNodeId = (text: string, field: 'body' | 'title' = 'body') => `copy:${field}:${copyHash(text)}`
export const NO_TEXT_LABEL = '(no primary text)'
const LEADS_BELOW_BOOKINGS_NOTE = 'Bookings reach this text through the ad id in the Acq sheet; leads only through a unique utm_mapping row per ad, which these ads lack, so leads can be lower than bookings.'
const r3 = (x: number) => Math.round(x * 1000) / 1000
const copyLabel = (t: string) => { const n = normCopy(t); if (!n) return NO_TEXT_LABEL; const l = n.split('\n')[0]; return l.length > 120 ? l.slice(0, 117).trimEnd() + '…' : l }

interface AdCopyInfo {
  /** body variants: asset id ('' = the creative's own body) → text (null = asset text not resolvable) */
  bodies: { assetId: string; text: string | null }[]
  titles: string[]; descriptions: string[]; ctas: string[]
  multi: boolean
}
const copyInfoMemo = new WeakMap<Datasets, Map<string, AdCopyInfo>>()
function copyInfoOf(ds: Datasets): Map<string, AdCopyInfo> {
  let m = copyInfoMemo.get(ds)
  if (m) return m
  m = new Map()
  const get = (id: string) => { let x = m!.get(id); if (!x) m!.set(id, (x = { bodies: [], titles: [], descriptions: [], ctas: [], multi: false })); return x }
  for (const t of ds.copy.texts) {
    const x = get(t.adId)
    if (t.field === 'body') { if (!x.bodies.some((b) => b.assetId === t.assetId)) x.bodies.push({ assetId: t.assetId, text: t.resolved ? t.text : null }) }
    else { const arr = t.field === 'title' ? x.titles : t.field === 'description' ? x.descriptions : x.ctas; const v = t.text.trim(); if (v && !arr.includes(v)) arr.push(v) }
  }
  for (const x of m.values()) x.multi = new Set(x.bodies.filter((b) => b.assetId).map((b) => b.assetId)).size > 1
  copyInfoMemo.set(ds, m)
  return m
}

type CopyMetrics = { impressions: number; clicks: number; spend: number; lpViews: number; leads: number; ql: number; bookings: number; revenue: number }
const CM_KEYS: (keyof CopyMetrics)[] = ['impressions', 'clicks', 'spend', 'lpViews', 'leads', 'ql', 'bookings', 'revenue']
const MEASURED: (keyof CopyMetrics)[] = ['impressions', 'clicks', 'spend']
const cm0 = (): CopyMetrics => ({ impressions: 0, clicks: 0, spend: 0, lpViews: 0, leads: 0, ql: 0, bookings: 0, revenue: 0 })

/** One ad's share of one text inside the window. */
export interface CopyPart { adId: string; copyId: string; text: string; values: CopyMetrics; multi: boolean; lpSeen: boolean; utmLoss: boolean; est: boolean; spendApprox: boolean }

/**
 * Splits every Meta ad inside `inNode` into its primary texts. Single-text ads: the whole ad.
 * Multi-text ads (Dejan's rule, 2026-11-13): impressions / spend by each body asset's share in
 * Meta's body_asset breakdown over the window, link clicks by its link_click share; leads, QL,
 * bookings, revenue and visitors by the same link-click share (estimate). The last part takes the
 * ad minus the others, so the parts sum exactly to the ad. Parts whose asset text is not
 * resolvable, and multi-text ads without any breakdown row in the window, stay in the remainder.
 */
function copyParts(ds: Datasets, A: Assignment, from: string, to: string, channel: Channel, bo: AggOpts, inNode: (c: Ctx) => boolean) {
  const info = copyInfoOf(ds)
  const adRoll = rollupLevel(ds, A, from, to, channel, bo, 'ad', inNode)
  const bd = new Map<string, Map<string, { spend: number; impressions: number; clicks: number; linkClicks: number }>>()
  for (const r of ds.copy.bodyDaily) {
    if (r.day < from || r.day > to) continue
    let a = bd.get(r.adId); if (!a) bd.set(r.adId, (a = new Map()))
    const x = a.get(r.assetId) || { spend: 0, impressions: 0, clicks: 0, linkClicks: 0 }
    x.spend += r.spend; x.impressions += r.impressions; x.clicks += r.clicks; x.linkClicks += r.linkClicks
    a.set(r.assetId, x)
  }
  const parts: CopyPart[] = []
  const flags = { multiNoBreakdown: { ads: 0, spend: 0 }, unresolvedText: { ads: 0, pairs: 0, spend: 0 }, noTextFeed: { ads: 0, spend: 0 } }
  /** values of every ad / ad part that has no text row (all three flags): remainder.parts metaUnresolvedText */
  const lost = cm0()
  const addLost = (v: CopyMetrics) => { for (const k of CM_KEYS) lost[k] += v[k] }
  for (const [nodeId, a] of adRoll) {
    const adId = nodeId.replace(/^ad:meta:/, '')
    const tot: CopyMetrics = { impressions: a.impressions, clicks: a.clicks, spend: a.spend, lpViews: a.lpSeen ? (a.lpViews ?? 0) : 0, leads: a.leads, ql: a.ql, bookings: a.bookings, revenue: a.revenue }
    const inf = info.get(adId)
    const base = { adId, lpSeen: a.lpSeen, utmLoss: a.utmLoss, est: a.est, spendApprox: a.spendApprox }
    if (!inf) { flags.noTextFeed.ads++; flags.noTextFeed.spend += a.spend; addLost(tot); continue }
    if (!inf.multi) {
      const b = inf.bodies.find((x) => x.text != null)
      const text = b?.text ?? ''
      if (!b && inf.bodies.length) { flags.unresolvedText.ads++; flags.unresolvedText.pairs++; flags.unresolvedText.spend += a.spend; addLost(tot); continue }
      parts.push({ ...base, copyId: copyNodeId(text), text, values: tot, multi: false })
      continue
    }
    const br = bd.get(adId)
    const assets = [...(br || new Map()).entries()].filter(([, x]) => x.spend > 0 || x.impressions > 0 || x.linkClicks > 0)
    if (!assets.length) { flags.multiNoBreakdown.ads++; flags.multiNoBreakdown.spend += a.spend; addLost(tot); continue }
    const S = assets.reduce((n, [, x]) => n + x.spend, 0), I = assets.reduce((n, [, x]) => n + x.impressions, 0)
    const L = assets.reduce((n, [, x]) => n + x.linkClicks, 0), C = assets.reduce((n, [, x]) => n + x.clicks, 0)
    const shareOf = (x: { spend: number; impressions: number; clicks: number; linkClicks: number }) => {
      const sp = S > 0 ? x.spend / S : I > 0 ? x.impressions / I : 1 / assets.length
      const im = I > 0 ? x.impressions / I : sp
      const lc = L > 0 ? x.linkClicks / L : C > 0 ? x.clicks / C : sp
      return { impressions: im, clicks: lc, spend: sp, lpViews: lc, leads: lc, ql: lc, bookings: lc, revenue: lc } as CopyMetrics
    }
    assets.sort((p, q) => p[0].localeCompare(q[0]))
    const done = cm0()
    let lostSpend = 0, lostPairs = 0
    assets.forEach(([assetId, x], i) => {
      const sh = shareOf(x)
      const v = cm0()
      for (const k of CM_KEYS) { v[k] = i === assets.length - 1 ? tot[k] - done[k] : tot[k] * sh[k]; done[k] += v[k] }
      const text = inf.bodies.find((b) => b.assetId === assetId)?.text
      if (text == null) { lostSpend += v.spend; lostPairs++; addLost(v); return }
      parts.push({ ...base, copyId: copyNodeId(text), text, values: v, multi: true })
    })
    if (lostPairs) { flags.unresolvedText.ads++; flags.unresolvedText.pairs += lostPairs; flags.unresolvedText.spend += lostSpend }
  }
  return { parts, flags, info, lost }
}

/** Rows of level=copy: parts merged by text. */
function copyRows(parts: CopyPart[], info: Map<string, AdCopyInfo>) {
  const rows = new Map<string, { id: string; text: string; values: CopyMetrics; measured: CopyMetrics; estimated: CopyMetrics; ads: Set<string>; multiAds: Set<string>; headlines: Set<string>; descriptions: Set<string>; ctas: Set<string>; lpSeen: boolean; utmLoss: boolean; est: boolean; spendApprox: boolean }>()
  for (const p of parts) {
    let r = rows.get(p.copyId)
    if (!r) rows.set(p.copyId, (r = { id: p.copyId, text: normCopy(p.text), values: cm0(), measured: cm0(), estimated: cm0(), ads: new Set(), multiAds: new Set(), headlines: new Set(), descriptions: new Set(), ctas: new Set(), lpSeen: false, utmLoss: false, est: false, spendApprox: false }))
    for (const k of CM_KEYS) { r.values[k] += p.values[k]; (p.multi && !MEASURED.includes(k) ? r.estimated : r.measured)[k] += p.values[k] }
    r.ads.add(p.adId); if (p.multi) r.multiAds.add(p.adId)
    const inf = info.get(p.adId)
    inf?.titles.forEach((t) => r!.headlines.add(t)); inf?.descriptions.forEach((t) => r!.descriptions.add(t)); inf?.ctas.forEach((t) => r!.ctas.add(t))
    r.lpSeen ||= p.lpSeen; r.utmLoss ||= p.utmLoss; r.est ||= p.est; r.spendApprox ||= p.spendApprox
  }
  return rows
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
    const whole = Number.isInteger(nv) && kids.every((x) => x == null || Number.isInteger(x))
    out[k] = Math.abs(d) < 1e-6 ? 0 : k === 'spend' || k === 'revenue' ? r2(d) : whole ? Math.round(d) : Math.round(d * 1000) / 1000
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

// ─── Single-yacht moves (for review) ────────────────────────────────────────

/** Every ad set / ad the single-yacht rule moved out of its campaign's funnel, with spend in the window. */
export function singleYachtMoves(ds: Datasets, A: Assignment, from: string, to: string) {
  const spend = new Map<string, number>()
  for (const r of ds.fbSpend.rows) {
    if (r.day < from || r.day > to) continue
    const its = A.items(r.campaign, r.day)
    if (!its) continue
    for (const it of its) {
      if (it.rule !== 'adset') continue
      const k = `adset|${it.adsetId}`
      spend.set(k, (spend.get(k) || 0) + r.spend * it.share.spend)
    }
  }
  const out: { type: 'adset' | 'ad'; id: string; label: string; campaign: string; adset: string | null; from: FunnelKey | null; to: FunnelKey | null; rule: 'adset' | 'ad'; spend: number }[] = []
  for (const [k, s] of spend) {
    const [kind, id] = k.split('|') as ['adset' | 'ad', string]
    const info = kind === 'adset' ? A.adsets.get(id) : A.ads.get(id)
    if (!info) continue
    const base = UMBRELLA_FUNNEL[adSlug('meta', info.campaign) || ''] ?? null
    out.push({ type: kind, id: kind === 'adset' ? adsetNodeId(id) : adNodeId(id), label: info.name, campaign: info.campaign, adset: kind === 'ad' ? info.adset : null, from: base, to: info.funnel, rule: info.rule as 'adset' | 'ad', spend: r2(s) })
  }
  return out.sort((a, b) => b.spend - a.spend)
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
  const it = parseItemId(n)
  if (it) return { type: it.kind, key: n }
  if (/^lp:.+/.test(n)) return { type: 'lp', key: n }
  if (/^copy:body:[0-9a-f]{12}$/.test(n)) return { type: 'copy', key: n }
  return null
}

export interface NodeOpts {
  node: string
  range: ResolvedRange
  channel: Channel
  /** an already-built master/umbrella response (from the shared cache) — avoids a rebuild */
  base?: FunnelResponse
  /** flat list of every item of this level inside the node (children + remainder = node) */
  level?: NodeLevel
}

export async function loadFunnelNode(o: NodeOpts) {
  const parsed = parseNode(o.node)
  if (!parsed) throw new Error(`Unknown node "${o.node}"`)
  const ds = await getFunnelDatasets()
  if (parsed.type === 'copy' || o.level === 'copy') await ensureCopyFeeds(ds)
  const A = assignmentOf(ds)
  for (const r of ds.fbSpend.rows) A.metaParts(r.campaign, r.day)
  for (const r of ds.google.rows) A.googleFunnel(r.campaign)

  let scope: NodeScope | null = null
  if (parsed.type === 'funnel') scope = funnelScope(ds, parsed.key as FunnelKey)
  if (parsed.type === 'campaign') {
    scope = campaignScope(ds, parsed.key)
    if (!scope) throw new Error(`Unknown campaign node "${o.node}"`)
  }
  if (parsed.type === 'adset' || parsed.type === 'ad') {
    scope = itemScope(ds, parsed.key)
    if (!scope) throw new Error(`Unknown ${parsed.type} node "${o.node}"`)
  }
  const levels = levelsFor(parsed.type, parsed.key)
  const defaultLevel: NodeLevel | null = parsed.type === 'master' ? 'funnel' : levels[0] ?? null
  const level: NodeLevel | null = o.level ?? defaultLevel
  if (o.level && !levels.includes(o.level)) throw new Error(`level "${o.level}" is not available on ${o.node} (levels: ${levels.join(', ') || 'none'})`)
  let resp: FunnelResponse =
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
  const lpKey = parsed.type === 'lp' ? lpOfNode(parsed.key) : null
  const lpAgg = (f: string, t2: string, ob: AggOpts): RawStepValues => lpAggCh(f, t2, ob, o.channel)
  const lpAggCh = (f: string, t2: string, ob: AggOpts, ch: Channel): RawStepValues => {
    const m = rollupLevel(ds, A, f, t2, ch, ob, 'node', (c) => c.lp === lpKey, true).get('node')
    return {
      impressions: m ? m.impressions : 0, clicks: m ? m.clicks : 0, clicksAll: m ? m.clicks : 0,
      lpViews: m?.lpSeen ? m.lpViews : 0, lpViewsOrganic: null, leads: m ? m.leads : 0, ql: m ? m.ql : 0, qlAll: m ? m.ql : 0,
      bookings: m ? m.bookings : 0, revenue: m ? m.revenue : 0, bookingsCohort: 0, revenueCohort: 0, spend: m ? m.spend : 0,
    }
  }
  const copyKey = parsed.type === 'copy' ? parsed.key : null
  // parts of this text in a window (memoised per window: node, previous)
  const copyMemo = new Map<string, ReturnType<typeof copyParts>>()
  const copyPartsOf = (f: string, t2: string, ob: AggOpts) => {
    const k = `${f}|${t2}`
    let x = copyMemo.get(k)
    if (!x) copyMemo.set(k, (x = copyParts(ds, A, f, t2, o.channel, ob, () => true)))
    return x
  }
  const copyAgg = (f: string, t2: string, ob: AggOpts): RawStepValues => {
    const ps = copyPartsOf(f, t2, ob).parts.filter((p) => p.copyId === copyKey)
    const v = cm0()
    for (const p of ps) for (const k of CM_KEYS) v[k] += p.values[k]
    return {
      impressions: v.impressions, clicks: v.clicks, clicksAll: v.clicks, lpViews: ps.some((p) => p.lpSeen) ? v.lpViews : null, lpViewsOrganic: null,
      leads: v.leads, ql: v.ql, qlAll: v.ql, bookings: v.bookings, revenue: v.revenue, bookingsCohort: 0, revenueCohort: 0, spend: v.spend,
    }
  }
  const synthAgg = lpKey ? lpAgg : copyKey ? copyAgg : null
  const aggNode = (f: string, t: string, ob: AggOpts): RawStepValues =>
    synthAgg ? synthAgg(f, t, ob) : scope ? aggregateScope(ds, scope, f, t, o.channel, ob) : aggregate(ds, def, f, t, o.channel, ob)
  if (synthAgg) {
    // A landing page / a text is not one of the funnel's own scopes: rebuild the steps from its rows.
    const c = synthAgg(from, to, bo)
    const pwin = (resp.meta as any).benchmark?.window
    const pv = pwin?.from ? synthAgg(pwin.from, pwin.to, { fromM: pwin.from.slice(0, 7), toM: pwin.to.slice(0, 7) }) : null
    const keys = ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings'] as const
    const val = (v: RawStepValues, k: typeof keys[number]) => (k === 'ql' ? v.qlAll : (v as any)[k]) as number | null
    const SRC: Record<string, string> = copyKey ? {
      impressions: 'Meta ads using this text (multi-text ads: body_asset breakdown share)', clicks: 'Meta link_click (multi-text ads: body_asset link_click share)',
      lpViews: 'GA4 · paid sessions by utm_content of these ads (multi-text ads: split by link clicks)', leads: 'Streak leads on these ads via a unique utm_mapping row (multi-text ads: split by link clicks)', ql: 'Streak · AI≥50', bookings: 'Acq sheet ad id (multi-text ads: split by link clicks)',
    } : {
      impressions: 'Meta ads pointing here (ad → LP map) + Google landing_page_view', clicks: 'Meta link_click + Google clicks to this page',
      lpViews: 'GA4 · paid sessions on this page', leads: 'Streak leads whose HubSpot first_url is this page', ql: 'Streak · AI≥50', bookings: 'Acq sheet landing',
    }
    resp = {
      ...resp,
      steps: keys.map((k, i) => {
        const prevK = i > 0 ? keys[i - 1] : null
        const cv = prevK ? (val(c, prevK) ? (val(c, k) ?? 0) / (val(c, prevK) as number) : null) : null
        const bm = prevK && pv ? (val(pv, prevK) ? (val(pv, k) ?? 0) / (val(pv, prevK) as number) : null) : null
        const st = cv == null || bm == null || bm === 0 ? null : cv / bm >= 0.95 ? 'g' : cv / bm >= 0.8 ? 'a' : 'r'
        const step: any = { key: k, label: resp.steps.find((s) => s.key === k)?.label || k, value: val(c, k), cvrFromPrev: cv, benchmarkCvr: bm, status: st, source: SRC[k] }
        if (k === 'bookings') step.revenue = c.revenue
        if (k === 'ql') step.qualityLeadsIncludingAsset = c.qlAll
        return step
      }),
      efficiency: {
        spend: c.spend, cpm: c.impressions ? (c.spend / (c.impressions as number)) * 1000 : null, cpc: c.clicks ? c.spend / (c.clicks as number) : null,
        cpl: c.leads ? c.spend / (c.leads as number) : null, cpql: c.qlAll ? c.spend / (c.qlAll as number) : null,
        costPerBooking: c.bookings ? c.spend / (c.bookings as number) : null, roas: resp.efficiency.roas !== null && c.spend > 0 ? c.revenue / c.spend : null,
      },
      campaignMembership: { selected: parsed.key, umbrellas: [], unattributed: { leads: 0, qualityLeads: 0, bookings: 0, revenue: 0, spend: 0, members: [] } },
      campaignSummary: null,
      targets: null,
    } as FunnelResponse
  }
  const cur = aggNode(from, to, bo)
  const nodeValues = rawToValues(cur, roasOk, leadsNa, true)
  if (copyKey) {
    // a text is a split of ads: keep its fractions, like its row (3 decimals)
    for (const k of ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings'] as const) { const v = (cur as any)[k === 'ql' ? 'qlAll' : k]; if (nodeValues[k] != null && typeof v === 'number') nodeValues[k] = r3(v) }
  }
  // Campaign / ad set / ad nodes: Visitors = GA4 paid sessions matched by utm (the same cut their
  // rows use one level up), so a node and its own row agree. Null when GA4 has no utm row for it.
  const utmVisNode = parsed.type === 'campaign' || parsed.type === 'adset' || parsed.type === 'ad'
  const visOf = (f: string, t: string, ob: AggOpts) => rollupLevel(ds, A, f, t, o.channel, ob, 'node', nodePredicate(parsed.type, parsed.key), false).get('node')
  const visCur = utmVisNode ? visOf(from, to, bo) : undefined
  if (utmVisNode) nodeValues.lpViews = visCur?.lpSeen ? Math.round(visCur.lpViews as number) : null
  const nodeQuality = {
    lpViews: utmVisNode
      ? lpViewsQuality(nodeValues.lpViews, nodeValues.clicks, !!visCur?.utmLoss)
      : parsed.type === 'lp' ? lpViewsQuality(nodeValues.lpViews, nodeValues.clicks, isUtmLossLp(lpKey))
      : parsed.type === 'copy' ? (copyPartsOf(from, to, bo).parts.some((p) => p.copyId === copyKey && p.multi) ? 'approx' as const : lpViewsQuality(nodeValues.lpViews, nodeValues.clicks, false))
      : fdef?.nonFunnel ? 'n/a' as const : 'exact' as const,
  }
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

  let hiddenLeads: { leads: number; ql: number; funnel: string } | null = null
  let copyCp: ReturnType<typeof copyParts> | null = null
  if (parsed.type === 'master' && level === 'funnel') {
    for (const f of FUNNELS) {
      const sc = funnelScope(ds, f.key)
      const v = aggregateScope(ds, sc, from, to, o.channel, bo)
      const raw = rawToValues(v, roasOk, false, true)
      const shown = f.leadsNa ? { ...raw, leads: null, ql: null } : raw
      // A funnel whose leads are n/a does not claim its few Streak rows: they stay in the remainder,
      // so Σ funnels + remainder still equals master.
      if (f.leadsNa && (raw.leads || raw.ql)) hiddenLeads = { leads: raw.leads || 0, ql: raw.ql || 0, funnel: f.label }
      rawKids.push(shown)
      const touchesBofu = f.key === BOFU_FUNNEL_YACHT || f.key === BOFU_FUNNEL_GENERIC
      const est = touchesBofu && bofuDays.approx > 0
      children.push({
        id: `funnel:${f.key}`, type: 'funnel', label: f.label, platform: null, nonKpi: !!f.nonFunnel, drillable: true,
        values: shown,
        quality: { spend: est ? 'approx' : 'exact', lpViews: f.nonFunnel ? 'n/a' : 'exact', leads: f.leadsNa ? 'n/a' : 'exact' },
        estimate: { spend: est, impressions: est, clicks: est },
      })
    }
  } else if ((parsed.type === 'funnel' || parsed.type === 'umbrella') && level === 'campaign') {
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
    // leads placed on their campaign by the fuzzy placement rules (not a unique utm_mapping row)
    const partial = new Map<string, number>()
    ds.streak.rows.forEach((l, i) => {
      if (l.day < from || l.day > to || A.leadCampaignBy[i] !== 'fuzzy') return
      const s = sel.lead(i)
      if (s.keep && s.child) partial.set(s.child, (partial.get(s.child) || 0) + 1)
    })
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
        quality: { spend: a.est ? 'approx' : 'exact', lpViews: 'n/a', leads: leadsNa ? 'n/a' : partial.get(id) ? 'partial' : 'exact' },
        estimate: { spend: a.est, impressions: a.est, clicks: a.est },
      })
    }
    // Visitors per campaign (part 3): GA4 paid sessions by utm_campaign, same campaign ids.
    const gaCamp = rollupLevel(ds, A, from, to, o.channel, bo, 'campaign', nodePredicate(parsed.type, parsed.key), false)
    for (const ch of children) {
      const g = gaCamp.get(ch.id)
      if (g?.lpSeen) { ch.values = { ...ch.values, lpViews: g.lpViews }; ch.quality = { ...ch.quality, lpViews: lpViewsQuality(g.lpViews, ch.values.clicks, g.utmLoss) } }
    }
    children.sort((x, y) => (y.values.spend || 0) - (x.values.spend || 0))
    // keep rawKids aligned with the sorted children
    rawKids.length = 0
    for (const c of children) rawKids.push({ ...c.values, leads: c.values.leads ?? null, ql: c.values.ql ?? null })
    if (leadsNa) for (let i = 0; i < rawKids.length; i++) { rawKids[i].leads = null; rawKids[i].ql = null }
  }
  else if (level === 'copy' || parsed.type === 'copy') {
    // Ad copy (part 4): level=copy lists the texts inside a node; a copy node lists the ads (or
    // their ad sets / campaigns / landing pages) that carry this text, each with this text's share only.
    const cp = copyKey ? copyPartsOf(from, to, bo) : copyParts(ds, A, from, to, o.channel, bo, nodePredicate(parsed.type, parsed.key))
    copyCp = cp
    const anyMulti = (xs: CopyPart[]) => xs.some((p) => p.multi)
    const est = (multi: boolean, a: boolean) => ({ spend: a, impressions: a, clicks: a, leads: multi, ql: multi, bookings: multi, revenue: multi })
    const q = (v: CopyMetrics, lpSeen: boolean, utmLoss: boolean, multi: boolean, approx: boolean) => ({
      spend: approx ? 'approx' as const : 'exact' as const,
      lpViews: !lpSeen ? 'n/a' as const : multi ? 'approx' as const : lpViewsQuality(v.lpViews, v.clicks, utmLoss),
      leads: leadsNa ? 'n/a' as const : multi ? 'partial' as const : 'exact' as const,
    })
    const vals = (v: CopyMetrics, lpSeen: boolean): NodeValues => {
      const raw = valuesOf({ ...v, lpViews: lpSeen ? v.lpViews : null }, roasOk, false)
      // keep the fractional split (decimals allowed); valuesOf rounds impressions / clicks
      return { ...raw, impressions: r3(v.impressions), clicks: r3(v.clicks), leads: raw.leads == null ? null : r3(raw.leads), ql: raw.ql == null ? null : r3(raw.ql), bookings: raw.bookings == null ? null : r3(raw.bookings), lpViews: raw.lpViews == null ? null : r3(raw.lpViews) }
    }
    if (!copyKey) {
      const rows = copyRows(cp.parts, cp.info)
      for (const r of rows.values()) {
        const multi = r.multiAds.size > 0
        const v = vals(r.values, r.lpSeen)
        const shown = leadsNa ? { ...v, leads: null, ql: null } : v
        children.push({
          id: r.id, type: 'copy', label: copyLabel(r.text), platform: 'meta', nonKpi: false, drillable: true,
          values: shown, quality: q(r.values, r.lpSeen, r.utmLoss, multi, r.est),
          estimate: est(multi, r.est),
          field: 'body', text: r.text || NO_TEXT_LABEL, ...(r.text ? {} : { noText: true }),
          headlines: [...r.headlines], descriptions: [...r.descriptions], ctas: [...r.ctas],
          adsCount: r.ads.size, multiTextAds: r.multiAds.size,
          ...(r.values.bookings > r.values.leads ? { leadsBelowBookings: true, flagNote: LEADS_BELOW_BOOKINGS_NOTE } : {}),
          split: { measured: r.measured, estimated: { lpViews: r.estimated.lpViews, leads: r.estimated.leads, ql: r.estimated.ql, bookings: r.estimated.bookings, revenue: r.estimated.revenue } },
          path: [],
        } as any)
      }
    } else {
      const mine = cp.parts.filter((p) => p.copyId === copyKey)
      const groups = new Map<string, { label: string; platform: 'meta'; path: string[]; parts: CopyPart[]; url?: string }>()
      for (const p of mine) {
        const inf = A.ads.get(p.adId)
        const fk = inf?.funnel ?? null
        const fl = fk ? FUNNEL_BY_KEY.get(fk)?.label || fk : ''
        let key: string | null = null, label = '', path: string[] = [], url: string | undefined
        if (level === 'ad') { key = adNodeId(p.adId); label = inf?.name || p.adId; path = [fl, A.labels.get(inf?.campaignBase || '')?.label || inf?.campaign || '', inf?.adset || ''] }
        else if (level === 'adset') { if (inf) { key = A.splitAdsets.has(inf.adsetId) && fk ? `${adsetNodeId(inf.adsetId)}|${fk}` : adsetNodeId(inf.adsetId); label = inf.adset; path = [fl, A.labels.get(inf.campaignBase)?.label || inf.campaign] } }
        else if (level === 'campaign') { if (inf) { key = A.splitCampaigns.has(inf.campaignBase) && fk ? qualify(inf.campaignBase, fk) : inf.campaignBase; label = A.labels.get(key)?.label || inf.campaign; path = [fl] } }
        else if (level === 'lp') { const lp = A.adLp(p.adId); if (lp) { key = lpNodeId(lp); label = lp; url = A.lpUrl.get(lp) || `https://${lp}` } }
        if (!key) continue
        let g = groups.get(key); if (!g) groups.set(key, (g = { label, platform: 'meta', path, parts: [], url }))
        g.parts.push(p)
      }
      for (const [id, g] of groups) {
        const v = cm0(); for (const p of g.parts) for (const k of CM_KEYS) v[k] += p.values[k]
        const lpSeen = g.parts.some((p) => p.lpSeen), multi = anyMulti(g.parts)
        children.push({
          id, type: level as NodeType, label: g.label, platform: 'meta', nonKpi: false, drillable: true,
          values: vals(v, lpSeen), quality: q(v, lpSeen, g.parts.some((p) => p.utmLoss), multi, g.parts.some((p) => p.est)),
          estimate: est(multi, g.parts.some((p) => p.est)), path: g.path.filter(Boolean), ...(g.url ? { url: g.url } : {}),
          ...(level === 'ad' ? { multiText: multi } : {}),
        } as any)
      }
    }
    children.sort((x, y) => (y.values.spend || 0) - (x.values.spend || 0))
    for (const c of children) rawKids.push({ ...c.values })
    const f = cp.flags
    if (!copyKey) notes.push(`level=copy: Meta ads only (ad feed from 2026-08-01), Google RSA out of scope. Single-text ads count whole; multi-text ads are split per body asset (Meta body_asset breakdown over the window: impressions / spend by its share, link clicks by its link_click share; leads, QL, bookings, revenue, visitors by the link-click share — estimate.leads true, split.estimated). In the remainder: ${f.multiNoBreakdown.ads} multi-text ad(s) without a body_asset row in the window (€${r2(f.multiNoBreakdown.spend)}), ${f.unresolvedText.ads} ad(s) with a body asset whose text Meta no longer returns (€${r2(f.unresolvedText.spend)}), ${f.noTextFeed.ads} ad(s) missing from fb_ad_texts (€${r2(f.noTextFeed.spend)}), plus all Google / Bing / ChatGPT and Meta spend without the ad feed.`)
    else notes.push('Copy node: children carry only this text\'s share of each ad (multi-text ads split by the body_asset breakdown; leads / QL / bookings / revenue / visitors by link-click share, estimate.leads true).')
  }
  else if (level && level !== 'funnel') {
    // flat list of every campaign / ad set / ad inside this node (part 2)
    const roll = rollupLevel(ds, A, from, to, o.channel, bo, level, nodePredicate(parsed.type, parsed.key), level === 'lp' || parsed.type === 'lp')
    for (const [id0, a] of roll) {
      const id = level === 'lp' ? lpNodeId(id0) : id0
      const raw = valuesOf({ ...a, lpViews: a.lpSeen ? a.lpViews : level === 'lp' ? 0 : null }, roasOk, false)
      const shown = leadsNa ? { ...raw, leads: null, ql: null } : raw
      const baseName = a.label.split(' · ')[0]
      const c0 = level === 'campaign' ? CAMPAIGNS.find((c) => c.slug === adSlug(a.platform || 'meta', baseName)) : null
      const ab = level === 'lp' ? abOf(id0) : null
      children.push({
        id, type: level as NodeType, label: a.label, platform: a.platform, nonKpi: !!c0?.nonKpi, drillable: level !== 'ad',
        values: shown,
        quality: {
          spend: a.est || a.spendApprox ? 'approx' : 'exact',
          lpViews: a.lpSeen || level === 'lp' ? lpViewsQuality(raw.lpViews, raw.clicks, a.utmLoss) : 'n/a',
          leads: leadsNa ? 'n/a' : a.leadsPartial ? 'partial' : 'exact',
        },
        estimate: { spend: a.est, impressions: a.est, clicks: a.est },
        path: a.path.filter(Boolean),
        ...(a.url ? { url: a.url } : {}),
        ...(ab ? ab : {}),
        ...(a.movedBy ? { movedBy: a.movedBy } : {}),
      } as NodeChild)
    }
    children.sort((x, y) => (y.values.spend || 0) - (x.values.spend || 0))
    for (const c of children) rawKids.push({ ...c.values })
    if (level === 'lp') notes.push('level=lp: Meta spend reaches a landing page through the ad → LP map (ad_landing: ad preview, else the page HubSpot first_url shows for that ad); Google spend through landing_page_view (PMax / video spend without a landing page stays in the remainder); Visitors = GA4 paid sessions on the page; Leads / QL = HubSpot first_url of the lead\'s e-mail (quality.leads \'partial\'); bookings = Acq landing. Everything without a landing page stays in the remainder.')
    if (level === 'adset' || level === 'ad') notes.push(`level=${level}: Meta spend / impressions / clicks per ${level} come from the ${level === 'ad' ? 'fb_ad_daily_api (only on campaign-days where it is complete) or ' : ''}fb_adset_daily_api feed; campaign-days without it, Google spend and leads / bookings without a unique ${level} stay in the remainder. Leads reach an ${level} only through a UNIQUE utm_mapping row (quality.leads 'exact').`)
  }
  void pushChild

  // ── remainder ──
  // Master: the QL step EXCLUDES the AI-inflated ASSET umbrella, children count it. The remainder
  // is therefore reconciled against qualityLeadsIncludingAsset — never against the step value.
  const reconcileBase: NodeValues =
    parsed.type === 'master' ? rawToValues(cur, roasOk, false, true) : nodeValues
  const remainder = level
    ? { label: '(not attributed lower)', values: remainderOf(reconcileBase, children, rawKids) }
    : null
  // Visitors below the funnel level come from GA4 by utm / landing page, the node's own Visitors
  // from GA4 by landing path: two different cuts, so they are never subtracted from each other.
  if (remainder && utmVisNode) {
    // node and rows are the same GA4-by-utm cut here: the remainder is the plain difference
    const sv = children.reduce((n, c) => n + (c.values.lpViews ?? 0), 0)
    remainder.values.lpViews = nodeValues.lpViews == null ? null : Math.max(0, nodeValues.lpViews - sv)
  } else if (remainder && level !== 'funnel' && parsed.type !== 'lp' && parsed.type !== 'copy') {
    remainder.values.lpViews = null
    if (children.some((c) => c.values.lpViews != null)) notes.push(`Visitors on ${level} rows are GA4 paid sessions matched by utm_campaign / utm_content${level === 'lp' ? ' and landing page' : ''}; the node's own Visitors step is GA4 by landing path. They are different cuts, so remainder.lpViews is null rather than a difference of the two.`)
  }
  if (remainder && (parsed.type === 'lp' || parsed.type === 'copy')) {
    const s = children.reduce((n, c) => n + (c.values.lpViews ?? 0), 0)
    remainder.values.lpViews = Math.max(0, (nodeValues.lpViews ?? 0) - s)
  }
  // level=copy: split the remainder into its causes (frontend, 2026-11-13). Σ parts = remainder exactly:
  // the last part (metaNotAttributableToAd) takes what the others leave.
  let copyRemainderParts: { key: string; label: string; values: NodeValues }[] | null = null
  if (remainder && level === 'copy' && !copyKey && copyCp) {
    const metaAgg = (f: string, t2: string, ob: AggOpts): RawStepValues =>
      lpKey ? lpAggCh(f, t2, ob, 'meta') : scope ? aggregateScope(ds, scope, f, t2, 'meta', ob) : aggregate(ds, def, f, t2, 'meta', ob)
    const metaOn = o.channel === 'all' || o.channel === 'meta'
    const M = metaOn ? rawToValues(metaAgg(from, to, bo), roasOk, false, true) : null
    const AD_START = '2026-08-01'
    const beforeTo = to < AD_START ? to : addDays(AD_START, -1)
    const Mb = metaOn && from < AD_START ? rawToValues(metaAgg(from, beforeTo, { fromM: from.slice(0, 7), toM: beforeTo.slice(0, 7) }), roasOk, false, true) : null
    const R = remainder.values
    const keys: (keyof NodeValues)[] = ['impressions', 'clicks', 'lpViews', 'leads', 'ql', 'bookings', 'revenue', 'spend']
    const L = copyCp.lost
    const mk = () => ({ impressions: 0, clicks: 0, lpViews: 0, leads: 0, ql: 0, bookings: 0, revenue: 0, spend: 0, roas: null } as NodeValues)
    const nonMeta = mk(), unres = mk(), before = mk(), notAd = mk()
    const fix = (x: number) => Math.round(x * 1000) / 1000
    for (const k of keys) {
      const r = R[k]
      if (r == null) { nonMeta[k] = unres[k] = before[k] = notAd[k] = null; continue }
      const node = reconcileBase[k] ?? 0
      const m = M ? (M[k] ?? 0) : 0
      nonMeta[k] = fix(node - m)
      unres[k] = fix((L as any)[k] ?? 0)
      // spend / impressions / clicks never reach an ad only on days without the ad feed (before 1.8. or an
      // incomplete campaign-day); leads / bookings do when they carry no unique ad id.
      const measured = k === 'spend' || k === 'impressions' || k === 'clicks'
      const sumAds = (node - r) + (unres[k] as number)   // Σ rows + unresolved = Σ ads seen at ad level
      before[k] = fix(measured ? Math.max(0, m - sumAds) : Mb ? (Mb[k] ?? 0) : 0)
      notAd[k] = fix(r - (nonMeta[k] as number) - (unres[k] as number) - (before[k] as number))
    }
    copyRemainderParts = [
      { key: 'nonMeta', label: 'Google / Bing / ChatGPT (no Meta ad copy)', values: nonMeta },
      { key: 'metaUnresolvedText', label: 'Meta ad parts whose text is unknown (asset text not readable, no body breakdown, ad not in fb_ad_texts)', values: unres },
      { key: 'beforeAdData', label: 'Meta before 2026-08-01 or on campaign-days without a complete ad feed', values: before },
      { key: 'metaNotAttributableToAd', label: 'Meta leads / bookings / visitors without a unique ad id (campaign or ad set level only)', values: notAd },
    ]
    ;(remainder as any).parts = copyRemainderParts
  }
  if (parsed.type === 'master') {
    const qlStep = resp.steps.find((s) => s.key === 'ql')
    notes.push(
      `Children + remainder reconcile against steps[ql].qualityLeadsIncludingAsset (${qlStep?.qualityLeadsIncludingAsset ?? 'n/a'}), not against the QL step value (${qlStep?.value ?? 'n/a'}): the master QL step excludes the ASSET / RareOps umbrella (AI score inflated), every child counts its own QL in full.`
    )
  }
  if (leadsNa && fdef?.leadsNa) notes.push(fdef.leadsNa)
  if (hiddenLeads) notes.push(`The remainder includes ${hiddenLeads.leads} Streak lead(s) / ${hiddenLeads.ql} QL from ${hiddenLeads.funnel}, where leads are shown as n/a (its registrations live in HubSpot).`)
  if (bofuDays.approx || bofuDays.unsplit) {
    notes.push(
      `BOFU ad set split: ${bofuDays.feed} day(s) from fb_adset_daily_api, ${bofuDays.approx} day(s) allocated from MTD ad set shares (estimate:true), ${bofuDays.unsplit} day(s) without ad set data kept whole in EB Croatia.`
    )
  }
  if (A.funnelAmbiguousLeads) notes.push(`${A.funnelAmbiguousLeads} lead(s) over the whole Streak feed carry a utm that several ads share across funnels (single-yacht ad vs generic ad in one campaign, e.g. earlybook2027_tier1); they stay in the campaign's own funnel because the ad cannot be told apart. Unique utm_content per ad (SOP, new ads) removes this.`)
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
    if (utmVisNode) { const pvis = visOf(pw.from, pw.to, { fromM: pw.from.slice(0, 7), toM: pw.to.slice(0, 7) }); previous.values.lpViews = pvis?.lpSeen ? Math.round(pvis.lpViews as number) : null }
  }
  const stepKeyMap: Record<string, keyof NodeValues> = { impressions: 'impressions', clicks: 'clicks', lpViews: 'lpViews', leads: 'leads', ql: 'ql', bookings: 'bookings' }
  // Bookings are month-granular at source: on a window that is not whole months the QL → booking
  // rate compares a part-month lead count with whole-month bookings. Flag it and drop that
  // benchmark/status (the rate itself stays, labelled by the flag).
  const bookingsWindowMismatch = meta.bookingsWindow.from !== from || meta.bookingsWindow.to !== to
  const roundCount = (v: any) => (typeof v === 'number' ? Math.round(v) : v)
  const steps = resp.steps.map((s) => {
    const k = stepKeyMap[s.key]
    let prevVal = previous && k ? previous.values[k] : null
    if (parsed.type === 'master' && s.key === 'ql' && previous) {
      const pv = aggregate(ds, null, pw.from, pw.to, o.channel, { fromM: pw.from.slice(0, 7), toM: pw.to.slice(0, 7) })
      prevVal = pv.ql
    }
    // Step values are whole numbers, like `values` (the BOFU ad set split allocates fractions).
    const st: any = {
      ...s,
      value: roundCount(s.value),
      previousValue: roundCount(prevVal),
      ...(s.key === 'clicks' ? { clicksAll: roundCount((s as any).clicksAll) } : {}),
      ...(s.channels ? { channels: s.channels.map((c: any) => ({ ...c, value: roundCount(c.value) })) } : {}),
    }
    if (s.key === 'bookings' && bookingsWindowMismatch) { st.benchmarkCvr = null; st.status = null; st.benchmarkSuppressed = 'bookingsWindowMismatch' }
    if (leadsNa && (s.key === 'leads' || s.key === 'ql')) { st.value = null; st.cvrFromPrev = null; st.status = null; st.previousValue = null }
    if (s.key === 'bookings' && previous) st.previousRevenue = previous.values.revenue
    return st
  })
  { const lst = steps.find((x) => x.key === 'lpViews'); if (lst) lst.quality = nodeQuality.lpViews }
  if (utmVisNode) {
    // Visitors step (and the Leads step's rate) from the node's GA4-by-utm visitors
    const rate = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null)
    const stOf = (cv: number | null, bm: number | null) => (cv == null || bm == null || bm === 0 ? null : cv / bm >= 0.95 ? 'g' : cv / bm >= 0.8 ? 'a' : 'r')
    const pv = previous?.values
    for (const st of steps) {
      if (st.key === 'lpViews') {
        st.value = nodeValues.lpViews
        st.previousValue = pv?.lpViews ?? null
        st.cvrFromPrev = rate(nodeValues.lpViews, nodeValues.clicks)
        st.benchmarkCvr = rate(pv?.lpViews, pv?.clicks)
        st.status = stOf(st.cvrFromPrev, st.benchmarkCvr)
        st.source = 'GA4 · paid sessions by utm (utm_campaign / utm_term / utm_content)'
        st.quality = nodeQuality.lpViews
        delete st.channels
      }
      if (st.key === 'leads' && !leadsNa) {
        st.cvrFromPrev = rate(nodeValues.leads, nodeValues.lpViews)
        st.benchmarkCvr = rate(pv?.leads, pv?.lpViews)
        st.status = stOf(st.cvrFromPrev, st.benchmarkCvr)
      }
    }
  }

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
  if (parsed.type === 'adset' || parsed.type === 'ad') {
    const ip = parseItemId(parsed.key)!
    const info = ip.kind === 'adset' ? A.adsets.get(ip.id)! : A.ads.get(ip.id)!
    const fk = ip.qual || info.funnel
    if (fk) path.push({ id: `funnel:${fk}`, label: FUNNEL_BY_KEY.get(fk)!.label })
    const cId = A.splitCampaigns.has(info.campaignBase) && fk ? qualify(info.campaignBase, fk) : info.campaignBase
    path.push({ id: cId, label: A.labels.get(cId)?.label || info.campaign })
    if (ip.kind === 'ad') {
      const sId = A.splitAdsets.has(info.adsetId) && fk ? `${adsetNodeId(info.adsetId)}|${fk}` : adsetNodeId(info.adsetId)
      path.push({ id: sId, label: info.adset })
    }
    label = scope!.label
    path.push({ id: parsed.key, label })
  }
  let nodeUrl: string | undefined
  let copyNode: Record<string, any> | null = null
  let copyTop: Record<string, any> | null = null
  if (parsed.type === 'copy') {
    const cp = copyPartsOf(from, to, bo)
    const mine = cp.parts.filter((p) => p.copyId === copyKey)
    // the text itself does not depend on the window: fall back to the whole feed when it has no spend here
    let text = mine[0]?.text
    const ads = new Set(mine.map((p) => p.adId))
    if (text == null) for (const [adId, inf] of cp.info) for (const b of inf.bodies) if (b.text != null && copyNodeId(b.text) === copyKey) { text = b.text; ads.add(adId) }
    if (text == null) throw new Error(`Unknown copy node "${o.node}"`)
    const rows = copyRows(mine, cp.info).get(copyKey!)
    const hs = new Set<string>(), ds2 = new Set<string>(), cs = new Set<string>()
    for (const a of ads) { const inf = cp.info.get(a); inf?.titles.forEach((t) => hs.add(t)); inf?.descriptions.forEach((t) => ds2.add(t)); inf?.ctas.forEach((t) => cs.add(t)) }
    label = copyLabel(text)
    copyNode = { text: normCopy(text) || NO_TEXT_LABEL, field: 'body', headlines: [...hs], descriptions: [...ds2], ctas: [...cs], adsCount: ads.size, multiTextAds: rows?.multiAds.size ?? 0 }
    if (rows && rows.values.bookings > rows.values.leads) Object.assign(copyNode, { leadsBelowBookings: true, flagNote: LEADS_BELOW_BOOKINGS_NOTE })
    // same estimate / split as the text's row one level up
    const multi = (rows?.multiAds.size ?? 0) > 0
    copyTop = {
      estimate: { spend: !!rows?.est, impressions: !!rows?.est, clicks: !!rows?.est, leads: multi, ql: multi, bookings: multi, revenue: multi },
      split: rows ? { measured: rows.measured, estimated: { lpViews: rows.estimated.lpViews, leads: rows.estimated.leads, ql: rows.estimated.ql, bookings: rows.estimated.bookings, revenue: rows.estimated.revenue } } : null,
    }
    path.push({ id: o.node, label })
  }
  if (parsed.type === 'lp') {
    label = lpKey!
    nodeUrl = A.lpUrl.get(lpKey!) || `https://${lpKey}`
    path.push({ id: lpNodeId(lpKey!), label })
  }
  const node: NodeInfo & { url?: string; abGroup?: string; abVariant?: 'A' | 'B' } = {
    id: parsed.type === 'master' ? 'master' : parsed.type === 'lp' ? lpNodeId(lpKey!) : o.node, type: parsed.type, label, path,
    ...(nodeUrl ? { url: nodeUrl } : {}),
    ...(parsed.type === 'lp' && abOf(lpKey!) ? abOf(lpKey!)! : {}),
    ...(copyNode || {}),
  }

  return {
    ...resp,
    meta: {
      ...meta,
      node: node.id,
      bookingsWindowMismatch,
      notes: [
        ...(meta.notes || []),
        ...notes,
        ...(bookingsWindowMismatch
          ? [`bookingsWindowMismatch: bookings cover whole months ${meta.bookingsWindow.from}…${meta.bookingsWindow.to}, the window is ${from}…${to}. The QL → booking benchmark and status are suppressed on this view (steps[bookings].benchmarkSuppressed).`]
          : []),
      ],
    },
    steps,
    node,
    funnels: FUNNEL_LIST,
    levels,
    level,
    quality: nodeQuality,
    values: parsed.type === 'master' ? { ...nodeValues, qlStep: resp.steps.find((s) => s.key === 'ql')?.value ?? null } : nodeValues,
    children,
    remainder,
    coverage,
    previous,
    freshness: freshnessOf(resp, ds),
    bofuSplit: { days: bofuDays, leadsBy: A.bofuLeadsBy },
    ...(copyTop || {}),
    ...(copyCp ? { copyFlags: { ...copyCp.flags, note: 'unresolvedText / multiNoBreakdown / noTextFeed = Meta ads or ad parts without a known text; their values are remainder.parts[metaUnresolvedText]' } } : {}),
    ...(parsed.type === 'master' ? { singleYachtMoves: singleYachtMoves(ds, A, from, to) } : {}),
  }
}

export type FunnelNodeResponse = Awaited<ReturnType<typeof loadFunnelNode>>

// ─── Search index ───────────────────────────────────────────────────────────

export async function loadFunnelIndex(o: { range: ResolvedRange; channel: Channel; umbrellas?: boolean; all?: boolean }) {
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
  if (o.all) {
    const roll = rollupLevel(ds, A, from, to, o.channel, bo, 'lp', () => true, true)
    for (const [lp, x] of roll) {
      // every landing page the master level=lp list shows (same rollup, no threshold), incl. meta-instant-form/
      items.push({ id: lpNodeId(lp), type: 'lp', label: lp, path: ['All campaigns · Master'], platform: null, funnel: null, spend: r2(x.spend), leads: x.leads, url: x.url } as any)
    }
  }
  if (o.all) for (const lv of ['adset', 'ad'] as const) {
    const roll = rollupLevel(ds, A, from, to, o.channel, bo, lv, () => true)
    for (const [id, x] of roll) {
      if (!(x.spend > 0) && !x.leads && !x.bookings) continue
      items.push({ id, type: lv, label: x.label, path: ['All campaigns · Master', ...x.path.filter(Boolean)], platform: 'meta', funnel: null, spend: r2(x.spend), leads: x.leads })
    }
  }
  if (o.all) {
    await ensureCopyFeeds(ds)
    const cp = copyParts(ds, A, from, to, o.channel, bo, () => true)
    for (const r of copyRows(cp.parts, cp.info).values()) {
      items.push({ id: r.id, type: 'copy', label: copyLabel(r.text), path: ['All campaigns · Master'], platform: 'meta', funnel: null, spend: r2(r.values.spend), leads: r.values.leads, text: r.text || NO_TEXT_LABEL, headlines: [...r.headlines], field: 'body', adsCount: r.ads.size } as any)
    }
  }
  // Umbrellas are an internal grouping: only listed with ?umbrellas=1, labelled as such.
  if (o.umbrellas) for (const c of CAMPAIGNS) {
    const fk = UMBRELLA_FUNNEL[c.slug] ?? null
    items.push({ id: `umbrella:${c.slug}`, type: 'umbrella', label: `${c.name} (internal umbrella)`, path: ['All campaigns · Master', ...(fk ? [FUNNEL_BY_KEY.get(fk)!.label] : [])], platform: null, funnel: fk, spend: null, leads: null })
  }
  return { meta: { range: o.range, channel: o.channel, effectiveWindow: meta.effectiveWindow, generatedAt: new Date().toISOString() }, items }
}

/** Verify helper (scripts/verify-funnel-nodes.ts): every copy part in the window, plus the flags. */
export async function copyPartsForVerify(range: ResolvedRange, channel: Channel, win?: { from: string; to: string }) {
  if (win) range = { ...range, from: win.from, to: win.to }
  const ds = await ensureCopyFeeds(await getFunnelDatasets())
  const A = assignmentOf(ds)
  // same warm-up as loadFunnelNode (lead placement reads the memoised Meta parts)
  for (const r of ds.fbSpend.rows) A.metaParts(r.campaign, r.day)
  for (const r of ds.google.rows) A.googleFunnel(r.campaign)
  return copyParts(ds, A, range.from, range.to, channel, { fromM: range.from.slice(0, 7), toM: range.to.slice(0, 7) }, () => true)
}
