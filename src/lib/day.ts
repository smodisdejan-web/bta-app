// src/lib/day.ts
//
// ONE day rule for the whole dashboard.
//
// This used to live inside lib/business-funnel.ts, which meant only /api/funnel obeyed it.
// Everything else bucketed dates with `toIsoDay()` (lib/sheetsData.ts — plain first-10-chars,
// no timezone shift) or with `new Date(value)` compared against local midnight, so a lead
// stamped 2026-09-08T22:14Z landed on 8. 9. in one page and on 9. 9. in the next. Moved out
// here so the funnel, the Overview and /api/freshness can import the SAME function instead of
// each keeping its own near-copy. business-funnel.ts re-exports it, so existing
// `import { toDay } from '@/lib/business-funnel'` call sites keep working unchanged.

/**
 * Normalise every date shape the feeds throw at us to YYYY-MM-DD (Europe/Ljubljana day).
 * fb_ads_raw stores `date_start` as the previous day at 22:00Z — the same +2h offset the
 * enriched tab already resolves into `date_iso`, so we resolve it identically here.
 */
export function toDay(v: any): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Google Sheets serial (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (s.includes('T')) {
    const d = new Date(s)
    if (Number.isNaN(+d)) return s.slice(0, 10)
    // 22:00Z / 23:00Z means "the next day, Ljubljana". +4h lands any such stamp on the
    // right calendar day without disturbing midnight-based stamps.
    return new Date(+d + 4 * 3600_000).toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return Number.isNaN(+d) ? '' : d.toISOString().slice(0, 10)
}
