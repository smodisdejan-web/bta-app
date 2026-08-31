// src/lib/campaign-funnel.ts
//
// Generic single-campaign / funnel CEO scoreboard for the Content Portal "Published" tab
// (layout:'campaign'). Same contract as Early Booking, parameterized by a CampaignFunnelConfig
// so each funnel (Dalmatinčki, …) is just a config + a thin route. Reads a dedicated FB tab
// (per-ad rows + a `__campaign_totals__` sentinel carrying authoritative spend/impr/clicks/
// landing_lead/lp_views — used when the ad list is truncated to top-N), Streak leads/QL, and
// bookings. Funnel uses Streak leads (CPL/CPQL share one denominator); ad table uses FB data.

import { fetchSheet, fetchStreakSync, fetchBookings } from './sheetsData'
import { DEFAULT_WEB_APP_URL, getSheetsUrl } from './config'

const FB_ACCOUNT = '2422256151414958'

export interface CampaignFunnelConfig {
  title: string
  window: string
  fbTab: string                              // e.g. 'fb_dalmatincki'
  /** Last date the fbTab snapshot actually covers (YYYY-MM-DD). REQUIRED for any spend-derived
   *  metric to be published — set it from whatever refreshes the tab. Omit it and spend, CPC,
   *  CPM, CPL, CPQL and ROAS all return null. See the freshness contract below. */
  coverageThrough?: string | null
  qlThreshold?: number                        // AI score, default 50
  sourcePlacementMatch: (sp: string) => boolean // Streak SOURCE PLACEMENT → belongs to this funnel
  bookingMatch: (campaign: string) => boolean    // bookings_api campaign → belongs to this funnel
  bookingDateFrom?: string                        // floor booking_date (YYYY or YYYY-MM) to campaign-active window
  deepDiveUrl?: string
}

const num = (v: any): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const TOTALS_ID = '__campaign_totals__'

export interface CampaignFunnelAd {
  ad_id: string; ad_name: string; thumb_url: string
  spend: number; impressions: number; clicks: number; cpm: number; ctr: number; cpc: number
  landing_lead: number; cpl: number
}

export async function loadCampaignFunnel(cfg: CampaignFunnelConfig) {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  const qlThreshold = cfg.qlThreshold ?? 50

  const [fbRows, streak, bookings] = await Promise.all([
    fetchSheet({ sheetUrl, tab: cfg.fbTab }),
    fetchStreakSync(fetchSheet, sheetUrl),
    fetchBookings(),
  ])

  // ── FB (per-ad rows + authoritative totals sentinel) ────────────────
  const fbArr: any[][] = Array.isArray(fbRows) ? fbRows : []
  const header: string[] = (fbArr[0] || []).map((h) => String(h).trim())
  const ci = (n: string) => header.indexOf(n)
  const idx = {
    ad_id: ci('ad_id'), ad_name: ci('ad_name'), thumb_url: ci('thumb_url'),
    spend: ci('spend'), impressions: ci('impressions'), clicks: ci('clicks'),
    cpm: ci('cpm'), ctr: ci('ctr'), cpc: ci('cpc'), landing_lead: ci('landing_lead'), lp_views: ci('lp_views'),
  }
  const dataRows = fbArr.slice(1)
  const totalsRow = dataRows.find((r: any[]) => String(r[idx.ad_id]) === TOTALS_ID)

  const ads: CampaignFunnelAd[] = dataRows
    .filter((r: any[]) => String(r[idx.ad_id] || '') && String(r[idx.ad_id]) !== TOTALS_ID)
    .map((r: any[]) => {
      const spend = num(r[idx.spend]), landing = num(r[idx.landing_lead])
      return {
        ad_id: String(r[idx.ad_id] || ''), ad_name: String(r[idx.ad_name] || ''), thumb_url: String(r[idx.thumb_url] || ''),
        spend, impressions: num(r[idx.impressions]), clicks: num(r[idx.clicks]), cpm: num(r[idx.cpm]),
        ctr: num(r[idx.ctr]), cpc: num(r[idx.cpc]), landing_lead: landing, cpl: landing ? spend / landing : 0,
      }
    })
    .sort((a, b) => b.spend - a.spend)

  // Prefer the authoritative totals row (handles truncated ad lists); else sum the ads.
  const sum = (k: keyof CampaignFunnelAd) => ads.reduce((s, a) => s + (a[k] as number), 0)
  const spend = totalsRow ? num(totalsRow[idx.spend]) : sum('spend')
  const impressions = totalsRow ? num(totalsRow[idx.impressions]) : sum('impressions')
  const clicks = totalsRow ? num(totalsRow[idx.clicks]) : sum('clicks')
  const fbLandingLead = totalsRow ? num(totalsRow[idx.landing_lead]) : sum('landing_lead')
  const lpViews = totalsRow && idx.lp_views >= 0 ? num(totalsRow[idx.lp_views]) : 0
  const cpc = clicks > 0 ? spend / clicks : 0
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
  const lpRate = clicks > 0 ? (lpViews / clicks) * 100 : 0

  // ── Streak leads + QL ───────────────────────────────────────────────
  const funnelLeads = streak.filter((l) => cfg.sourcePlacementMatch(l.source_placement || ''))
  const leads = funnelLeads.length
  const ql = funnelLeads.filter((l) => num(l.ai_score) >= qlThreshold).length
  const qlRate = leads > 0 ? (ql / leads) * 100 : 0
  const cpl = leads > 0 ? spend / leads : 0
  const cpql = ql > 0 ? spend / ql : 0
  const convRate = lpViews > 0 ? (leads / lpViews) * 100 : 0

  // ── Bookings + RVC ──────────────────────────────────────────────────
  // booking_date is "YYYY-MM"; floor it to the campaign-active window (string compare works).
  const fb = bookings.filter((b) =>
    cfg.bookingMatch(b.campaign || '') &&
    (!cfg.bookingDateFrom || String(b.booking_date || '') >= cfg.bookingDateFrom))
  const bookingsN = fb.length
  const rvc = fb.reduce((s, b) => s + num(b.rvc), 0)
  const avgDeal = bookingsN > 0 ? rvc / bookingsN : 0

  // ── Freshness contract ──────────────────────────────────────────────
  // Every metric below divides revenue or leads by `spend`, which comes from the cfg.fbTab
  // snapshot. That tab carries NO date column, so its coverage cannot be read from the data,
  // and nothing in the repo writes it — `fb_dalmatincki` has been frozen since ~2026-06-16.
  // The result was a public, unauthenticated CEO scoreboard labelled "YTD 2026" reporting
  // ROAS 9.87x against a true 3.51x, with every error in the flattering direction. Proof it
  // was impossible: the tab's YTD spend for ad 120243435301630087 is EUR 873.08 while August
  // alone is EUR 900.68 — a YTD figure cannot be smaller than one month inside it.
  //
  // A source that cannot state what period it covers does not get to publish a ratio. Until a
  // refresh is wired (and `coverageThrough` set from it), the raw counts still ship — they are
  // what the snapshot honestly holds — but everything derived from spend returns null, so a
  // consumer renders "—" instead of a flattering number it has no way to know is stale.
  const coverageThrough = cfg.coverageThrough || null
  const spendIsTrustworthy = Boolean(coverageThrough)
  const roas = spendIsTrustworthy && spend > 0 ? rvc / spend : null
  const closeRate = ql > 0 ? (bookingsN / ql) * 100 : 0

  return {
    as_of: new Date().toISOString(),
    layout: 'campaign' as const,
    title: cfg.title,
    window: cfg.window,
    deep_dive_url: cfg.deepDiveUrl || `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${FB_ACCOUNT}`,
    freshness: {
      coverageThrough,
      stale: !spendIsTrustworthy,
      source: cfg.fbTab,
      note: spendIsTrustworthy
        ? null
        : `${cfg.fbTab} carries no date column and nothing refreshes it, so the period it covers is unknown. Spend-derived metrics (ROAS, CPL, CPQL, CPC, CPM) are returned as null rather than computed on a snapshot that may be months old.`,
    },
    delivery: {
      spend: spendIsTrustworthy ? spend : null,
      impressions, clicks,
      cpm: spendIsTrustworthy ? cpm : null,
      ctr,
    },
    funnel: {
      spend: spendIsTrustworthy ? spend : null,
      cpc: spendIsTrustworthy ? cpc : null,
      clicks, lpRate, lpViews, convRate,
      leads,
      cpl: spendIsTrustworthy ? cpl : null,
      qlRate, ql,
      cpql: spendIsTrustworthy ? cpql : null,
      closeRate, bookings: bookingsN, avgDeal, revenue: rvc, roas,
    },
    scoreboard: {
      spend: spendIsTrustworthy ? spend : null,
      leads,
      cpl: spendIsTrustworthy ? cpl : null,
      ql, qlRate,
      cpql: spendIsTrustworthy ? cpql : null,
      bookings: bookingsN, rvc, roas,
    },
    ad_breakdown: ads,
    lead_basis: { funnel: 'streak', ad: 'fb landing_lead', fb_landing_lead_total: fbLandingLead, streak_leads: leads },
  }
}
