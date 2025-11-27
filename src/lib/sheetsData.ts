// src/lib/sheetsData.ts
import { AdMetric, Campaign, SearchTermMetric, TabData, AdGroupRecord } from './types'
import { SheetTab, TAB_CONFIGS, DEFAULT_WEB_APP_URL, SHEETS_TABS } from './config'

// Helper to fetch and parse SearchTerm data
async function fetchAndParseSearchTerms(sheetUrl: string): Promise<SearchTermMetric[]> {
  const tab: SheetTab = 'searchTerms';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    const response = await fetch(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}`);
    }
    const rawData = await response.json();
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }
    return rawData.map((row: any) => ({
      searchTerm: String(row['searchTerm'] || ''),
      keywordText: String(row['keywordText'] || ''),
      campaign: String(row['campaign'] || ''),
      adGroup: String(row['adGroup'] || ''),
      impr: Number(row['impr'] || 0),
      clicks: Number(row['clicks'] || 0),
      cost: Number(row['cost'] || 0),
      conv: Number(row['conv'] || 0),
      value: Number(row['value'] || 0),
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

// Helper to fetch and parse Daily (AdMetric) data
async function fetchAndParseDaily(sheetUrl: string): Promise<AdMetric[]> {
  const tab: SheetTab = 'daily';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    const response = await fetch(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}`);
    }
    const rawData = await response.json();
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }
    return rawData.map((row: any) => ({
      campaign: String(row['campaign'] || ''),
      campaignId: String(row['campaignId'] || ''),
      clicks: Number(row['clicks'] || 0),
      value: Number(row['value'] || 0),
      conv: Number(row['conv'] || 0),
      cost: Number(row['cost'] || 0),
      impr: Number(row['impr'] || 0),
      date: String(row['date'] || '')
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

// Helper to parse currency values (strip € and parse as number)
function parseCurrency(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[€$,]/g, '').trim();
    return parseFloat(cleaned) || 0;
  }
  return 0;
}

// Helper to parse percentage values (convert "31.4%" to 0.314)
function parsePercentage(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace('%', '').trim();
    const parsed = parseFloat(cleaned) || 0;
    return parsed / 100; // Convert to 0..1 range
  }
  return 0;
}

// Helper to parse date values (convert "YYYY-MM-DD" to Date)
function parseDate(value: any): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
  }
  return new Date();
}

// Helper to fetch and parse AdGroups data
async function fetchAndParseAdGroups(sheetUrl: string): Promise<AdGroupRecord[]> {
  const tab: SheetTab = 'adGroups';
  try {
    const urlWithTab = `${sheetUrl}?tab=${tab}`;
    const response = await fetch(urlWithTab);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for tab ${tab}`);
    }
    const rawData = await response.json();
    if (!Array.isArray(rawData)) {
      console.error(`Response is not an array for ${tab}:`, rawData);
      return [];
    }
    
    // Check for required headers and log warnings if missing
    const requiredHeaders = ['campaign', 'campaignId', 'adGroup', 'adGroupId', 'impr', 'clicks', 'value', 'conv', 'cost', 'date', 'cpc', 'ctr', 'convRate', 'cpa', 'roas'];
    if (rawData.length > 0) {
      const headers = Object.keys(rawData[0]);
      const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));
      if (missingHeaders.length > 0) {
        console.warn(`Missing headers in ${tab} data:`, missingHeaders);
      }
    }

    return rawData.map((row: any) => ({
      campaign: String(row['campaign'] || ''),
      campaignId: String(row['campaignId'] || ''),
      adGroup: String(row['adGroup'] || ''),
      adGroupId: String(row['adGroupId'] || ''),
      impr: Number(row['impr'] || 0),
      clicks: Number(row['clicks'] || 0),
      value: parseCurrency(row['value']),
      conv: Number(row['conv'] || 0),
      cost: parseCurrency(row['cost']),
      date: parseDate(row['date']),
      cpc: parseCurrency(row['cpc']),
      ctr: parsePercentage(row['ctr']),
      convRate: parsePercentage(row['convRate']),
      cpa: parseCurrency(row['cpa']),
      roas: Number(row['roas'] || 0)
    }));
  } catch (error) {
    console.error(`Error fetching ${tab} data:`, error);
    return [];
  }
}

// Standalone functions to fetch individual tab data
export async function fetchDaily(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<AdMetric[]> {
  return fetchAndParseDaily(sheetUrl);
}

export async function fetchSearchTerms(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<SearchTermMetric[]> {
  return fetchAndParseSearchTerms(sheetUrl);
}

export async function fetchAdGroups(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<AdGroupRecord[]> {
  return fetchAndParseAdGroups(sheetUrl);
}

export async function fetchAllTabsData(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<TabData> {
  const [dailyData, searchTermsData, adGroupsData] = await Promise.all([
    fetchAndParseDaily(sheetUrl),
    fetchAndParseSearchTerms(sheetUrl),
    fetchAndParseAdGroups(sheetUrl)
  ]);

  return {
    daily: dailyData || [],
    searchTerms: searchTermsData || [],
    adGroups: adGroupsData || [],
  } as TabData;
}

export function getCampaigns(data: AdMetric[]): Campaign[] {
  const campaignMap = new Map<string, { id: string; name: string; totalCost: number }>()

  data.forEach(row => {
    if (!campaignMap.has(row.campaignId)) {
      campaignMap.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaign,
        totalCost: row.cost
      })
    } else {
      const campaign = campaignMap.get(row.campaignId)!
      campaign.totalCost += row.cost
    }
  })

  return Array.from(campaignMap.values())
    .sort((a, b) => b.totalCost - a.totalCost) // Sort by cost descending
}

export function getMetricsByDate(data: AdMetric[], campaignId: string): AdMetric[] {
  return data
    .filter(metric => metric.campaignId === campaignId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

export function getMetricOptions(activeTab: SheetTab = 'daily') {
  return TAB_CONFIGS[activeTab]?.metrics || {}
}

// SWR configuration without cache control
export const swrConfig = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5000
}

// Facebook Enriched Types and Mapper
export type FbEnrichedRow = {
  campaign_name: string
  date_start: string   // human readable
  date_iso: string     // "YYYY-MM-DD"
  spend: number
  clicks: number
  lp_views: number
  fb_form_leads: number
  landing_leads: number
}

// Numeric parser that tolerates locale commas
const num = (v: any): number => {
  if (typeof v === 'number') return v
  const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(',', '.')
  const parsed = Number(cleaned)
  return isFinite(parsed) ? parsed : 0
}

export function mapFbEnriched(rows: any[][]): FbEnrichedRow[] {
  if (!rows || rows.length < 2) return []
  
  const [header, ...data] = rows
  const col = (n: string) => header.findIndex(h => String(h).trim() === n)
  
  const I = {
    campaign_name: col('campaign_name'),
    date_start:    col('date_start'),
    date_iso:      col('date_iso'),
    spend:         col('spend'),
    clicks:        col('clicks'),
    lp_views:      col('lp_views'),
    fb_form_leads: col('fb_form_leads'),
    landing_leads: col('landing_leads'),
  }
  
  return data.map(r => ({
    campaign_name: String(r[I.campaign_name] ?? ''),
    date_start:    String(r[I.date_start] ?? ''),
    date_iso:      String(r[I.date_iso] ?? ''),
    spend:         num(r[I.spend]),
    clicks:        num(r[I.clicks]),
    lp_views:      num(r[I.lp_views]),
    fb_form_leads: num(r[I.fb_form_leads]),
    landing_leads: num(r[I.landing_leads]),
  }))
}

// Generic fetchSheet helper
export async function fetchSheet(args: { sheetUrl: string; tab: string }): Promise<any[][]> {
  const { sheetUrl, tab } = args
  const url = `${sheetUrl}?tab=${tab}`
  const response = await fetch(url, { cache: 'no-store' })
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${tab}: ${response.status} ${response.statusText}`)
  }
  
  const data = await response.json()
  if (!Array.isArray(data)) {
    console.warn(`Response is not an array for ${tab}:`, data)
    return []
  }
  
  // If data is array of objects, convert to 2D array
  if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
    const headers = Object.keys(data[0])
    const rows = [headers, ...data.map(row => headers.map(h => row[h]))]
    return rows
  }
  
  // If already 2D array, return as is
  return data
}

// Fetch Facebook Enriched data with fallback
export async function fetchFbEnriched(
  fetchSheetFn: (args: { sheetUrl: string; tab: string }) => Promise<any[][]>,
  sheetUrl?: string
): Promise<FbEnrichedRow[]> {
  const url = sheetUrl || process.env.NEXT_PUBLIC_SHEETS_URL || DEFAULT_WEB_APP_URL
  
  try {
    let raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.FB_ENRICHED })
    
    if (!raw || raw.length === 0) {
      console.warn('fb_ads_enriched empty; falling back to fb_ads_raw')
      raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.FB_RAW })
    }
    
    return mapFbEnriched(raw)
  } catch (error) {
    console.error('Error fetching Facebook enriched data:', error)
    // Try fallback
    try {
      console.warn('Attempting fallback to fb_ads_raw')
      const raw = await fetchSheetFn({ sheetUrl: url, tab: SHEETS_TABS.FB_RAW })
      return mapFbEnriched(raw)
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError)
      return []
    }
  }
}

// Helper to aggregate FB totals
export function totalsFb(rows: FbEnrichedRow[]) {
  return rows.reduce((a, r) => {
    a.spend         += r.spend
    a.clicks        += r.clicks
    a.lp_views      += r.lp_views
    a.fb_form_leads += r.fb_form_leads
    a.landing_leads += r.landing_leads
    return a
  }, { spend: 0, clicks: 0, lp_views: 0, fb_form_leads: 0, landing_leads: 0 })
} 