// src/lib/config.ts
import type { MetricOptions } from './types'

// Goolets Brand Colors
export const COLORS = {
    primary: '#B39262', // Champagne Gold
    secondary: '#2D2D2D', // Graphite
    gold: '#B39262',
    graphite: '#121212',
    success: '#3D7C4D',
    warning: '#C7930A',
    error: '#B83C3C'
} as const

export const DEFAULT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycby4WR2b5WyZ7qKcJvNUtYjGQPPVpJzFWAnF5SyJntvtNGwGaob-hCu4hAdECHmnRVfn/exec'

export const SHEET_TABS = ['daily', 'searchTerms', 'adGroups'] as const
export type SheetTab = typeof SHEET_TABS[number]

export const SHEETS_TABS = {
  FB_ENRICHED: 'fb_ads_enriched',
  // CUTOVER 2026-08-17: daily FB spend now comes from Meta directly (code/facebook/sync-fb-ads-api.js).
  // The Mixed Analytics `fb_ads_raw` feed stopped emitting rows on 2026-08-08 and shifted timestamps
  // into its spend column, so /overview showed €23.898 of August FB spend against a true €36.282 —
  // ROAS read 3,31x when it was 2,52x. Keep FB_RAW as the emergency fallback only.
  FB_SPEND_DAILY: 'fb_ads_api',
  FB_RAW: 'fb_ads_raw', // legacy Mixed Analytics feed — stale + corrupted, fallback only
  FB_ADSETS_ENRICHED: 'fb_adsets_enriched',
  FB_ADS_LEVEL: 'fb_ads_level', // Faza 2: Meta reporting CSV → exact per-ad metrics (ql/cpql/zone pending UTM join)
  FB_AD_COPY: 'fb_ad_copy', // Faza 2: per-ad copy variations (body_asset/title_asset breakdown) + per-variation impr/spend/clicks
  TEST_TRACKER: 'test_tracker',
  TEST_VARIANTS: 'test_variants', // pre-aggregated form-split variants (code/hubspot/build-test-variants.js)
  STREAK_SYNC: 'streak_sync',
  STREAK_LEADS: 'streak_leads',
  STREAK_LEADS_GOOGLE: 'streak_leads_google',
  AD_GROUPS: 'adGroups',
  DAILY: 'daily_api', // CUTOVER 2026-06-15: Google Ads API tab (was Mixed Analytics 'daily'). Validated ±1% vs MA.

  BOOKINGS: 'bookings_api', // CUTOVER 2026-06-15: web-app feed for 'bookings' is stale (no June); bookings_api is a fresh mirror of the live tab (sync-goolets-bookings.js)
  HUBSPOT_CONTACTS: 'hubspot_contacts',
  GA4_LANDING_PAGES: 'ga4_landing_pages',
  GA4_AI_SESSIONS: 'ga4_ai_sessions', // AI-assistant sessions, split by hostName (code/ga4/sync-goolets-ai-sessions.js). Separate tab because ga4_landing_pages carries no host — see that script's header.
  GA4_HOST_SESSIONS: 'ga4_host_sessions', // ALL sessions per host × date — denominator for "how much of this site's traffic is AI".
  TURKEY_AVAILABILITY: 'turkey_availability',
  TURKEY_GOOGLE_CAMPAIGNS: 'turkey_google_campaigns',
  TURKEY_GOOGLE_TERMS: 'turkey_google_terms',
  UTM_MAPPING: 'utm_mapping', // Authoritative utm → campaign/adset/ad table (synced from Dejan's confirmed sheet). Join key for lead attribution.
} as const

// Sheets URL configuration with fallback support
export function getSheetsUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_SHEETS_URL || process.env.NEXT_PUBLIC_SHEET_API_URL;
  }
  // client:
  return process.env.NEXT_PUBLIC_SHEETS_URL || process.env.NEXT_PUBLIC_SHEET_API_URL;
}

export function requireSheetsUrl(): string {
  const url = getSheetsUrl();
  if (!url) throw new Error('Sheets URL missing. Set NEXT_PUBLIC_SHEETS_URL or NEXT_PUBLIC_SHEET_API_URL.');
  return url;
}

export interface TabConfig {
    name: SheetTab
    metrics: MetricOptions
}

export const TAB_CONFIGS: Record<SheetTab, TabConfig> = {
    daily: {
        name: 'daily',
        metrics: {
            impr: { label: 'Impr', format: (val: number) => val.toLocaleString() },
            clicks: { label: 'Clicks', format: (val: number) => val.toLocaleString() },
            cost: { label: 'Cost', format: (val: number) => `€${val.toFixed(2)}` },
            conv: { label: 'Conv', format: (val: number) => val.toFixed(1) },
            value: { label: 'Value', format: (val: number) => `€${val.toFixed(2)}` }
        }
    },
    searchTerms: {
        name: 'searchTerms',
        metrics: {
            impr: { label: 'Impr', format: (val: number) => val.toLocaleString() },
            clicks: { label: 'Clicks', format: (val: number) => val.toLocaleString() },
            cost: { label: 'Cost', format: (val: number) => `€${val.toFixed(2)}` },
            conv: { label: 'Conv', format: (val: number) => val.toFixed(1) },
            value: { label: 'Value', format: (val: number) => `€${val.toFixed(2)}` }
        }
    },
    adGroups: {
        name: 'adGroups',
        metrics: {
            impr: { label: 'Impr', format: (val: number) => val.toLocaleString() },
            clicks: { label: 'Clicks', format: (val: number) => val.toLocaleString() },
            cost: { label: 'Cost', format: (val: number) => `€${val.toFixed(2)}` },
            conv: { label: 'Conv', format: (val: number) => val.toFixed(1) },
            value: { label: 'Value', format: (val: number) => `€${val.toFixed(2)}` },
            cpc: { label: 'CPC', format: (val: number) => `€${val.toFixed(2)}` },
            ctr: { label: 'CTR', format: (val: number) => `${(val * 100).toFixed(1)}%` },
            convRate: { label: 'Conv Rate', format: (val: number) => `${(val * 100).toFixed(1)}%` },
            cpa: { label: 'CPA', format: (val: number) => `€${val.toFixed(2)}` },
            roas: { label: 'ROAS', format: (val: number) => val.toFixed(2) }
        }
    }
} 