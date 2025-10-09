// src/lib/sheetsData.ts
import { AdMetric, Campaign, SearchTermMetric, TabData, AdGroupRecord } from './types'
import { SheetTab, TAB_CONFIGS, DEFAULT_WEB_APP_URL } from './config'

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