// src/lib/sheetsData.ts
import { AdMetric, Campaign, SearchTermMetric, TabData } from './types'
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

export async function fetchAllTabsData(sheetUrl: string = DEFAULT_WEB_APP_URL): Promise<TabData> {
  const [dailyData, searchTermsData] = await Promise.all([
    fetchAndParseDaily(sheetUrl),
    fetchAndParseSearchTerms(sheetUrl)
  ]);

  return {
    daily: dailyData || [],
    searchTerms: searchTermsData || [],
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