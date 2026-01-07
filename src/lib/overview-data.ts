// src/lib/overview-data.ts
// Overview data aggregator - combines all data sources for the /overview page
// All KPI totals are computed STRICTLY from the date-filtered trendPoints series
//
// Data sources:
// - Google spend: daily tab (cost column)
// - Facebook spend: fb_ads_raw tab (data.spend column)
// - LP Views: Google clicks (daily) + Facebook LP views (fb_ads_enriched)

import {
  loadGoogleTraffic,
  loadFbTraffic,
  loadFbSpendFromRaw,
  loadContacts,
  loadDeals,
  fetchStreakLeads,
  fetchStreakLeadsGoogle,
  mapFbEnriched,
  fetchSheet,
  DateRange,
  GoogleTrafficResult,
  FbTrafficResult,
  FbSpendResult,
  ContactsResult,
  DealsResult,
  StreakLeadRow
} from './sheetsData';
import { getSheetsUrl } from './config';
import { computeFacebookSummary, FacebookSummary } from './metrics/facebook';
import { fetchTab } from './sheetsData';
import { loadFbDashboard, FbDashboardData } from './loaders/fb-dashboard';

export type CACMode = 'leads' | 'deals';

export type { DateRange };

export interface TrendPoint {
  date: string;
  spend: number;
  revenue: number;
  lpViews: number;
}

export interface OverviewKpis {
  revenueWon: number;
  wonDeals: number;
  winRate: number;
  avgDealSize: number;
  spend: number;
  leads: number;
  sql: number;
  cac: number;
  roas: number;
  lpViews: number;
}

export interface OverviewDebug {
  range: DateRange;
  contacts: ContactsResult['__debug'];
  deals: DealsResult['__debug'];
  traffic: {
    google: {
      ok: boolean;
      tab: 'daily';
      found: GoogleTrafficResult['found'];
      dateRange?: GoogleTrafficResult['dateRange'];
      rows: number;
      windowSpend: number;
      error?: string;
    };
    facebook: {
      ok: boolean;
      tab: 'fb_ads_raw';
      found: FbSpendResult['found'];
      dateRange?: FbSpendResult['dateRange'];
      rows: number;
      windowSpend: number;
      error?: string;
    };
    fbLpViews?: {
      ok: boolean;
      rows: number;
      windowLpViews: number;
    };
  };
  // KPI totals computed from the date-filtered trendPoints series
  totalsFromSeries: {
    spendTotal: number;
    lpViewsTotal: number;
    revenueTotal: number;
    gaSpendInWindow: number;
    fbSpendInWindow: number;
    gaClicksInWindow: number;
    fbLpViewsInWindow: number;
  };
  totals: {
    spend: number;
    revenue: number;
    lpViews: number;
    leads: number;
    sql: number;
    wonDeals: number;
  };
}

export interface OverviewDataResult {
  kpis: OverviewKpis;
  range: DateRange;
  trendPoints: TrendPoint[];
  facebookSummary?: FacebookSummary | FbDashboardData;
  googleSummary?: {
    spend: number;
    clicks: number;
    leads: number;
    cpl: number;
  };
  previousPeriod?: {
    totalSpend: number;
    fbSpend: number;
    googleSpend: number;
    totalLeads: number;
    fbLeads: number;
    googleLeads: number;
    qualityLeads: number;
    fbQualityLeads: number;
    googleQualityLeads: number;
    avgAiScore: number;
  } | null;
  __debug: OverviewDebug;
}

/**
 * Calculate date range from now - days to now (in UTC)
 */
export async function getDateRange(days = 30): Promise<DateRange> {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (days - 1) * 86400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Generate array of all days between from and to (inclusive)
 */
function getAllDays(from: string, to: string): string[] {
  const days: string[] = [];
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');

  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  return days;
}

// Legacy function for API routes compatibility (synchronous version)
export function getDateRangeSync(filters: { dateRange: string; customStart?: string; customEnd?: string }): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (filters.dateRange === 'custom' && filters.customStart && filters.customEnd) {
    return { start: new Date(filters.customStart), end: new Date(filters.customEnd) };
  }
  const days = filters.dateRange === '30d' ? 30 : filters.dateRange === '60d' ? 60 : 90;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export function isDateInRange(dateStr: string | null | undefined, start: Date | string, end: Date | string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;
  return date >= startDate && date <= endDate;
}

// Stub implementations for API routes (to be implemented properly later)
export async function getOverviewMetrics(_filters: any, _sheetUrl?: string): Promise<any> {
  console.warn('getOverviewMetrics: stub implementation');
  return { spend: 0, leads: 0, revenue: 0, cac: 0, roas: 0 };
}

export async function getCampaignPerformance(_filters: any, _sheetUrl?: string): Promise<any[]> {
  console.warn('getCampaignPerformance: stub implementation');
  return [];
}

/**
 * Main overview data aggregator
 * Loads all data sources in parallel and computes KPIs + chart data
 * 
 * Data sources:
 * - Google spend: daily tab (cost column) - uses toNumberEUorUS for €/$ parsing
 * - Facebook spend: fb_ads_raw tab (data.spend column) - NOT fb_ads_enriched
 * - LP Views: Google clicks (daily) + Facebook LP views (fb_ads_enriched)
 * 
 * All KPI totals are computed STRICTLY from the date-filtered trendPoints series:
 * - Spend = sum(trendPoints.map(p => p.spend))
 * - LP Views = sum(trendPoints.map(p => p.lpViews))
 * - Revenue = sum(trendPoints.map(p => p.revenue))
 * - ROAS = revenueTotal / max(spendTotal, 1e-9)
 * - CAC = spendTotal / max(leads or wonDeals, 1)
 */
export async function getOverviewData(days = 30, cacMode: CACMode = 'leads'): Promise<OverviewDataResult> {
  console.log('[overview-data] Loading data for', days, 'days, CAC mode:', cacMode);

  const range = await getDateRange(days);
  console.log('[overview-data] Date range:', range);

  const sheetsUrl = getSheetsUrl();

  // Load all data sources in parallel
  // - Google: daily tab for spend and clicks
  // - Facebook summary from dashboard_fb tab (cell ranges)
  const [googleTraffic, fbSpendRaw, fbTrafficEnriched, contacts, deals, fbRawTab, fbEnrichedTab, fbSheetSummary, streakFb, streakGoogle] = await Promise.all([
    loadGoogleTraffic(sheetsUrl),
    loadFbSpendFromRaw(sheetsUrl, 'fb_ads_raw'),
    loadFbTraffic(sheetsUrl), // For LP views only
    loadContacts(range),
    loadDeals(range),
    fetchTab('fb_ads_raw', sheetsUrl),
    fetchTab('fb_ads_enriched', sheetsUrl),
    loadFbDashboard().catch((err) => {
      console.warn('[overview-data] loadFbDashboard failed', err);
      return null;
    }),
    fetchStreakLeads(fetchSheet, sheetsUrl),
    fetchStreakLeadsGoogle(fetchSheet, sheetsUrl)
  ]);

  console.log('[overview-data] Data loaded:', {
    googleTraffic: { ok: googleTraffic.ok, tab: googleTraffic.tab, rows: googleTraffic.rows },
    fbSpendRaw: { ok: fbSpendRaw.ok, rows: fbSpendRaw.rows, found: fbSpendRaw.found },
    fbTrafficEnriched: { ok: fbTrafficEnriched.ok, rows: fbTrafficEnriched.rows },
    contacts: { rows: contacts.__debug.rows, leads: contacts.leads, sql: contacts.sql },
    deals: { rows: deals.__debug.rows, won: deals.wonDeals, revenue: deals.revenue }
  });

  // Build days array for the requested window (inclusive) - same list used for trend chart
  const allDays = getAllDays(range.from, range.to);

  // Sanity check: log the date window
  console.debug('[overview-data] Window days:', allDays[0], 'to', allDays[allDays.length - 1], `(${allDays.length} days)`);

  const fbSummaryData = (fbSheetSummary as FbDashboardData | null) || null;
  const fromISO = range.from;
  const toISO = range.to;
  const hasFbSpendDaily = fbSpendRaw?.fbSpendByDate && Object.keys(fbSpendRaw.fbSpendByDate).length > 0;
  const hasFbLpDaily = fbTrafficEnriched?.fbLpViewsByDate && Object.keys(fbTrafficEnriched.fbLpViewsByDate).length > 0;
  const fbFallbackDailySpend = fbSummaryData && allDays.length ? fbSummaryData.spend / allDays.length : 0;
  const fbFallbackDailyLpViews = fbSummaryData && allDays.length ? fbSummaryData.lpViews / allDays.length : 0;
  const fbEnrichedRows = fbEnrichedTab?.headers?.length ? mapFbEnriched([fbEnrichedTab.headers, ...fbEnrichedTab.rows]) : [];
  const fbLeadsByDate: Record<string, number> = {};
  fbEnrichedRows.forEach((r) => {
    const day = r.date_iso || r.date_start;
    if (!day) return;
    const leads = (r.fb_form_leads || 0) + (r.landing_leads || 0);
    if (!Number.isFinite(leads)) return;
    fbLeadsByDate[day] = (fbLeadsByDate[day] || 0) + leads;
  });

  // Build trendPoints and compute per-source totals within the window
  const trendPoints: TrendPoint[] = [];
  let gaSpendInWindow = 0;
  let fbSpendInWindow = 0;
  let gaClicksInWindow = 0;
  let gaLeadsInWindow = 0;
  let fbLpViewsInWindow = 0;

  for (const day of allDays) {
    // Read from sources (returns 0 if day not present)
    // Google spend from daily tab
    const gaSpend = googleTraffic.gaSpendByDate[day] ?? 0;
    // Google leads will be summed separately from gaConvByDate
    const fbSpend = hasFbSpendDaily
      ? fbSpendRaw.fbSpendByDate[day] ?? 0
      : fbFallbackDailySpend;
    // Google clicks for LP views
    const gaClicks = googleTraffic.gaClicksByDate[day] ?? 0;
    // Facebook LP views from fb_ads_enriched; fallback to dashboard_fb average if missing
    const fbLpViews = hasFbLpDaily
      ? fbTrafficEnriched.fbLpViewsByDate[day] ?? 0
      : fbFallbackDailyLpViews;
    // Revenue from won deals
    const dayRevenue = deals.revenueByDate[day] ?? 0;

    // Compute day totals
    const daySpend = gaSpend + fbSpend;
    const dayLpViews = gaClicks + fbLpViews;

    // Track per-source totals within window
    gaSpendInWindow += gaSpend;
    fbSpendInWindow += fbSpend;
    gaClicksInWindow += gaClicks;
    fbLpViewsInWindow += fbLpViews;

    // Push to trend points
    trendPoints.push({
      date: day,
      spend: daySpend,
      revenue: dayRevenue,
      lpViews: dayLpViews
    });
  }

  // ---------------------------------------------------------------------------
  // Google leads from daily conv column (gaConvByDate)
  // ---------------------------------------------------------------------------
  let gaLeadsDebugLogged = false;
  if (googleTraffic?.gaConvByDate) {
    console.log('[overview-data] Calculating Google leads from daily conv column');
    console.log('[overview-data] gaConvByDate keys:', Object.keys(googleTraffic.gaConvByDate).slice(0, 10));

    for (const [dateKey, convValue] of Object.entries(googleTraffic.gaConvByDate)) {
      if (dateKey >= fromISO && dateKey <= toISO) {
        const numValue = typeof convValue === 'number' ? convValue : 0;
        gaLeadsInWindow += numValue;
        if (numValue > 0) {
          gaLeadsDebugLogged = true;
          console.log(`[overview-data] Date ${dateKey}: ${numValue} conversions`);
        }
      }
    }
  }
  console.log(`[overview-data] Total Google leads in window: ${gaLeadsInWindow}`);

  // Compute all KPI totals STRICTLY from the trendPoints series
  const spendTotalSeries = trendPoints.reduce((sum, p) => sum + p.spend, 0);
  const lpViewsTotal = trendPoints.reduce((sum, p) => sum + p.lpViews, 0);
  const revenueTotal = trendPoints.reduce((sum, p) => sum + p.revenue, 0);

  // Facebook spend: use dashboard_fb when available, but for 60d fallback to window spend
  const fbSpendFinal = days === 60
    ? fbSpendInWindow
    : fbSummaryData?.spend ?? fbSpendInWindow;
  const spendTotal = gaSpendInWindow + fbSpendFinal;
  const fbLeadsWindow = allDays.reduce((sum, d) => sum + (fbLeadsByDate[d] || 0), 0);
  const fbLeads = fbSummaryData?.leads ?? fbLeadsWindow;
  const totalLeads = gaLeadsInWindow + fbLeads;

  // Sanity check: log computed totals
  console.debug('[overview-data] Totals:', {
    gaSpendInWindow: gaSpendInWindow.toFixed(2),
    fbSpendInWindow: fbSpendInWindow.toFixed(2),
    fbSpendFinal: fbSpendFinal.toFixed(2),
    spendTotalSeries: spendTotalSeries.toFixed(2),
    spendTotalDashboard: spendTotal.toFixed(2),
    message: `Google (daily) window spend: €${gaSpendInWindow.toFixed(2)} + Facebook (dashboard_fb): €${fbSpendFinal.toFixed(2)} = Total spend: €${spendTotal.toFixed(2)}`
  });

  // KPIs from contacts and deals (already filtered by range)
  const { leads, sql } = contacts;
  const { wonDeals, createdDeals, avgDealSize } = deals;

  // Win Rate = wonDeals / max(createdDeals, 1)
  const winRate = createdDeals > 0 ? wonDeals / createdDeals : 0;

  // CAC = spendTotal / max(leads|wonDeals, 1) - computed from filtered totals
  const cac = cacMode === 'leads'
    ? spendTotal / Math.max(totalLeads, 1)
    : spendTotal / Math.max(wonDeals, 1);

  // ROAS = revenueTotal / max(spendTotal, 1e-9) - computed from filtered totals
  const roas = revenueTotal / Math.max(spendTotal, 1e-9);

  // ---------------------------------------------------------------------------
  // Previous period calculations (only for 7d / 30d)
  // ---------------------------------------------------------------------------
  const shouldCalcPrev = days === 7 || days === 30;
  let previousPeriod: OverviewDataResult['previousPeriod'] = null;

  if (shouldCalcPrev) {
    const prevEnd = new Date(fromISO);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    const prevFromISO = prevStart.toISOString().slice(0, 10);
    const prevToISO = prevEnd.toISOString().slice(0, 10);

    const sumMapInRange = (map: Record<string, number>, start: string, end: string) => {
      let total = 0;
      for (const [k, v] of Object.entries(map || {})) {
        if (k >= start && k <= end) total += typeof v === 'number' ? v : 0;
      }
      return total;
    };

    const gaSpendPrev = sumMapInRange(googleTraffic.gaSpendByDate || {}, prevFromISO, prevToISO);
    const gaLeadsPrev = sumMapInRange(googleTraffic.gaConvByDate || {}, prevFromISO, prevToISO);
    const fbSpendPrevRaw = sumMapInRange(fbSpendRaw.fbSpendByDate || {}, prevFromISO, prevToISO);
    const fbSpendPrev = fbSpendPrevRaw > 0 ? fbSpendPrevRaw : (fbFallbackDailySpend * days);
    const fbLeadsPrev = sumMapInRange(fbLeadsByDate, prevFromISO, prevToISO);

    const streakFbLeads: StreakLeadRow[] = Array.isArray(streakFb) ? streakFb : [];
    const streakGoogleLeads: StreakLeadRow[] = Array.isArray(streakGoogle) ? streakGoogle : [];

    const filterLeads = (leads: StreakLeadRow[]) =>
      leads.filter((l) => {
        if (!l.inquiry_date) return false;
        const d = new Date(l.inquiry_date);
        return d >= prevStart && d <= prevEnd;
      });

    const fbPrevLeadsFiltered = filterLeads(streakFbLeads);
    const googlePrevLeadsFiltered = filterLeads(streakGoogleLeads);
    const allPrevLeads = [...fbPrevLeadsFiltered, ...googlePrevLeadsFiltered];

    const fbQualityPrev = fbPrevLeadsFiltered.filter((l) => l.ai_score >= 50).length;
    const googleQualityPrev = googlePrevLeadsFiltered.filter((l) => l.ai_score >= 50).length;
    const qualityPrevTotal = fbQualityPrev + googleQualityPrev;
    const aiScoresPrev = allPrevLeads.map((l) => l.ai_score).filter((s) => s > 0);
    const avgAiPrev = aiScoresPrev.length
      ? Math.round((aiScoresPrev.reduce((a, b) => a + b, 0) / aiScoresPrev.length) * 10) / 10
      : 0;

    previousPeriod = {
      totalSpend: gaSpendPrev + fbSpendPrev,
      fbSpend: fbSpendPrev,
      googleSpend: gaSpendPrev,
      totalLeads: gaLeadsPrev + fbLeadsPrev,
      fbLeads: fbLeadsPrev,
      googleLeads: gaLeadsPrev,
      qualityLeads: qualityPrevTotal,
      fbQualityLeads: fbQualityPrev,
      googleQualityLeads: googleQualityPrev,
      avgAiScore: avgAiPrev
    };
  }

  const result: OverviewDataResult = {
    kpis: {
      revenueWon: revenueTotal,
      wonDeals,
      winRate,
      avgDealSize,
      spend: spendTotal,
      leads: totalLeads,
      sql,
      cac,
      roas,
      lpViews: lpViewsTotal
    },
    range,
    trendPoints,
    facebookSummary: fbSummaryData || undefined,
    googleSummary: {
      spend: gaSpendInWindow,
      clicks: gaClicksInWindow,
      leads: gaLeadsInWindow,
      cpl: gaLeadsInWindow > 0 ? gaSpendInWindow / gaLeadsInWindow : 0
    },
    previousPeriod,
    __debug: {
      range,
      contacts: contacts.__debug,
      deals: deals.__debug,
      traffic: {
        google: {
          ok: googleTraffic.ok,
          tab: googleTraffic.tab,
          found: googleTraffic.found,
          dateRange: googleTraffic.dateRange,
          rows: googleTraffic.rows,
          windowSpend: gaSpendInWindow,
          error: googleTraffic.error
        },
        facebook: {
          ok: fbSpendRaw.ok,
          tab: 'fb_ads_raw',
          found: fbSpendRaw.found,
          dateRange: fbSpendRaw.dateRange,
          rows: fbSpendRaw.rows,
          windowSpend: fbSpendInWindow,
          error: fbSpendRaw.error
        },
        fbLpViews: {
          ok: fbTrafficEnriched.ok,
          rows: fbTrafficEnriched.rows,
          windowLpViews: fbLpViewsInWindow
        }
      },
      totalsFromSeries: {
        spendTotal: spendTotalSeries,
        lpViewsTotal,
        revenueTotal,
        gaSpendInWindow,
        fbSpendInWindow,
          gaLeadsInWindow,
        gaClicksInWindow,
        fbLpViewsInWindow
      },
      totals: {
        spend: spendTotal,
        revenue: revenueTotal,
        lpViews: lpViewsTotal,
        leads: totalLeads,
        sql,
        wonDeals
      }
    }
  };

  console.log('previousPeriod:', previousPeriod);
  console.log('DEBUG previousPeriod:', {
    shouldCalcPrev,
    days,
    previousPeriod,
    fbSpendByDate: Object.keys(fbSpendRaw.fbSpendByDate || {}).length,
    gaSpendByDate: Object.keys(googleTraffic.gaSpendByDate || {}).length,
    fbLeadsByDate: Object.keys(fbLeadsByDate || {}).length
  });

  // Compute Facebook summary (30d window anchored to max date in tabs)
  const headerMap = (rows: any[][]) => {
    if (!rows?.length) return [];
    const [head, ...rest] = rows;
    const keys = head.map((h) =>
      String(h || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^\w]/g, '_'),
    );
    return rest.map((r) => {
      const o: any = {};
      keys.forEach((k, i) => (o[k] = r[i]));
      return o;
    });
  };

  if (!result.facebookSummary && fbRawTab.headers.length && fbEnrichedTab.headers.length) {
    const rawRows = headerMap([fbRawTab.headers, ...fbRawTab.rows]);
    const enrichedRows = headerMap([fbEnrichedTab.headers, ...fbEnrichedTab.rows]);
    if (process.env.NODE_ENV !== 'production') {
      console.log('fb_ads_raw first row:', rawRows[0]);
      console.log('fb_ads_enriched first row:', enrichedRows[0]);
    }
    result.facebookSummary = computeFacebookSummary(rawRows as any, enrichedRows as any);
  }

  console.log('[overview-data] Result KPIs:', result.kpis);
  console.log('[overview-data] Trend points:', trendPoints.length, 'days');
  console.log(`[overview-data] SPEND BREAKDOWN: Google (daily): €${gaSpendInWindow.toFixed(2)} + Facebook (fb_ads_raw): €${fbSpendInWindow.toFixed(2)} = Total: €${spendTotal.toFixed(2)}`);

  return result;
}
