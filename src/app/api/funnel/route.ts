import { NextResponse } from 'next/server'
import { loadBusinessFunnel, CAMPAIGNS, type Channel } from '@/lib/business-funnel'

// NB: deliberately NOT `dynamic = 'force-dynamic'` — that makes Next stamp
// `max-age=0, must-revalidate` over our Cache-Control. The handler reads request.url, so
// it is dynamic regardless, and our own s-maxage survives to the CDN.
// GA4 (27 MB) + fb_ads_raw (4 MB) on a cold lambda — give it room; warm instances then hit
// the module-level 15-min cache inside lib/business-funnel.ts.
export const maxDuration = 300
export const fetchCache = 'default-no-store'

// GET /api/funnel?start=YYYY-MM-DD&end=YYYY-MM-DD[&campaign=slug][&channel=meta|google]
//
// Business Health Funnel for the Goolets Content Portal. One master funnel + 6 campaign
// drill-downs, 100% live. Every step uses the SAME date range; anything that cannot be
// computed from a real source is null — never a placeholder number.
//
// Campaign → entity mapping (derived from the live entity names, 2026-08-06):
//
//   slug         FB campaign            Google campaign     Streak key                 GA4 landing page
//   ───────────────────────────────────────────────────────────────────────────────────────────────────
//   clg          /cro lux gulet/        /^clg\b/            cro-lux | clg              /luxury-yacht-charter-in-croatia
//   dalmatincki  /dalmatin|nocturno/    —                   /dalmatin/                 smart-luxury-sailing, sail-smarter,
//                                                                                      exclusive-seasonal-selection,
//                                                                                      dalmatino, nocturno, rare-opportunit
//   earlybook    /early booking/        —                   ^earlybook2027|^early-      /private-yacht-charters-in-croatia-2027
//                                                           booking
//   turkey       /turkey|tosca|belgin|  /turkey/            same token set              turkey|belgin|tosca|esma|arabella
//                 esma/
//   smarter      /the smarter way/      —                   ^alessandro_smarter        /alessandro-the-smarter-way
//   dobrik       /dobrik/               /dobrik/            ^dobrik                    /dobrik-*
//
// Google leads are attributed by Streak SOURCE DETAIL (= the Google campaign name, the only
// Google attribution key Streak carries); Facebook leads by SOURCE PLACEMENT (utm_content,
// whose suffix is the campaign token — the same convention lib/fuzzy-match.ts encodes).
//
// `channel` (optional, composable with `campaign`): omit for both channels — that path is
// unchanged. `meta` / `google` scope ads to fb_ads_raw / daily_api, leads+QL to
// streak_sync.platform and bookings to bookings_api.source (fb_landing + fb_lead = meta).
// LP views split on GA4 sessionSourceMedium (paid|cpc|ppc token, then platform), so a
// channel view shows that channel's PAID sessions — meta + google will NOT sum to the All
// view, whose gap is organic/direct/referral/email. cvrBasis:"clicks" remains only as the
// fallback for genuinely-null LP views (a campaign × channel combo with no lp matcher).

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 's-maxage=900, stale-while-revalidate',
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') || ''
  const end = searchParams.get('end') || ''
  const campaign = (searchParams.get('campaign') || 'master').trim().toLowerCase()
  const channelParam = (searchParams.get('channel') || '').trim().toLowerCase()
  const channel: Channel = (channelParam || 'all') as Channel

  if (!ISO.test(start) || !ISO.test(end)) {
    return NextResponse.json(
      { error: 'start and end are required, format YYYY-MM-DD' },
      { status: 400, headers }
    )
  }
  if (start > end) {
    return NextResponse.json({ error: 'start must be <= end' }, { status: 400, headers })
  }
  if (campaign !== 'master' && !CAMPAIGNS.some((c) => c.slug === campaign)) {
    return NextResponse.json(
      { error: `Unknown campaign "${campaign}"`, campaigns: CAMPAIGNS.map((c) => c.slug) },
      { status: 400, headers }
    )
  }

  if (!['all', 'meta', 'google'].includes(channel)) {
    return NextResponse.json(
      { error: `Unknown channel "${channelParam}"`, channels: ['meta', 'google'] },
      { status: 400, headers }
    )
  }

  try {
    const data = await loadBusinessFunnel({ start, end, campaign, channel })
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
