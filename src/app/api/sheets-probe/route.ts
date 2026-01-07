// src/app/api/sheets-probe/route.ts
import { NextResponse } from 'next/server';
import { requireSheetsUrl } from '@/lib/config';
import { normalizeHeaders, pickIdx, toNumberEUorUS, toIsoDay, sumInto } from '@/lib/sheetsData';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab') || '';
  // Optional date window for filtered analysis
  const fromDate = searchParams.get('from') || undefined; // YYYY-MM-DD
  const toDate = searchParams.get('to') || undefined; // YYYY-MM-DD

  let sheetsUrl: string;
  try {
    sheetsUrl = requireSheetsUrl();
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: e.message || 'Sheets URL not configured' 
    }, { status: 500 });
  }

  const url = `${sheetsUrl}?tab=${encodeURIComponent(tab)}&_ts=${Date.now()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();

    let json: any = null;
    let headers: string[] = [];
    let headersNorm: string[] = [];
    let sampleRows: any[] = [];
    let rowCount = 0;
    let rows2D: any[][] = [];

    if (res.ok) {
      try {
        json = JSON.parse(text);
        
        if (Array.isArray(json) && json.length > 0) {
          // If array of objects, extract headers from first object
          if (typeof json[0] === 'object' && !Array.isArray(json[0])) {
            headers = Object.keys(json[0]);
            headersNorm = headers.map(h => String(h || '').toLowerCase().trim());
            sampleRows = json.slice(0, 3);
            rowCount = json.length;
            // Convert to 2D for analysis
            rows2D = [headers, ...json.map((r: any) => headers.map(h => r[h]))];
          } else if (Array.isArray(json[0])) {
            // If 2D array, first row is headers
            headers = (json[0] as any[]).map(h => String(h || ''));
            headersNorm = headers.map(h => h.toLowerCase().trim());
            sampleRows = json.slice(1, 4).map((row: any[]) => {
              const obj: Record<string, any> = {};
              headers.forEach((h, i) => {
                obj[h] = row[i];
              });
              return obj;
            });
            rowCount = json.length - 1; // Exclude header row
            rows2D = json;
          }
        }
      } catch {
        // Not JSON, ignore
      }
    }

    // Guard: drop dates more than 400 days from now
    const now = new Date();
    const maxValidDate = new Date(now.getTime() + 400 * 86400_000).toISOString().slice(0, 10);
    const minValidDate = new Date(now.getTime() - 400 * 86400_000).toISOString().slice(0, 10);

    // ========================================================================
    // fb_ads_enriched analysis (for LP views)
    // ========================================================================
    let fbEnrichedAnalysis: any = undefined;
    if (tab === 'fb_ads_enriched' && rows2D.length > 1) {
      const hdrsNorm = normalizeHeaders(rows2D[0]);
      const idxDate = pickIdx(hdrsNorm, ['date', 'date_iso', 'date_start']);
      const idxSpend = pickIdx(hdrsNorm, ['spend', 'cost']);
      const idxLp = pickIdx(hdrsNorm, ['lp_views', 'landing_page_views']);
      const idxCamp = pickIdx(hdrsNorm, ['campaign_name', 'campaign']);

      const spendByDate: Record<string, number> = {};
      const lpViewsByDate: Record<string, number> = {};
      let minDate: string | undefined;
      let maxDate: string | undefined;

      // Deduped by date+campaign
      const byKey: Record<string, { day: string; spend: number; lp: number }> = {};
      for (let i = 1; i < rows2D.length; i++) {
        const r = rows2D[i];
        const day = toIsoDay(idxDate !== -1 ? r[idxDate] : null);
        if (!day || day < minValidDate || day > maxValidDate) continue;
        
        const camp = (idxCamp !== -1 ? String(r[idxCamp] || '') : '').trim();
        const spend = toNumberEUorUS(idxSpend !== -1 ? r[idxSpend] : 0);
        const lp = toNumberEUorUS(idxLp !== -1 ? r[idxLp] : 0);

        if (!minDate || day < minDate) minDate = day;
        if (!maxDate || day > maxDate) maxDate = day;

        const key = `${day}__${camp}`;
        const cur = byKey[key] ?? { day, spend: 0, lp: 0 };
        cur.spend = Math.max(cur.spend, Number.isFinite(spend) ? spend : 0);
        cur.lp = Math.max(cur.lp, Number.isFinite(lp) ? lp : 0);
        byKey[key] = cur;
      }

      Object.values(byKey).forEach(({ day, spend, lp }) => {
        sumInto(spendByDate, day, spend);
        sumInto(lpViewsByDate, day, lp);
      });

      // Compute window totals if date range specified
      let windowSpend = 0;
      let windowLpViews = 0;
      if (fromDate && toDate) {
        const fromD = new Date(fromDate + 'T00:00:00Z');
        const toD = new Date(toDate + 'T00:00:00Z');
        for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
          const dayStr = d.toISOString().slice(0, 10);
          windowSpend += spendByDate[dayStr] ?? 0;
          windowLpViews += lpViewsByDate[dayStr] ?? 0;
        }
      }

      fbEnrichedAnalysis = {
        tab: 'fb_ads_enriched',
        found: { idxDate, idxSpend, idxLp, idxCamp },
        rowCount: rows2D.length - 1,
        dateRange: { min: minDate, max: maxDate },
        ...(fromDate && toDate && { 
          windowSpend,
          windowLpViews,
          windowRange: { from: fromDate, to: toDate }
        })
      };
    }

    // ========================================================================
    // fb_ads_raw analysis (for SPEND - primary source)
    // Uses deduplication by (date, campaign) - takes MAX spend per key
    // ========================================================================
    let fbRawAnalysis: any = undefined;
    if (tab === 'fb_ads_raw' && rows2D.length > 1) {
      const hdrsNorm = normalizeHeaders(rows2D[0]);
      // fb_ads_raw expected aliases (supports nested data.* columns)
      const idxDate = pickIdx(hdrsNorm, ['data.date_start', 'date', 'date_start', 'date_iso']);
      const idxSpend = pickIdx(hdrsNorm, ['data.spend', 'spend', 'amount_spent']);
      const idxCamp = pickIdx(hdrsNorm, ['data.campaign_name', 'campaign_name', 'campaign']);

      let minDate: string | undefined;
      let maxDate: string | undefined;
      let rawTotalSpend = 0;

      // Dedupe by (date, campaign) - take MAX spend per key
      const byKey: Record<string, { day: string; spend: number }> = {};

      for (let i = 1; i < rows2D.length; i++) {
        const r = rows2D[i];
        const day = toIsoDay(idxDate !== -1 ? r[idxDate] : null);
        if (!day || day < minValidDate || day > maxValidDate) continue;

        const spend = toNumberEUorUS(idxSpend !== -1 ? r[idxSpend] : 0);
        const campaign = idxCamp !== -1 ? String(r[idxCamp] || '').trim() : '';
        
        rawTotalSpend += spend;

        if (!minDate || day < minDate) minDate = day;
        if (!maxDate || day > maxDate) maxDate = day;

        const key = `${day}__${campaign}`;
        const cur = byKey[key] ?? { day, spend: 0 };
        cur.spend = Math.max(cur.spend, Number.isFinite(spend) ? spend : 0);
        byKey[key] = cur;
      }

      // Aggregate deduped values by day
      const spendByDate: Record<string, number> = {};
      let dedupTotalSpend = 0;
      Object.values(byKey).forEach(({ day, spend }) => {
        sumInto(spendByDate, day, spend);
        dedupTotalSpend += spend;
      });

      // Compute window totals if date range specified
      let windowSpend = 0;
      if (fromDate && toDate) {
        const fromD = new Date(fromDate + 'T00:00:00Z');
        const toD = new Date(toDate + 'T00:00:00Z');
        for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
          const dayStr = d.toISOString().slice(0, 10);
          windowSpend += spendByDate[dayStr] ?? 0;
        }
      }

      fbRawAnalysis = {
        tab: 'fb_ads_raw',
        found: { idxDate, idxSpend, idxCamp },
        rowCount: rows2D.length - 1,
        keysAfterDedupe: Object.keys(byKey).length,
        rawTotalSpend,
        dedupTotalSpend,
        dateRange: { min: minDate, max: maxDate },
        ...(fromDate && toDate && { 
          windowSpend,
          windowRange: { from: fromDate, to: toDate }
        })
      };
    }

    // ========================================================================
    // daily tab analysis (Google Ads - primary source for spend)
    // ========================================================================
    let dailyAnalysis: any = undefined;
    if (tab === 'daily' && rows2D.length > 1) {
      const hdrsNorm = normalizeHeaders(rows2D[0]);
      const idxDate = pickIdx(hdrsNorm, ['date', 'day', 'date_iso']);
      const idxCost = pickIdx(hdrsNorm, ['cost', 'spend']);
      const idxClicks = pickIdx(hdrsNorm, ['clicks']);

      const costByDate: Record<string, number> = {};
      const clicksByDate: Record<string, number> = {};
      let minDate: string | undefined;
      let maxDate: string | undefined;
      let totalCost = 0;
      let totalClicks = 0;

      for (let i = 1; i < rows2D.length; i++) {
        const r = rows2D[i];
        const day = toIsoDay(idxDate !== -1 ? r[idxDate] : null);
        if (!day || day < minValidDate || day > maxValidDate) continue;

        const cost = toNumberEUorUS(idxCost !== -1 ? r[idxCost] : 0);
        const clicks = toNumberEUorUS(idxClicks !== -1 ? r[idxClicks] : 0);

        if (!minDate || day < minDate) minDate = day;
        if (!maxDate || day > maxDate) maxDate = day;

        if (Number.isFinite(cost)) {
          sumInto(costByDate, day, cost);
          totalCost += cost;
        }
        if (Number.isFinite(clicks)) {
          sumInto(clicksByDate, day, clicks);
          totalClicks += clicks;
        }
      }

      // Compute window totals if date range specified
      let windowSpend = 0;
      let windowClicks = 0;
      if (fromDate && toDate) {
        const fromD = new Date(fromDate + 'T00:00:00Z');
        const toD = new Date(toDate + 'T00:00:00Z');
        for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
          const dayStr = d.toISOString().slice(0, 10);
          windowSpend += costByDate[dayStr] ?? 0;
          windowClicks += clicksByDate[dayStr] ?? 0;
        }
      }

      dailyAnalysis = {
        tab: 'daily',
        found: { idxDate, idxCost, idxClicks },
        rowCount: rows2D.length - 1,
        totalCost,
        totalClicks,
        dateRange: { min: minDate, max: maxDate },
        ...(fromDate && toDate && { 
          windowSpend,
          windowClicks,
          windowRange: { from: fromDate, to: toDate }
        })
      };
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bodySnippet: text.slice(0, 500),
      headers,
      headersNorm,
      sampleRows,
      rowCount,
      tab,
      url: sheetsUrl.slice(0, 60) + '...',
      ...(fbEnrichedAnalysis && { fbEnrichedAnalysis }),
      ...(fbRawAnalysis && { fbRawAnalysis }),
      ...(dailyAnalysis && { dailyAnalysis })
    });
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: String(e),
      tab,
      url: sheetsUrl.slice(0, 60) + '...'
    }, { status: 500 });
  }
}
