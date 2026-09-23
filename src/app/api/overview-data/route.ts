// src/app/api/overview-data/route.ts
//
// ONE request for the whole Overview page.
//
// WHY (2026-09-23). `/` fired eight `?tab=` calls from the BROWSER straight at the Apps Script
// web app, plus /api/dashboard-totals (which re-reads four of the same tabs) and a POST to
// /api/insights/summary. Apps Script allows ~30 simultaneous executions and the fat tabs take
// 3-40 s each, so two people opening the page at once queued behind each other and the skeleton
// ("Preparing your insights...") stayed up for 50-150 s. The feeds behind those tabs are written
// once a day by /gm (Meta roughly weekly), so nothing is gained by reading them per viewer.
//
// This route reads every tab SERVER-SIDE through the shared 10-minute tab cache in
// lib/sheetsData.ts (in-flight dedup + serve-stale-on-error), and answers with
// `public, s-maxage=600, stale-while-revalidate=1800` so Vercel's edge hands the same build to
// every viewer and every lambda instance. With ?nocache=1 (the Refresh button) it bypasses both.
//
// IT COMPUTES NOTHING NEW. The tab arrays are mapped with the SAME mappers app/page.tsx used to
// run in the browser (lib/overview-payload.ts), and `apiTotals` is the /api/dashboard-totals
// answer built from the identical helpers. Every number the page prints is still computed in the
// page.
//
// NULL IS NOT ZERO. A tab that could not be read and has no stale copy comes back as `null` with
// `meta[tab].error` set — never `[]` dressed up as data. The page's coverage guards then render
// n/a. That rule is the whole point: on 2026-09-08 a wedged /api/dashboard-totals answered FB
// spend 0 and the Overview printed EUR 6,029.99 instead of EUR 20,526.69; on 2026-09-14 the same
// route answered Google spend 0 (a NUMBER, so `??` never fell through) and the Overview printed
// EUR 0,00 while daily_api held EUR 12,037.90.

import { NextResponse } from 'next/server'
import { DEFAULT_WEB_APP_URL, getSheetsUrl, SHEETS_TABS } from '@/lib/config'
import {
  fetchTabWithMeta,
  mapFbEnriched,
  mapStreakLeads,
  type BookingRecord,
  type SheetTabMeta
} from '@/lib/sheetsData'
import { unionStreakRows } from '@/lib/streak-leads'
import {
  mapDailyRows,
  mapFbSpendApiRows,
  type OverviewApiTotals,
  type OverviewLeadRow,
  type OverviewPayload
} from '@/lib/overview-payload'
import { fetchFacebookAds, calculateTotals } from '@/lib/facebook-ads'
import { fetchGoogleAds, calculateGoogleTotals } from '@/lib/google-ads'

// Cold lambda + eight Apps Script tabs, the biggest of which takes 40 s on its own.
export const maxDuration = 300
// Deliberately NOT `dynamic = 'force-dynamic'`: that makes Next stamp `max-age=0,
// must-revalidate` over our Cache-Control and the edge share disappears. The handler reads
// request.url, so it is dynamic anyway. Same reasoning as /api/funnel.
export const fetchCache = 'default-no-store'

const CACHE_HEADER = 'public, s-maxage=600, stale-while-revalidate=1800'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** bookings_api → BookingRecord, the same mapping fetchBookings() does (incl. the MONTH truncation
 *  of booking_date — "2026-09", never a day). Inlined here because fetchBookings() owns its own
 *  fetch and this route needs the per-tab meta. */
function mapBookings(sheet: any[][]): BookingRecord[] {
  if (!sheet || sheet.length < 2) return []
  const [header, ...rows] = sheet
  const colIndex = (name: string) =>
    header.findIndex((h: string) => String(h).toLowerCase() === name.toLowerCase())
  return rows.map((row: any[]) => ({
    inquiry_date: String(row[colIndex('inquiry_date')] || ''),
    booking_date: (() => {
      const str = String(row[colIndex('booking_date')] ?? '')
      if (str.includes('T')) {
        const date = new Date(str)
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      }
      return str.substring(0, 7)
    })(),
    source: String(row[colIndex('source')] || '') as BookingRecord['source'],
    campaign: String(row[colIndex('campaign')] || ''),
    status: String(row[colIndex('status')] || ''),
    rvc: Number(row[colIndex('rvc')]) || 0,
    vessel: String(row[colIndex('vessel')] || ''),
    destination: String(row[colIndex('destination')] || ''),
    client_country: String(row[colIndex('client_country')] || ''),
    client_email: String(row[colIndex('client_email')] || ''),
    ai_score: Number(row[colIndex('ai_score')]) || 0,
    notes: String(row[colIndex('notes')] || ''),
    landing_page: String(row[colIndex('landing_page')] ?? ''),
  }))
}

/** Only the five Streak columns the Overview reads — streak_full is the whole year. */
const slimLead = (l: {
  inquiry_date: string
  ai_score: number
  country: string
  source_detail: string
  platform: string
}): OverviewLeadRow => ({
  inquiry_date: l.inquiry_date,
  ai_score: l.ai_score,
  country: l.country,
  source_detail: l.source_detail,
  platform: l.platform
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const nocache = searchParams.get('nocache') === '1'

  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const rawStart = searchParams.get('start') || ''
  const rawEnd = searchParams.get('end') || ''
  // Default = the range the page opens with (This Month).
  const start = ISO.test(rawStart) ? rawStart : localISO(new Date(today.getFullYear(), today.getMonth(), 1))
  const end = ISO.test(rawEnd) ? rawEnd : localISO(today)

  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  console.log(`[overview-data] ${start}..${end} nocache=${nocache} sheet=${sheetUrl}`)

  const opts = { bypassCache: nocache }
  const meta: Record<string, SheetTabMeta> = {}
  const readFrom = async (tab: string, url: string) => {
    const r = await fetchTabWithMeta(tab, url, opts)
    meta[tab] = r.meta
    return r.sheet
  }
  const read = (tab: string) => readFrom(tab, sheetUrl)

  const [dailySheet, fbEnrichedSheet, fbApiSheet, bingSheet, chatgptSheet, streakFullSheet, streakSyncSheet, bookingsSheet] =
    await Promise.all([
      read(SHEETS_TABS.DAILY),
      read(SHEETS_TABS.FB_ENRICHED),
      read(SHEETS_TABS.FB_SPEND_DAILY),
      read(SHEETS_TABS.BING_DAILY),
      read(SHEETS_TABS.CHATGPT_DAILY),
      read(SHEETS_TABS.STREAK_FULL),
      read(SHEETS_TABS.STREAK_SYNC),
      // bookings_api is read from DEFAULT_WEB_APP_URL and nowhere else — that is what
      // fetchBookings() hard-codes, and this route must be byte-identical to what the browser
      // used to load.
      readFrom(SHEETS_TABS.BOOKINGS, DEFAULT_WEB_APP_URL)
    ])

  const daily = dailySheet ? mapDailyRows(dailySheet[0] || [], dailySheet.slice(1)) : null
  const bing = bingSheet ? mapDailyRows(bingSheet[0] || [], bingSheet.slice(1)) : null
  const chatgpt = chatgptSheet ? mapDailyRows(chatgptSheet[0] || [], chatgptSheet.slice(1)) : null
  const fbSpendApi = fbApiSheet ? mapFbSpendApiRows(fbApiSheet[0] || [], fbApiSheet.slice(1)) : null
  // fetchFbEnriched() falls back to the legacy fb_ads_raw tab when fb_ads_enriched comes back
  // empty. That fallback has not fired since the enriched feed still has (frozen) rows, but it is
  // part of what the browser used to do, so it is reproduced here — and only then, so the normal
  // path still costs eight Apps Script reads, not nine.
  let fbEnrichedSource = fbEnrichedSheet
  if (!fbEnrichedSheet || fbEnrichedSheet.length < 2) {
    console.warn('[overview-data] fb_ads_enriched empty — falling back to fb_ads_raw')
    fbEnrichedSource = await read(SHEETS_TABS.FB_RAW)
  }
  const fbEnriched = fbEnrichedSource ? mapFbEnriched(fbEnrichedSource) : null
  const bookings = bookingsSheet ? mapBookings(bookingsSheet) : null

  // streak_full ∪ streak_sync — the SAME union /api/funnel and /api/freshness count. Either side
  // missing degrades to the other (that is what unionStreakRows does); only both failing is null.
  const streakFull = streakFullSheet ? mapStreakLeads(streakFullSheet) : null
  const streakSync = streakSyncSheet ? mapStreakLeads(streakSyncSheet) : null
  const streakLeads =
    streakFull === null && streakSync === null
      ? null
      : unionStreakRows(streakFull || [], streakSync || []).map(slimLead)

  // /api/dashboard-totals, computed here from the SAME helpers and the SAME cached tabs
  // (fb_ads_enriched + streak_sync + fb_ads_api for FB, daily_api + streak_sync for Google), so
  // the client no longer opens a second round of Apps Script executions while these are in
  // flight — which is precisely the concurrency stall that produced the EUR 0 readings.
  let apiTotals: OverviewApiTotals | null = null
  try {
    const rangeStart = new Date(start)
    rangeStart.setHours(0, 0, 0, 0)
    const rangeEnd = new Date(end)
    rangeEnd.setHours(23, 59, 59, 999)
    const inRange = (d: string) => {
      if (!d) return false
      const t = new Date(d)
      return t >= rangeStart && t <= rangeEnd
    }
    const [fbData, gaData] = await Promise.all([fetchFacebookAds(), fetchGoogleAds()])
    const fbTotals = calculateTotals(fbData.filter((r) => inRange(r.date)))
    const gaTotals = calculateGoogleTotals(gaData.filter((r) => inRange(r.date)))
    apiTotals = {
      fb: fbTotals as any,
      google: gaTotals as any,
      combined: {
        leads: (fbTotals.fbFormLeads || 0) + (fbTotals.landingLeads || 0) + (gaTotals.conversions || 0),
        spend: (fbTotals.spend || 0) + (gaTotals.spend || 0)
      }
    }
  } catch (e) {
    // A dead fallback is a dead fallback: null, so the page keeps using the live tabs it has.
    console.warn('[overview-data] apiTotals unavailable', (e as Error).message)
    apiTotals = null
  }

  const payload: OverviewPayload = {
    range: { start, end },
    generatedAt: new Date().toISOString(),
    nocache,
    meta,
    google: daily,
    bing,
    chatgpt,
    fbSpendApi,
    fbEnriched,
    streakLeads,
    bookings,
    apiTotals
  }

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': nocache ? 'no-store' : CACHE_HEADER
    }
  })
}
