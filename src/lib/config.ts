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
  FB_RAW: 'fb_ads_raw', // fallback only
} as const

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