/**
 * scripts/check-sheet-retry.ts
 *
 * Mocked-fetch check of the Apps Script retry policy in lib/sheetsData.ts and
 * lib/business-funnel.ts, added after the 2026-09-23 08:13 incident: Apps Script answered
 * HTTP 404 for `fb_ads_api` (a tab that exists) and /api/insights/funnel-ask returned a 500,
 * because the old loop gave up after 2,4 s.
 *
 * Asserts, for BOTH readers:
 *   404, 404, 200            → the data comes back (and it took two retries)
 *   {"error": …} on a 200    → throws IMMEDIATELY, exactly one fetch, no retry
 *   403                      → throws immediately (will not fix itself)
 *   network error, then 200  → the data comes back
 *
 *   npx tsx scripts/check-sheet-retry.ts
 */

import assert from 'node:assert'

process.env.SHEET_CACHE_TTL_MS = '0' // never answer from the cache during this check

const ROWS = [
  { date: '2026-09-01', campaign: 'X', spend: 1 },
  { date: '2026-09-02', campaign: 'X', spend: 2 }
]

type Step = { status: number; body?: any; text?: string; throws?: string }

let script: Step[] = []
let calls = 0

const realFetch = globalThis.fetch
globalThis.fetch = (async (_url: any) => {
  const step = script[Math.min(calls, script.length - 1)]
  calls++
  if (step.throws) throw new Error(step.throws)
  return {
    ok: step.status >= 200 && step.status < 300,
    status: step.status,
    statusText: String(step.status),
    json: async () => {
      if (step.text !== undefined) throw new SyntaxError('Unexpected token < in JSON')
      return step.body
    }
  } as any
}) as any

async function run(name: string, steps: Step[], fn: () => Promise<any>, expect: 'data' | 'throw') {
  script = steps
  calls = 0
  const t0 = Date.now()
  let outcome: 'data' | 'throw' = 'data'
  let result: any = null
  let err: any = null
  try {
    result = await fn()
  } catch (e) {
    outcome = 'throw'
    err = e
  }
  const ms = Date.now() - t0
  console.log(`${outcome === expect ? 'PASS' : 'FAIL'}  ${name}  (${calls} fetch, ${ms} ms)${err ? ` — ${(err as Error).message}` : ''}`)
  assert.strictEqual(outcome, expect, name)
  return { calls, result, err, ms }
}

;(async () => {
  const sheets = await import('../src/lib/sheetsData')
  const funnel: any = await import('../src/lib/business-funnel')
  // fetchRows is private; reached through the test hook exported next to it.
  const funnelRead = () => funnel.__fetchRowsForTests('bookings_api')

  console.log('— lib/sheetsData.fetchTabWithMeta —')

  let r = await run(
    '404, 404, 200 → data',
    [{ status: 404 }, { status: 404 }, { status: 200, body: ROWS }],
    () => sheets.fetchTabWithMeta('fb_ads_api', 'https://mock/exec', { bypassCache: true }),
    'data'
  )
  assert.strictEqual(r.calls, 3)
  assert.strictEqual(r.result.sheet.length, 3, 'header + 2 rows')
  assert.strictEqual(r.result.meta.error, null)
  assert.ok(r.ms >= 1000 && r.ms <= 12000, `backoff actually slept (${r.ms} ms)`)

  r = await run(
    '{"error"} body → no retry, reported as an error, never as rows',
    [{ status: 200, body: { error: 'Tab not found: nope' } }],
    () => sheets.fetchTabWithMeta('nope', 'https://mock/exec', { bypassCache: true }),
    'data' // fetchTabWithMeta reports it rather than throwing — the null IS the loud failure
  )
  assert.strictEqual(r.calls, 1, 'an {"error"} body must not be retried')
  assert.strictEqual(r.result.sheet, null, 'no rows')
  assert.match(r.result.meta.error, /Tab not found/)

  r = await run(
    '403 → immediate, no retry',
    [{ status: 403 }],
    () => sheets.fetchTabWithMeta('x', 'https://mock/exec', { bypassCache: true }),
    'data'
  )
  assert.strictEqual(r.calls, 1)
  assert.strictEqual(r.result.sheet, null)

  r = await run(
    'network error, then 200 → data',
    [{ status: 0, throws: 'fetch failed' }, { status: 200, body: ROWS }],
    () => sheets.fetchTabWithMeta('fb_ads_api', 'https://mock/exec', { bypassCache: true }),
    'data'
  )
  assert.strictEqual(r.calls, 2)
  assert.strictEqual(r.result.sheet.length, 3)

  r = await run(
    'HTML error page (non-JSON), then 200 → data',
    [{ status: 200, text: '<html>oops</html>' }, { status: 200, body: ROWS }],
    () => sheets.fetchTabWithMeta('fb_ads_api', 'https://mock/exec', { bypassCache: true }),
    'data'
  )
  assert.strictEqual(r.calls, 2)
  assert.strictEqual(r.result.sheet.length, 3)

  r = await run(
    '404 × 4 on a tab never read → exhausted, null + error (never [] )',
    [{ status: 404 }],
    () => sheets.fetchTabWithMeta('never_read_tab', 'https://mock/exec', { bypassCache: true }),
    'data'
  )
  assert.strictEqual(r.calls, 4, 'four attempts total')
  assert.strictEqual(r.result.sheet, null)
  assert.match(r.result.meta.error, /404/)

  r = await run(
    '404 × 4 on a tab WITH a cached copy → serve-stale (unchanged behaviour)',
    [{ status: 404 }],
    () => sheets.fetchTabWithMeta('fb_ads_api', 'https://mock/exec', { bypassCache: true }),
    'data'
  )
  assert.strictEqual(r.calls, 4)
  assert.strictEqual(r.result.meta.servedFrom, 'stale')
  assert.strictEqual(r.result.sheet.length, 3)

  console.log('\n— lib/business-funnel.fetchRows (via __fetchRowsForTests) —')

  r = await run('404, 404, 200 → data', [{ status: 404 }, { status: 404 }, { status: 200, body: ROWS }], funnelRead, 'data')
  assert.strictEqual(r.calls, 3)

  r = await run(
    '{"error"} body → throws immediately (fail-loud contract)',
    [{ status: 200, body: { error: 'Tab not found: bookings_api' } }],
    funnelRead,
    'throw'
  )
  assert.strictEqual(r.calls, 1, 'an {"error"} body must not be retried')
  assert.match((r.err as Error).message, /Tab not found/)

  r = await run('403 → throws immediately', [{ status: 403 }], funnelRead, 'throw')
  assert.strictEqual(r.calls, 1)

  r = await run('network error, then 200 → data', [{ status: 0, throws: 'ECONNRESET' }, { status: 200, body: ROWS }], funnelRead, 'data')
  assert.strictEqual(r.calls, 2)

  globalThis.fetch = realFetch
  console.log('\nALL RETRY CHECKS PASSED')
})().catch((e) => {
  console.error('\nFAILED:', e)
  process.exit(1)
})
