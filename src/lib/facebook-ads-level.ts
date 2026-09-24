// Facebook Ads — AD-LEVEL (Faza 2). Reads the `fb_ads_level` tab written from the Meta
// reporting CSV export. EXACT per-ad metrics (spend, Landing Lead, CPL, Hook/Hold, rankings).
//
// QL / CPQL / zone are reserved EMPTY until the UTM→Streak SOURCE PLACEMENT join is built
// (Meta refuses to export url_tags). The UI shows them as "pending" so the section is honest.

import { DEFAULT_WEB_APP_URL, SHEETS_TABS } from './config'

export type FbBucket = 'LEAD' | 'BOOST' | 'MATCHMAKER'

export const FB_AD_ACCOUNT = '2422256151414958'
export const adsManagerLink = (adId: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${FB_AD_ACCOUNT}&selected_ad_ids=${adId}`

export interface FbAdLevel {
  adId: string
  adName: string
  adset: string
  campaign: string
  bucket: FbBucket
  creativeId: string
  thumbUrl: string
  spend: number
  impressions: number
  reach: number
  frequency: number
  cpm: number
  clicks: number
  cpc: number
  ctr: number          // link CTR, % (e.g. 2.61)
  landingLead: number  // unified lead (custom conv 826326275502780), exact per ad
  metaLeads: number    // FB form leads only
  cpl: number          // spend / landingLead
  hookRate: number     // ratio 0–1
  holdRate: number     // ratio 0–1
  videoP100: number
  thruplays: number
  avgPlay: number
  qRank: string
  eRank: string
  cRank: string
  status: string
  ql: number | null    // pending UTM join
  cpql: number | null  // pending UTM join
  zone: string         // pending UTM join
}

const n = (v: any): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export async function fetchFbAdsLevel(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<FbAdLevel[]> {
  const res = await fetch(`${sheetUrl}?tab=${encodeURIComponent(SHEETS_TABS.FB_ADS_LEVEL)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fb_ads_level fetch failed: ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  return rows.map((r: any) => ({
    adId: String(r.ad_id || ''),
    adName: String(r.ad_name || ''),
    adset: String(r.adset || ''),
    campaign: String(r.campaign || ''),
    bucket: (r.bucket as FbBucket) || 'LEAD',
    creativeId: String(r.creative_id || ''),
    thumbUrl: String(r.thumb_url || ''),
    spend: n(r.spend), impressions: n(r.impressions), reach: n(r.reach), frequency: n(r.frequency),
    cpm: n(r.cpm), clicks: n(r.clicks), cpc: n(r.cpc), ctr: n(r.ctr),
    landingLead: n(r.landing_lead), metaLeads: n(r.meta_leads), cpl: n(r.cpl),
    hookRate: n(r.hook_rate), holdRate: n(r.hold_rate), videoP100: n(r.video_p100),
    thruplays: n(r.thruplays), avgPlay: n(r.avg_play),
    qRank: String(r.q_rank || ''), eRank: String(r.e_rank || ''), cRank: String(r.c_rank || ''),
    status: String(r.status || ''),
    ql: r.ql === '' || r.ql == null ? null : n(r.ql),
    cpql: r.cpql === '' || r.cpql == null ? null : n(r.cpql),
    zone: String(r.zone || ''),
  })) as FbAdLevel[]
}

export interface BucketTotal { bucket: FbBucket; ads: number; spend: number; landingLead: number; cpl: number }

export function bucketTotals(ads: FbAdLevel[]): BucketTotal[] {
  const order: FbBucket[] = ['LEAD', 'BOOST', 'MATCHMAKER']
  return order.map((b) => {
    const g = ads.filter((a) => a.bucket === b)
    const spend = g.reduce((s, a) => s + a.spend, 0)
    const landingLead = g.reduce((s, a) => s + a.landingLead, 0)
    return { bucket: b, ads: g.length, spend, landingLead, cpl: landingLead ? spend / landingLead : 0 }
  })
}

// Campaign rollup from ad-level (single source — app aggregates, no separate tab).
export interface FbCampaignRow {
  campaign: string; bucket: FbBucket; ads: number; spend: number; impressions: number
  clicks: number; ctr: number; landingLead: number; metaLeads: number; cpl: number
}

export function rollupByCampaign(ads: FbAdLevel[]): FbCampaignRow[] {
  const map = new Map<string, FbCampaignRow>()
  for (const a of ads) {
    let r = map.get(a.campaign)
    if (!r) { r = { campaign: a.campaign, bucket: a.bucket, ads: 0, spend: 0, impressions: 0, clicks: 0, ctr: 0, landingLead: 0, metaLeads: 0, cpl: 0 }; map.set(a.campaign, r) }
    r.ads++; r.spend += a.spend; r.impressions += a.impressions; r.clicks += a.clicks
    r.landingLead += a.landingLead; r.metaLeads += a.metaLeads
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0,
    cpl: r.landingLead ? r.spend / r.landingLead : 0,
  })).sort((a, b) => b.spend - a.spend)
}

// ── Ad copy (primary texts + headlines), per-variation delivery ──
// Source: fb_ad_copy tab (Meta body_asset/title_asset breakdown). Leads N/A per copy (Meta limit)
// → signal is delivery-share + CTR. Powers per-ad expandable AND the cross-ad Copy Library.

export type CopyType = 'primary' | 'headline'
export interface FbCopyRow { adId: string; type: CopyType; text: string; impr: number; spend: number; clicks: number }
export interface CopyVariation extends FbCopyRow { ctr: number; cpc: number; share: number } // share = % of ad's impr (within type)
export interface CopyLibraryRow { type: CopyType; text: string; impr: number; spend: number; clicks: number; ctr: number; cpc: number; ads: number }

export async function fetchFbAdCopy(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<FbCopyRow[]> {
  const res = await fetch(`${sheetUrl}?tab=${encodeURIComponent(SHEETS_TABS.FB_AD_COPY)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fb_ad_copy fetch failed: ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  return rows.map((r: any) => ({
    adId: String(r.ad_id || ''), type: (r.type as CopyType) || 'primary', text: String(r.text || ''),
    impr: n(r.impr), spend: n(r.spend), clicks: n(r.clicks),
  })).filter((r: FbCopyRow) => r.text)
}

// group copy rows by ad → {primary[], headline[]}, each sorted by impressions (winner first) with share% + CTR
export function copyByAd(rows: FbCopyRow[]): Map<string, { primary: CopyVariation[]; headline: CopyVariation[] }> {
  const m = new Map<string, FbCopyRow[]>()
  for (const r of rows) { const a = m.get(r.adId) || []; a.push(r); m.set(r.adId, a) }
  const out = new Map<string, { primary: CopyVariation[]; headline: CopyVariation[] }>()
  for (const [ad, list] of m) {
    const build = (t: CopyType): CopyVariation[] => {
      const g = list.filter((r) => r.type === t)
      const tot = g.reduce((s, r) => s + r.impr, 0) || 1
      return g.map((r) => ({ ...r, ctr: r.impr ? (r.clicks / r.impr) * 100 : 0, cpc: r.clicks ? r.spend / r.clicks : 0, share: (r.impr / tot) * 100 }))
        .sort((a, b) => b.impr - a.impr)
    }
    out.set(ad, { primary: build('primary'), headline: build('headline') })
  }
  return out
}

// Copy Library: each unique text aggregated across ALL ads it ran in. The copywriter's "what works".
export function copyLibrary(rows: FbCopyRow[], type: CopyType): CopyLibraryRow[] {
  const m = new Map<string, { impr: number; spend: number; clicks: number; ads: Set<string> }>()
  for (const r of rows) {
    if (r.type !== type) continue
    const e = m.get(r.text) || { impr: 0, spend: 0, clicks: 0, ads: new Set<string>() }
    e.impr += r.impr; e.spend += r.spend; e.clicks += r.clicks; e.ads.add(r.adId); m.set(r.text, e)
  }
  return Array.from(m.entries()).map(([text, e]) => ({
    type, text, impr: e.impr, spend: e.spend, clicks: e.clicks,
    ctr: e.impr ? (e.clicks / e.impr) * 100 : 0, cpc: e.clicks ? e.spend / e.clicks : 0, ads: e.ads.size,
  })).sort((a, b) => b.impr - a.impr)
}

// Creative highlights (CPL-based for now; CPQL once QL joins).
export function creativeHighlights(ads: FbAdLevel[]) {
  const lead = ads.filter((a) => a.bucket === 'LEAD' && a.spend > 50)
  const withLeads = lead.filter((a) => a.landingLead > 0)
  const bestCpl = withLeads.length ? withLeads.reduce((b, a) => (a.cpl < b.cpl ? a : b)) : null
  const worstCpl = withLeads.length ? withLeads.reduce((b, a) => (a.cpl > b.cpl ? a : b)) : null
  const bestHook = lead.length ? lead.reduce((b, a) => (a.hookRate > b.hookRate ? a : b)) : null
  const topSpendNoLead = lead.filter((a) => a.landingLead === 0).sort((a, b) => b.spend - a.spend)[0] || null
  return { bestCpl, worstCpl, bestHook, topSpendNoLead }
}
