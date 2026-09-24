import { NextResponse } from 'next/server'
import { fetchSheet } from '@/lib/sheetsData'
import { DEFAULT_WEB_APP_URL, getSheetsUrl } from '@/lib/config'

export const dynamic = 'force-dynamic'

// Flat list of delivered FB ads (name + live metrics) for the Content Portal Content Bank
// "Live in ads" badge. Merges the fresh per-funnel tabs (fb_dalmatincki, fb_earlybook — include
// brand-new ads not yet in the 90d Mixed-Analytics feed) with fb_ads_level (everything else),
// deduped by ad_id (funnel tabs win). CORS-open so the portal (other origin) can fetch directly.

const TABS = ['fb_dalmatincki', 'fb_earlybook', 'fb_ads_level']
const TTL_MS = 10 * 60 * 1000
let cache: { at: number; data: unknown } | null = null
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data, { headers })
  const sheetUrl = getSheetsUrl() || DEFAULT_WEB_APP_URL
  try {
    const byId = new Map<string, any>()
    for (const tab of TABS) {
      let rows: any[][] = []
      try { rows = await fetchSheet({ sheetUrl, tab }) } catch { continue }
      if (!Array.isArray(rows) || rows.length < 2) continue
      const h = (rows[0] || []).map((x) => String(x).trim())
      const ci = (n: string) => h.indexOf(n)
      const I = {
        id: ci('ad_id'), name: ci('ad_name'), spend: ci('spend'), impressions: ci('impressions'),
        clicks: ci('clicks'), ctr: ci('ctr'), landing_lead: ci('landing_lead'), cpl: ci('cpl'),
      }
      if (I.id < 0 || I.name < 0) continue
      for (const r of rows.slice(1)) {
        const adId = String(r[I.id] || '')
        if (!adId || adId === '__campaign_totals__') continue
        if (byId.has(adId)) continue // first tab (funnel feeds) wins
        const spend = num(r[I.spend]), ll = num(r[I.landing_lead])
        byId.set(adId, {
          ad_id: adId,
          ad_name: String(r[I.name] || ''),
          spend,
          impressions: num(r[I.impressions]),
          clicks: num(r[I.clicks]),
          ctr: num(r[I.ctr]),
          landing_lead: ll,
          cpl: I.cpl >= 0 && r[I.cpl] !== '' && r[I.cpl] != null ? num(r[I.cpl]) : (ll ? spend / ll : 0),
        })
      }
    }
    // "Live" = delivered something. Drop zero-impression rows so paused/never-served ads don't badge.
    const ads = Array.from(byId.values()).filter((a) => a.impressions > 0)
    const data = { as_of: new Date().toISOString(), count: ads.length, ads }
    cache = { at: Date.now(), data }
    return NextResponse.json(data, { headers })
  } catch (err) {
    console.error('[live-ads] failed', err)
    if (cache) return NextResponse.json(cache.data, { headers })
    return NextResponse.json({ error: 'Failed to load live ads' }, { status: 500, headers })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': 'Content-Type' } })
}
