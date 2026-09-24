// src/lib/funnel-cache.ts
//
// L2 cache for /api/funnel (the portal's Business Health Funnel): Next's Data Cache, shared by
// every lambda instance and surviving cold starts and deploys. L1 stays the 15-minute per-tab
// memo inside lib/business-funnel.ts, the edge cache (s-maxage=600) stays in front.
//
// WHY (2026-09-24). Until now the funnel had no shared layer: after a quiet night the first portal
// visitor paid the full Apps Script round trip (GA4 32 MB + fb_ads_raw 5 MB, 20-60 s), and on
// 24.9. at 07:46 that call queued behind three parallel CRO tower cold builds and failed with
// Apps Script 404s. Same recipe as lib/cro-tower-cache.ts:
//   - key = from + to + campaign + channel, NOT the range name: the portal sends `start&end` for
//     This month / Last month / YTD and `range=3m` for 3 months, the cron sends range names, and
//     both must land on the same entry (the route re-stamps meta.range with what was asked)
//   - POST /api/cache/clear marks entries stale (served stale, rebuilt in the background)
//   - /api/cron/warm force-rebuilds the four portal ranges (master, all channels) one at a time
//   - ?nocache=1 rebuilds only when the cached build is older than REFRESH_MIN_AGE_MS
// A named range whose `to` is today gets a new key every day; the 05:45 cron warms today's.

import { unstable_cache, revalidateTag } from 'next/cache'
import { loadBusinessFunnel, resolveRange, type Channel, type ResolvedRange } from './business-funnel'

export const FUNNEL_CACHE_TAG = 'funnel'
const DAY_S = 24 * 60 * 60
const KEY_VERSION = 'funnel-v1'
export const REFRESH_MIN_AGE_MS = 60 * 60 * 1000

export type FunnelResponse = Awaited<ReturnType<typeof loadBusinessFunnel>>
export type FunnelOpts = { range: ResolvedRange; campaign: string; channel: Channel }

const keyTag = (o: FunnelOpts) => `${FUNNEL_CACHE_TAG}:${o.range.from}:${o.range.to}:${o.campaign}:${o.channel}`

export function markFunnelStale(tag: string = FUNNEL_CACHE_TAG) {
  revalidateTag(tag, 'max')
}

function ageMs(generatedAt: string | undefined | null): number {
  const t = generatedAt ? Date.parse(generatedAt) : NaN
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY
}

/** The funnel for a resolved range, from the shared Data Cache when present. */
export async function getFunnel(o: FunnelOpts, nocache = false): Promise<FunnelResponse> {
  const tag = keyTag(o)
  const cached = unstable_cache(
    () => loadBusinessFunnel({ start: o.range.from, end: o.range.to, campaign: o.campaign, channel: o.channel, range: o.range }),
    [KEY_VERSION, o.range.from, o.range.to, o.campaign, o.channel],
    { tags: [FUNNEL_CACHE_TAG, tag], revalidate: DAY_S }
  )
  if (!nocache) return cached()
  // Forced rebuild: only when the cached build is older than an hour (a Refresh click on a fresh
  // build just hands the fresh build back). Hard-expire the entry, then the read below rebuilds
  // it synchronously and stores it — one build, no parallel readers waiting on it.
  const current = await cached()
  if (ageMs((current as any)?.meta?.generatedAt) < REFRESH_MIN_AGE_MS) return current
  revalidateTag(tag, { expire: 0 })
  return cached()
}

/** Resolve a named range the way /api/funnel does (Europe/Ljubljana "today"). */
export function funnelOptsForRange(range: string, campaign = 'master', channel: Channel = 'all'): FunnelOpts {
  return { range: resolveRange(range, '', ''), campaign, channel }
}
