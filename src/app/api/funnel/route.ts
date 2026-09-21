import { NextResponse } from 'next/server'
import {
  loadBusinessFunnel,
  resolveRange,
  CAMPAIGNS,
  RANGE_KEYS,
  UMBRELLA_ORDER,
  type Channel,
} from '@/lib/business-funnel'

// NB: deliberately NOT `dynamic = 'force-dynamic'` — that makes Next stamp
// `max-age=0, must-revalidate` over our Cache-Control. The handler reads request.url, so
// it is dynamic regardless, and our own s-maxage survives to the CDN.
// GA4 (32 MB) + fb_ads_raw (5 MB) on a cold lambda — give it room; warm instances then hit
// the module-level 15-min cache inside lib/business-funnel.ts.
export const maxDuration = 300
export const fetchCache = 'default-no-store'

// GET /api/funnel?start=YYYY-MM-DD&end=YYYY-MM-DD[&campaign=slug][&channel=meta|google]
// GET /api/funnel?range=3m|90d|this_month|last_month|ytd[&campaign=…][&channel=…]
//
// Business Health Funnel for the Goolets Content Portal. One master funnel + 15 umbrella
// drill-downs, 100% live. Every step uses the SAME date range; anything that cannot be
// computed from a real source is null — never a placeholder number.
//
// `range` (2026-09-09): a named window, resolved server-side in Europe/Ljubljana time.
//   3m          the 1st of the month three months back → today (2026-09-09 ⇒ 2026-06-01…today)
//   90d         alias of 3m, kept so old links keep working
//   this_month  1st of the current month → today
//   last_month  the whole previous month
//   ytd         1 January → today
//   (omitted)   start/end are used verbatim, meta.range.requested = "custom"
// The response always says which key was asked for and which was used:
// meta.range = { requested, effective, from, to }.
//
// The 15 umbrellas (see lib/business-funnel.ts for the exact platform campaign names that
// must land in each), in the explicit first-match order the fallback regexes are applied in:
//
//   asset       ASSET / RareOps — every campaign containing "ASSET" or "RareOps".
//               aiScoreInflated: master QL excludes it.
//   dobrik      David Dobrik (Meta + Google YouTube)
//   matchmaker  Yacht Matchmaker lead magnet — nonKpi (metric is complete_registration)
//   boost       BOOST / JOB POST / personal-brand boosts — nonKpi
//   youtube     All - YouTube video views + subscriptions (Google) — nonKpi
//   brand       All - Search - Brand Campaign (Google)
//   pmax        Performance Max (Google, incl. the live "Perfromance" typo)
//   clg         Croatia Luxury Gulet
//   earlybook   Early Booking 2027 + CORE 7 Social Proof
//   turkey      Turkey (Belgin / Tosca / Landing Turkey / Search - Turkey - EN / YT RMK)
//   caribbean   Caribbean / Oguz Khan (Meta LP A / LP B / Warm + Caribbean Search & YT RMK)
//   dalmatincki Last minute Dalmatinčki (Julij campaigns, Sail Smarter, Nocturno, Dalmatino)
//   smarter     Alessandro / The Smarter Way
//   bofu        BOFU / Landing (Attainable Luxury, Landing Gulets, Unmatched Value)
//   croatia     Croatia generic / Last minute — the generic bucket, matched LAST
//
// Exact campaign names always win over the regexes, so the order can never move a known
// campaign into the wrong umbrella. Umbrellas are mutually exclusive by construction and
// umbrellas + unattributed = master (see campaignMembership).
//
// Google leads are attributed by Streak SOURCE DETAIL (= the Google campaign name), Facebook
// leads by SOURCE PLACEMENT resolved through utm_mapping first (Dejan's confirmed table) and
// the placement matchers second.
//
// `channel` (optional, composable with `campaign`): omit for all four channels.
//   meta     the Meta feeds (fb_daily_api + fb_ads_api)
//   google   daily_api
//   bing     bing_ads_api      — FLAT, added 2026-09-14 (Microsoft Advertising, 12-week test)
//   chatgpt  chatgpt_ads_api   — FLAT, added 2026-09-14 (OpenAI Ads Manager, oCPC live 14.9.)
// Leads + QL split on Streak: SOURCE DETAIL FIRST (`ms - `/`ms_` = bing, `chatgpt…` = chatgpt),
// platform second — Streak tags Bing and ChatGPT as PAID_SEARCH, i.e. platform "google", so
// reading platform alone counted both inside Paid Google. Bookings split on bookings_api.source
// (fb_landing + fb_lead = meta, plus `bing` / `chatgpt` written by the brain sync scripts), with
// the campaign name as the fallback signal (`MS - …` = Bing, `CGA …`/`chatgpt-…` = ChatGPT) for
// rows hand-typed into the flat bookings tab. PHASE 2 (2026-09-14): Bing and ChatGPT bookings,
// revenue and ROAS are MEASURED — a 0 means none closed, where phase 1 could only say "unknown".
//
// FLAT means: no umbrella, no campaign membership, no orphan spend. Bing/ChatGPT spend is inside
// the master total (and inside campaignMembership.unattributed.spend) but never passes through
// adSlug(), so "umbrellas + unattributed = master" is unchanged.
//
// BACKWARD COMPATIBILITY: every existing key keeps its meaning and position. The two channels are
// ADDITIVE — two extra entries in steps[].channels (after google, before other) and two extra
// meta.coverage keys. `all` totals now include their spend, leads and QL, which is the point.

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 's-maxage=900, stale-while-revalidate',
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rangeParam = (searchParams.get('range') || '').trim().toLowerCase()
  const campaign = (searchParams.get('campaign') || 'master').trim().toLowerCase()
  const channelParam = (searchParams.get('channel') || '').trim().toLowerCase()
  const channel: Channel = (channelParam || 'all') as Channel

  if (rangeParam && !RANGE_KEYS.includes(rangeParam as any)) {
    return NextResponse.json(
      { error: `Unknown range "${rangeParam}"`, ranges: RANGE_KEYS },
      { status: 400, headers }
    )
  }

  const rawStart = searchParams.get('start') || ''
  const rawEnd = searchParams.get('end') || ''

  // A named range wins over start/end; without one, start/end are required as before.
  if (!rangeParam || rangeParam === 'custom') {
    if (!ISO.test(rawStart) || !ISO.test(rawEnd)) {
      return NextResponse.json(
        { error: 'start and end are required (format YYYY-MM-DD) unless range= is given', ranges: RANGE_KEYS },
        { status: 400, headers }
      )
    }
    if (rawStart > rawEnd) {
      return NextResponse.json({ error: 'start must be <= end' }, { status: 400, headers })
    }
  }

  const range = resolveRange(rangeParam, rawStart, rawEnd)

  if (campaign !== 'master' && !CAMPAIGNS.some((c) => c.slug === campaign)) {
    return NextResponse.json(
      { error: `Unknown campaign "${campaign}"`, campaigns: [...UMBRELLA_ORDER] },
      { status: 400, headers }
    )
  }

  if (!['all', 'meta', 'google', 'bing', 'chatgpt'].includes(channel)) {
    return NextResponse.json(
      { error: `Unknown channel "${channelParam}"`, channels: ['meta', 'google', 'bing', 'chatgpt'] },
      { status: 400, headers }
    )
  }

  try {
    const data = await loadBusinessFunnel({
      start: range.from,
      end: range.to,
      campaign,
      channel,
      range,
    })
    return NextResponse.json(data, { headers })
  } catch (err) {
    console.error('[funnel] failed', err)
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to build funnel' },
      { status: 500, headers }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...headers, 'Access-Control-Allow-Headers': 'Content-Type' },
  })
}
