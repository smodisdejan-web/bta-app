// src/app/api/sheet-tabs/route.ts
//
// The three legacy Google Ads tabs (`daily`, `searchTerms`, `adGroups`) that SettingsProvider
// loads for the WHOLE app, served once from the server instead of three times from every browser.
//
// WHY (2026-09-23). SettingsProvider lives in the root layout, so those three `?tab=` requests
// went out on EVERY page — including the Overview, which does not read a single one of them.
// Three of the eleven Apps Script executions the Overview used to trigger were pure overhead
// against a web app that allows ~30 at a time. Measured live: 439 + 968 + 1224 rows, ~5 s.
//
// It returns exactly what fetchAllTabsData() returns — same fetch, same parsers, same objects —
// so nothing downstream (/insights, /terms, /adgroups, the campaign picker) sees a different
// shape. Only who makes the call changed.
//
// Two caches: a 10-minute module memo with in-flight dedup (so a warm instance answers in
// microseconds and concurrent callers share one Apps Script execution) and the same
// `s-maxage=600, stale-while-revalidate=1800` edge header /api/overview-data uses. ?nocache=1
// bypasses both. POST /api/cache/clear does NOT touch this memo — it is a different reader
// (fetchJson, not the shared tab cache); it expires on its own within ten minutes.
//
// The tabs are read as a unit and returned as a unit: a partial failure already degrades to an
// empty array inside fetchAllTabsData(), which is the pre-existing behaviour for these three and
// is not changed here.

import { NextResponse } from 'next/server'
import { DEFAULT_WEB_APP_URL, getSheetsUrl } from '@/lib/config'
import { fetchAllTabsData } from '@/lib/sheetsData'
import type { TabData } from '@/lib/types'

export const maxDuration = 120
export const fetchCache = 'default-no-store'

const TTL_MS = 10 * 60 * 1000
let memo: { at: number; data: TabData } | null = null
let inflight: Promise<TabData> | null = null

async function load(bypass: boolean): Promise<TabData> {
  if (!bypass && memo && Date.now() - memo.at < TTL_MS) return memo.data
  if (!bypass && inflight) return inflight
  const url = getSheetsUrl() || DEFAULT_WEB_APP_URL
  const p = fetchAllTabsData(url)
    .then((data) => {
      memo = { at: Date.now(), data }
      inflight = null
      return data
    })
    .catch((e) => {
      inflight = null
      if (memo) {
        console.warn('[sheet-tabs] refresh failed, serving stale', (e as Error).message)
        return memo.data
      }
      throw e
    })
  if (!bypass) inflight = p
  return p
}

export async function GET(request: Request) {
  const nocache = new URL(request.url).searchParams.get('nocache') === '1'
  try {
    const data = await load(nocache)
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': nocache ? 'no-store' : 'public, s-maxage=600, stale-while-revalidate=1800'
      }
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
