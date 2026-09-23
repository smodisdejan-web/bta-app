/**
 * scripts/verify-overview-data.ts
 *
 * Proves that /api/overview-data hands the Overview exactly the rows the browser used to fetch
 * for itself, and that every headline number on the page is unchanged to the cent.
 *
 *   BEFORE  the eight `?tab=` reads the client fired straight at the Apps Script web app,
 *           mapped with the same mappers the page used.
 *   AFTER   one GET /api/overview-data, mapped by the route.
 *
 * Both are then fed through the SAME compute() below, which mirrors app/page.tsx line for line.
 * Any difference is a real difference.
 *
 *   npx tsx scripts/verify-overview-data.ts [baseUrl] [start] [end]
 *
 * Run it after touching the route, the payload mappers, or the page's load effect.
 */

import { DEFAULT_WEB_APP_URL, SHEETS_TABS } from '../src/lib/config'
import { mapFbEnriched, mapStreakLeads, type BookingRecord, type FbEnrichedRow } from '../src/lib/sheetsData'
import { filterStreakByDay, leadChannelOf, unionStreakRows } from '../src/lib/streak-leads'
import { bookingChannelOf } from '../src/lib/booking-channel'
import {
  mapDailyRows,
  mapFbSpendApiRows,
  type DailyRow,
  type FbSpendApiRow,
  type OverviewLeadRow
} from '../src/lib/overview-payload'

const BASE = process.argv[2] || 'http://localhost:3117'
const COOKIE = 'ai_unlock=1'

type Bundle = {
  google: DailyRow[] | null
  bing: DailyRow[] | null
  chatgpt: DailyRow[] | null
  fbSpendApi: FbSpendApiRow[] | null
  fbEnriched: FbEnrichedRow[] | null
  streakLeads: OverviewLeadRow[] | null
  bookings: BookingRecord[] | null
  apiTotals: any
}

// ── BEFORE: the old client path, straight at Apps Script ─────────────────────

async function rawTab(tab: string, url = DEFAULT_WEB_APP_URL): Promise<any[][]> {
  const res = await fetch(`${url}?tab=${encodeURIComponent(tab)}`, { cache: 'no-store' })
  const data = await res.json()
  if (!Array.isArray(data)) return []
  if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) {
    const headers = Object.keys(data[0])
    return [headers, ...data.map((r: any) => headers.map((h) => r[h]))]
  }
  return data as any[][]
}

const slim = (l: any): OverviewLeadRow => ({
  inquiry_date: l.inquiry_date,
  ai_score: l.ai_score,
  country: l.country,
  source_detail: l.source_detail,
  platform: l.platform
})

function mapBookingsSheet(sheet: any[][]): BookingRecord[] {
  if (!sheet || sheet.length < 2) return []
  const [header, ...rows] = sheet
  const c = (n: string) => header.findIndex((h: any) => String(h).toLowerCase() === n.toLowerCase())
  return rows.map((row: any[]) => ({
    inquiry_date: String(row[c('inquiry_date')] || ''),
    booking_date: (() => {
      const str = String(row[c('booking_date')] ?? '')
      if (str.includes('T')) {
        const d = new Date(str)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      }
      return str.substring(0, 7)
    })(),
    source: String(row[c('source')] || '') as BookingRecord['source'],
    campaign: String(row[c('campaign')] || ''),
    status: String(row[c('status')] || ''),
    rvc: Number(row[c('rvc')]) || 0,
    vessel: String(row[c('vessel')] || ''),
    destination: String(row[c('destination')] || ''),
    client_country: String(row[c('client_country')] || ''),
    client_email: String(row[c('client_email')] || ''),
    ai_score: Number(row[c('ai_score')]) || 0,
    notes: String(row[c('notes')] || '')
  }))
}

async function loadBefore(start: string, end: string): Promise<Bundle> {
  const [daily, fbEnr, fbApi, bing, chatgpt, full, sync, bookings] = await Promise.all([
    rawTab(SHEETS_TABS.DAILY),
    rawTab(SHEETS_TABS.FB_ENRICHED),
    rawTab(SHEETS_TABS.FB_SPEND_DAILY),
    rawTab(SHEETS_TABS.BING_DAILY),
    rawTab(SHEETS_TABS.CHATGPT_DAILY),
    rawTab(SHEETS_TABS.STREAK_FULL),
    rawTab(SHEETS_TABS.STREAK_SYNC),
    rawTab(SHEETS_TABS.BOOKINGS)
  ])
  // The old client also called /api/dashboard-totals for the same window.
  const totalsRes = await fetch(`${BASE}/api/dashboard-totals?start=${start}&end=${end}`, {
    headers: { Cookie: COOKIE }
  })
  return {
    google: mapDailyRows(daily[0] || [], daily.slice(1)),
    bing: mapDailyRows(bing[0] || [], bing.slice(1)),
    chatgpt: mapDailyRows(chatgpt[0] || [], chatgpt.slice(1)),
    fbSpendApi: mapFbSpendApiRows(fbApi[0] || [], fbApi.slice(1)),
    fbEnriched: mapFbEnriched(fbEnr),
    streakLeads: unionStreakRows(mapStreakLeads(full), mapStreakLeads(sync)).map(slim),
    bookings: mapBookingsSheet(bookings),
    apiTotals: await totalsRes.json()
  }
}

async function loadAfter(start: string, end: string): Promise<Bundle> {
  const res = await fetch(`${BASE}/api/overview-data?start=${start}&end=${end}`, {
    headers: { Cookie: COOKIE }
  })
  const d = await res.json()
  return {
    google: d.google,
    bing: d.bing,
    chatgpt: d.chatgpt,
    fbSpendApi: d.fbSpendApi,
    fbEnriched: d.fbEnriched,
    streakLeads: d.streakLeads,
    bookings: d.bookings,
    apiTotals: d.apiTotals
  }
}

// ── compute(): app/page.tsx, faithfully ──────────────────────────────────────

const toLocalISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function compute(b: Bundle, startISO: string, endISO: string, wholeMonth: boolean) {
  const google = b.google ?? []
  const bing = b.bing ?? []
  const chatgpt = b.chatgpt ?? []
  const fbSpendApi = b.fbSpendApi ?? []
  const fbEnriched = b.fbEnriched ?? []
  const streakLeads = b.streakLeads ?? []
  const bookings = b.bookings ?? []
  const apiTotals = b.apiTotals

  const start = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T23:59:59.999`)

  const windowMonths = new Set<string>()
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) {
    windowMonths.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1)
  }

  const filteredBookings = bookings.filter((bk) => {
    const raw = String(bk.booking_date || '')
    if (!raw) return false
    const month = raw.includes('T') ? toLocalISODate(new Date(raw)).slice(0, 7) : raw.slice(0, 7)
    return windowMonths.has(month)
  })

  let maxMonth = ''
  for (const bk of bookings) {
    const raw = String(bk.booking_date || '')
    if (!raw) continue
    const m = raw.includes('T') ? toLocalISODate(new Date(raw)).slice(0, 7) : raw.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(m) && m > maxMonth) maxMonth = m
  }
  const lastWindowMonth = Array.from(windowMonths).sort().pop() || ''
  const bookingsFeedState = !bookings.length || !maxMonth ? 'missing' : maxMonth >= lastWindowMonth ? 'live' : 'stale'

  const leadsFiltered = filterStreakByDay(streakLeads, startISO, endISO)
  const byChannel = (ch: string) => leadsFiltered.filter((l) => leadChannelOf(l) === ch)
  const qualityCount = (list: OverviewLeadRow[]) => list.filter((l) => l.ai_score >= 50).length
  const avgAiScore = (list: OverviewLeadRow[]) => {
    const s = list.map((l) => l.ai_score).filter((x) => x > 0)
    return s.length ? Math.round((s.reduce((a, c) => a + c, 0) / s.length) * 10) / 10 : 0
  }

  const fbEnrichedFiltered = fbEnriched.filter((r: any) => {
    const d = new Date(r.date_iso || r.date_start)
    return r.date_iso && d >= start && d <= end
  })
  const inDay = (rows: DailyRow[]) => rows.filter((r) => { const d = new Date(r.date); return d >= start && d <= end })
  const googleF = inDay(google)
  const bingF = inDay(bing)
  const chatgptF = inDay(chatgpt)

  const bingSpendTotal = bingF.length ? bingF.reduce((s, r) => s + (r.cost || 0), 0) : null
  const chatgptSpendTotal = chatgptF.length ? chatgptF.reduce((s, r) => s + (r.cost || 0), 0) : null

  const fbSpend = fbEnrichedFiltered.reduce((s, r: any) => s + (r.spend || 0), 0)
  let fbApiTotal = 0
  let fbApiCovered = false
  for (const r of fbSpendApi) {
    if (r.date >= startISO && r.date <= endISO) { fbApiTotal += r.spend; fbApiCovered = true }
  }
  const fbLpViews = fbEnrichedFiltered.reduce((s, r: any) => s + (r.lp_views || 0), 0)

  let fbMax = ''
  for (const r of fbEnriched as any[]) {
    const d = String(r.date_iso || r.date_start || '').slice(0, 10)
    if (d && d > fbMax) fbMax = d
  }
  const lagDay = new Date(end); lagDay.setDate(lagDay.getDate() - 1)
  const fbEnrichedCoversWindow = !!fbEnriched.length && !!fbMax && fbMax >= toLocalISODate(lagDay)

  let gMax = ''
  for (const r of google) { const d = String(r.date || '').slice(0, 10); if (d && d > gMax) gMax = d }
  const googleFeedCoversWindow = !!google.length && !!gMax && gMax >= toLocalISODate(lagDay)

  const googleSpend = googleF.reduce((s, r) => s + (r.cost || 0), 0)
  const googleClicks = googleF.reduce((s, r) => s + (r.clicks || 0), 0)
  const googleConversions = googleF.reduce((s, r) => s + (r.conv || 0), 0)
  const googleFeedHasRows = googleF.length > 0
  const googleSpendFinal = googleFeedHasRows ? googleSpend : apiTotals?.google?.spend ?? googleSpend
  const googleClicksFinal = googleFeedHasRows ? googleClicks : apiTotals?.google?.clicks ?? googleClicks

  const fbSpendFinal = fbApiCovered ? fbApiTotal : apiTotals?.fb?.spend ?? fbSpend
  const totalSpend = fbSpendFinal + googleSpendFinal + (bingSpendTotal ?? 0) + (chatgptSpendTotal ?? 0)
  const totalLeads = leadsFiltered.length
  const totalQuality = qualityCount(leadsFiltered)
  const revenue = filteredBookings.reduce((s, bk) => s + (bk.rvc || 0), 0)
  const lpViews = fbEnrichedCoversWindow ? fbLpViews + googleClicksFinal : null

  const cac = totalQuality > 0 ? totalSpend / totalQuality : 0
  const roas = totalSpend > 0 ? revenue / totalSpend : 0
  const roasDisplay = wholeMonth && totalSpend > 0 && bookingsFeedState === 'live' ? roas : null
  const qlRate = totalLeads <= 0 || totalQuality > totalLeads ? null : (totalQuality / totalLeads) * 100

  const chan = (ch: string, spend: number | null) => {
    const leads = byChannel(ch)
    const q = qualityCount(leads)
    const bks = filteredBookings.filter((bk) => bookingChannelOf(bk) === ch)
    const rev = bks.reduce((s, bk) => s + (bk.rvc || 0), 0)
    return {
      spend,
      leads: leads.length,
      quality: q,
      cpql: spend != null && q > 0 ? spend / q : null,
      bookings: bks.length,
      revenue: rev
    }
  }

  const markets = new Map<string, { revenue: number; bookings: number; ql: number }>()
  const norm = (c: string) => String(c || 'Unknown').trim() || 'Unknown'
  filteredBookings.forEach((bk) => {
    const k = norm(bk.client_country)
    const e = markets.get(k) || { revenue: 0, bookings: 0, ql: 0 }
    e.revenue += bk.rvc || 0; e.bookings += 1; markets.set(k, e)
  })
  leadsFiltered.filter((l) => l.ai_score >= 50).forEach((l) => {
    const k = norm(l.country)
    const e = markets.get(k) || { revenue: 0, bookings: 0, ql: 0 }
    e.ql += 1; markets.set(k, e)
  })

  return {
    totalSpend, fbSpendFinal, googleSpendFinal, bingSpendTotal, chatgptSpendTotal,
    totalLeads, totalQuality, qlRate, avgAi: avgAiScore(leadsFiltered),
    platformLeads: apiTotals?.combined?.leads ?? 0,
    bookings: filteredBookings.length, revenue, cac, roasDisplay, lpViews,
    bookingsFeedState, fbEnrichedCoversWindow, googleFeedCoversWindow,
    googlePlatformLeads: googleFeedHasRows ? Math.round(googleConversions) : Math.round(apiTotals?.google?.conversions ?? 0),
    meta: chan('meta', fbSpendFinal), google: chan('google', googleSpendFinal),
    bing: chan('bing', bingSpendTotal), chatgpt: chan('chatgpt', chatgptSpendTotal),
    topMarkets: Array.from(markets.entries())
      .map(([country, d]) => ({ country, ...d }))
      .filter((m) => m.revenue > 0 || m.ql > 0 || m.bookings > 0)
      .sort((a, c) => c.revenue - a.revenue).slice(0, 5)
  }
}

// ── runner ───────────────────────────────────────────────────────────────────

function diff(a: any, b: any, path = ''): string[] {
  if (a === b) return []
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-6 ? [] : [`${path}: ${a} → ${b}`]
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return Array.from(keys).flatMap((k) => diff(a[k], b[k], path ? `${path}.${k}` : k))
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`]
}

async function run(start: string, end: string, wholeMonth: boolean) {
  const before = await loadBefore(start, end)
  const after = await loadAfter(start, end)

  console.log(`\n=== ${start} .. ${end} (wholeMonth=${wholeMonth}) ===`)
  for (const k of ['google', 'bing', 'chatgpt', 'fbSpendApi', 'fbEnriched', 'streakLeads', 'bookings'] as const) {
    const a = (before as any)[k]?.length ?? null
    const c = (after as any)[k]?.length ?? null
    console.log(`rows ${k.padEnd(12)} before=${a} after=${c} ${a === c ? 'OK' : 'MISMATCH'}`)
  }

  const bk = compute(before, start, end, wholeMonth)
  const ak = compute(after, start, end, wholeMonth)
  console.log(JSON.stringify(ak, null, 2))
  const d = diff(bk, ak)
  console.log(d.length ? `DIFFS (${d.length}):\n  ${d.join('\n  ')}` : 'NO DIFFERENCES')
  return d.length
}

;(async () => {
  const s = process.argv[3]
  const e = process.argv[4]
  let bad = 0
  if (s && e) bad += await run(s, e, false)
  else {
    bad += await run('2026-09-01', '2026-09-22', false)
    const today = toLocalISODate(new Date())
    bad += await run(today.slice(0, 7) + '-01', today, true)
  }
  process.exit(bad ? 1 : 0)
})()
