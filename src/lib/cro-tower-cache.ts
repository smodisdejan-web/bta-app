// src/lib/cro-tower-cache.ts
//
// L2 cache for the Web Funnel CRO tower: Next's Data Cache (unstable_cache), which on Vercel is
// shared by every lambda instance and survives cold starts AND deploys. L1 stays the 15-minute
// in-process memo inside lib/cro-tower.ts.
//
// WHY (2026-09-23). The in-process caches only help the instance that built them. Every fresh
// Vercel instance paid the whole sheet read again (5 CRO tabs + the paid funnel's tabs, ~64 MB
// through Apps Script, 40-80 s; one review request hit the 300 s limit).
//
// STALE-WHILE-REVALIDATE (2026-09-24). The first version put the data day in the key, so every
// midnight every entry was new and the first visitor of the day paid a cold build — on 24.9. Tadej
// opened the page at 07:45, pressed Refresh twice, and 3 parallel cold builds + the funnel tab
// pushed Apps Script past its 30-execution limit (HTTP 404s, 300 s timeouts). Now:
//   - the key has NO day in it: a reader always gets the last good build immediately
//   - POST /api/cache/clear marks the entries STALE (revalidateTag 'max'), it does not delete them;
//     the next read serves the stale copy and Next rebuilds in the background
//   - /api/cron/warm (Vercel cron 05:45 CET, also kicked off by cache/clear) force-rebuilds each
//     period one at a time so that background rebuild is normally never needed
//   - a forced rebuild (nocache) is the only synchronous cold path, used by the warm chain and by
//     the Refresh button when the cached build is older than REFRESH_MIN_AGE_MS
//
// Size: a CroTowerResponse is ~20-60 KB (limit 2 MB per entry); a review is ~3 KB.
// Route handlers only: unstable_cache needs the Next request context, so scripts keep calling
// buildCroTower() directly.

import { unstable_cache, revalidateTag } from 'next/cache'
import { buildCroTower, type CroTowerResponse } from './cro-tower'

export const CRO_CACHE_TAG = 'cro-tower'
const DAY_S = 24 * 60 * 60
const KEY_VERSION = 'cro-tower-v2' // v2 = no data day in the key (2026-09-24)

/** A Refresh click only rebuilds when the cached build is older than this. */
export const REFRESH_MIN_AGE_MS = 60 * 60 * 1000

const keyTag = (kind: string, period: string, anchor: string | null) => `${CRO_CACHE_TAG}:${kind}:${period}:${anchor || '-'}`

/** Hard expiry: the next read WAITS for a rebuild. Only for the forced-rebuild path below. */
export function expireCroTag(tag: string = CRO_CACHE_TAG) {
  revalidateTag(tag, { expire: 0 })
}

/** Soft expiry: entries are served stale while Next rebuilds them in the background. */
export function markCroStale(tag: string = CRO_CACHE_TAG) {
  revalidateTag(tag, 'max')
}

export function ageMs(generatedAt: string | undefined | null): number {
  const t = generatedAt ? Date.parse(generatedAt) : NaN
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY
}

/**
 * The CroTowerResponse for a period, from the shared Data Cache when present.
 * nocache: rebuild from the sheets (bypassing L1 too), then overwrite the shared entry.
 */
export async function getCroTower(opts: { period: string; anchor?: string | null; nocache?: boolean }): Promise<CroTowerResponse> {
  const period = String(opts.period || 'month').toLowerCase()
  const anchor = opts.anchor || null
  const tag = keyTag('data', period, anchor)
  if (opts.nocache) {
    // Fresh build first (fills L1), then drop the shared entry so the read below stores it.
    await buildCroTower({ period, anchor, nocache: true })
    expireCroTag(tag)
  }
  const cached = unstable_cache(
    () => buildCroTower({ period, anchor }),
    [KEY_VERSION, period, anchor || ''],
    { tags: [CRO_CACHE_TAG, tag], revalidate: DAY_S }
  )
  return cached()
}

/**
 * The Refresh button: rebuild only when the cached build is older than REFRESH_MIN_AGE_MS,
 * otherwise hand back the cached copy and say so (meta.refresh = 'fresh').
 */
export async function refreshCroTower(opts: { period: string; anchor?: string | null }): Promise<CroTowerResponse & { meta: CroTowerResponse['meta'] & { refresh: 'rebuilt' | 'fresh' } }> {
  const current = await getCroTower(opts)
  if (ageMs(current.meta.generatedAt) < REFRESH_MIN_AGE_MS) {
    return { ...current, meta: { ...current.meta, refresh: 'fresh' } }
  }
  const fresh = await getCroTower({ ...opts, nocache: true })
  return { ...fresh, meta: { ...fresh.meta, refresh: 'rebuilt' } }
}

/** Shared-cache wrapper for the AI review (generation is passed in to keep the model code in the route). */
export async function getCroReview<T>(
  opts: { period: string; anchor?: string | null; nocache?: boolean },
  generate: () => Promise<T>
): Promise<T> {
  const period = String(opts.period || 'month').toLowerCase()
  const anchor = opts.anchor || null
  const tag = keyTag('review', period, anchor)
  if (opts.nocache) expireCroTag(tag)
  const cached = unstable_cache(generate, [`${KEY_VERSION}-review`, period, anchor || ''], {
    tags: [CRO_CACHE_TAG, tag],
    revalidate: DAY_S,
  })
  return cached()
}
