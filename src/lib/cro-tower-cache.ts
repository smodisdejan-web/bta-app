// src/lib/cro-tower-cache.ts
//
// L2 cache for the Web Funnel CRO tower: Next's Data Cache (unstable_cache), which on Vercel is
// shared by every lambda instance and survives cold starts. L1 stays the 15-minute in-process
// memo inside lib/cro-tower.ts.
//
// WHY (2026-09-23). The in-process caches only help the instance that built them. Every fresh
// Vercel instance paid the whole sheet read again (5 CRO tabs + the paid funnel's tabs, ~64 MB
// through Apps Script, 40-80 s; one review request hit the 300 s limit). With this layer one
// build per period per data day is shared by all instances; the daily /gm refresh clears it
// (POST /api/cache/clear → revalidateTag) and code/goolets/warm-cro-tower.sh refills it.
//
// Keys carry the data day (yesterday, Ljubljana) so a new day is a new key even without a clear.
// Size: a CroTowerResponse is ~20-60 KB (limit 2 MB per entry); a review is ~3 KB.
// Route handlers only: unstable_cache needs the Next request context, so scripts keep calling
// buildCroTower() directly.

import { unstable_cache, revalidateTag } from 'next/cache'
import { buildCroTower, type CroTowerResponse } from './cro-tower'
import { todayLjubljana } from './business-funnel'

export const CRO_CACHE_TAG = 'cro-tower'
const DAY_S = 24 * 60 * 60

const dataDay = () => new Date(Date.parse(`${todayLjubljana()}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const keyTag = (kind: string, period: string, anchor: string | null) => `${CRO_CACHE_TAG}:${kind}:${period}:${anchor || '-'}`

/** Expire now (not stale-while-revalidate): the next read rebuilds. */
export function expireCroTag(tag: string = CRO_CACHE_TAG) {
  revalidateTag(tag, { expire: 0 })
}

/**
 * The CroTowerResponse for a period, from the shared Data Cache when present.
 * nocache: rebuild from the sheets (bypassing L1 too), then overwrite the shared entry.
 */
export async function getCroTower(opts: { period: string; anchor?: string | null; nocache?: boolean }): Promise<CroTowerResponse> {
  const period = String(opts.period || 'month').toLowerCase()
  const anchor = opts.anchor || null
  const day = dataDay()
  const tag = keyTag('data', period, anchor)
  if (opts.nocache) {
    // Fresh build first (fills L1), then drop the shared entry so the read below stores it.
    await buildCroTower({ period, anchor, nocache: true })
    expireCroTag(tag)
  }
  const cached = unstable_cache(
    () => buildCroTower({ period, anchor }),
    ['cro-tower-v1', period, anchor || '', day],
    { tags: [CRO_CACHE_TAG, tag], revalidate: DAY_S }
  )
  return cached()
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
  const cached = unstable_cache(generate, ['cro-tower-review-v1', period, anchor || '', dataDay()], {
    tags: [CRO_CACHE_TAG, tag],
    revalidate: DAY_S,
  })
  return cached()
}
