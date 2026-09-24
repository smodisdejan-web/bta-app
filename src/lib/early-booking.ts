// src/lib/early-booking.ts
//
// Early Booking — Croatia 2027 (CBO) campaign scoreboard for the Goolets Content Portal
// "Published" tab. Unlike Turkey this is a single-campaign, tier-level funnel (no per-yacht
// split — vessel is blank on ~71% of leads, no weeks/cap target). CEO metric set:
//   Spend · Leads · CPL · QL · CPQL · Bookings · RVC · ROI  + per-ad FB delivery table.
//
// Sources:
//   FB spend / impressions / clicks / ad-level  → `fb_earlybook` tab (YTD, written by
//        code/facebook/sync-earlybook-fb.js — NOT the 90d-sliding fb_ads_level feed).
//   Leads + QL  → streak_sync, SOURCE PLACEMENT = 'earlybook2027_tier1', QL = AI ≥ 50.
//   Bookings + RVC → bookings_api, campaign = 'Early Booking - Croatia 2027 - CBO'.
//
// Lead basis: the funnel uses STREAK leads (so CPL and CPQL share one denominator). The
// per-ad table uses FB's Landing Lead (custom conv 826326275502780) — that section is
// explicitly "FB Ads Manager data" (no per-ad UTM exists to join Streak at ad level).

import { fetchSheet, fetchStreakSync, fetchBookings } from './sheetsData'
import { DEFAULT_WEB_APP_URL, getSheetsUrl } from './config'
import { adsManagerLink } from './facebook-ads-level'

export const EARLY_BOOKING = {
  campaignName: 'Early Booking - Croatia 2027 - CBO',
  campaignId: '120239003658380087',
  sourcePlacement: 'earlybook2027_tier1', // Streak SOURCE PLACEMENT (lowercased at source)
  qlThreshold: 50,                         // AI score
  fbTab: 'fb_earlybook',
  window: 'YTD 2026 · since 21 Jan',
}

const num = (v: any): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export interface EarlyBookingAd {
  ad_id: string; ad_name: string; thumb_url: string
  spend: number; impressions: number; clicks: number; cpm: number; ctr: number; cpc: number
  landing_lead: number; cpl: number
}

export interface EarlyBookingKpis {
  as_of: string
  layout: 'campaign'
  title: string
  window: string
  deep_dive_url: string
  delivery: { spend: number; impressions: number; clicks: number; cpm: number; ctr: number }
  // Full one-row funnel: Spend → CPC → Clicks → LP rate → LP Views → Conv rate → Leads →
  // QL rate → Quality Leads → Close rate → Bookings → avg deal → Revenue (ROAS).
  funnel: {
    spend: number; cpc: number; clicks: number
    lpRate: number; lpViews: number; convRate: number
    leads: number; cpl: number
    qlRate: number; ql: number; cpql: number
    closeRate: number; bookings: number; avgDeal: number; revenue: number; roas: number | null
  }
  scoreboard: {
    spend: number
    leads: number; cpl: number
    ql: number; qlRate: number; cpql: number
    bookings: number; rvc: number; roi: number | null
  }
  ad_breakdown: EarlyBookingAd[]
  lead_basis: { funnel: string; ad: string; fb_landing_lead_total: number; streak_leads: number }
}

export async function loadEarlyBookingKpis(): Promise<EarlyBookingKpis> {
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL

  const [fbRows, streak, bookings] = await Promise.all([
    fetchSheet({ sheetUrl, tab: EARLY_BOOKING.fbTab }),
    fetchStreakSync(fetchSheet, sheetUrl),
    fetchBookings(),
  ])

  // ── FB ad-level (YTD) ───────────────────────────────────────────────
  // fetchSheet returns array-of-arrays (header row first). Build a column index, then map.
  const fbArr: any[][] = Array.isArray(fbRows) ? fbRows : []
  const fbHeader: string[] = (fbArr[0] || []).map((h) => String(h).trim())
  const ci = (name: string) => fbHeader.indexOf(name)
  const idx = {
    ad_id: ci('ad_id'), ad_name: ci('ad_name'), thumb_url: ci('thumb_url'),
    spend: ci('spend'), impressions: ci('impressions'), clicks: ci('clicks'),
    cpm: ci('cpm'), ctr: ci('ctr'), cpc: ci('cpc'), landing_lead: ci('landing_lead'), lp_views: ci('lp_views'),
  }
  const dataRows = fbArr.slice(1)
  const TOTALS_ID = '__campaign_totals__'
  // Campaign-total LP views ride on a sentinel row (not fetchable per-ad via MCP).
  const totalsRow = dataRows.find((r: any[]) => String(r[idx.ad_id]) === TOTALS_ID)
  const lpViews = totalsRow && idx.lp_views >= 0 ? num(totalsRow[idx.lp_views]) : 0

  const ads: EarlyBookingAd[] = dataRows
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

  const spend = ads.reduce((s, a) => s + a.spend, 0)
  const impressions = ads.reduce((s, a) => s + a.impressions, 0)
  const clicks = ads.reduce((s, a) => s + a.clicks, 0)
  const fbLandingLead = ads.reduce((s, a) => s + a.landing_lead, 0)
  const cpc = clicks > 0 ? spend / clicks : 0
  const lpRate = clicks > 0 ? (lpViews / clicks) * 100 : 0

  // ── Streak leads + QL (the funnel denominator) ──────────────────────
  const ebLeads = streak.filter((l) => (l.source_placement || '') === EARLY_BOOKING.sourcePlacement)
  const leads = ebLeads.length
  const ql = ebLeads.filter((l) => num(l.ai_score) >= EARLY_BOOKING.qlThreshold).length
  const qlRate = leads > 0 ? (ql / leads) * 100 : 0
  const cpl = leads > 0 ? spend / leads : 0
  const cpql = ql > 0 ? spend / ql : 0
  const convRate = lpViews > 0 ? (leads / lpViews) * 100 : 0

  // ── Bookings + RVC (campaign-attributed) ────────────────────────────
  const ebBookings = bookings.filter((b) =>
    (b.campaign || '').trim().toLowerCase() === EARLY_BOOKING.campaignName.toLowerCase())
  const bookingsN = ebBookings.length
  const rvc = ebBookings.reduce((s, b) => s + num(b.rvc), 0)
  const roi = spend > 0 ? rvc / spend : null
  const closeRate = ql > 0 ? (bookingsN / ql) * 100 : 0
  const avgDeal = bookingsN > 0 ? rvc / bookingsN : 0

  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0

  return {
    as_of: new Date().toISOString(),
    layout: 'campaign',
    title: 'Early Booking — Croatia 2027',
    window: EARLY_BOOKING.window,
    deep_dive_url: adsManagerLink(EARLY_BOOKING.campaignId),
    delivery: { spend, impressions, clicks, cpm, ctr },
    funnel: {
      spend, cpc, clicks,
      lpRate, lpViews, convRate,
      leads, cpl,
      qlRate, ql, cpql,
      closeRate, bookings: bookingsN, avgDeal, revenue: rvc, roas: roi,
    },
    scoreboard: { spend, leads, cpl, ql, qlRate, cpql, bookings: bookingsN, rvc, roi },
    ad_breakdown: ads,
    lead_basis: { funnel: 'streak (earlybook2027_tier1)', ad: 'fb landing_lead', fb_landing_lead_total: fbLandingLead, streak_leads: leads },
  }
}
