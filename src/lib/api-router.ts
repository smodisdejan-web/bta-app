import { DEFAULT_WEB_APP_URL } from './config'
import type { LandingPageData } from './types'

export interface SheetDataOptions {
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: number
}

export async function getSheetData(
  tab: string, 
  options: SheetDataOptions = {}
): Promise<LandingPageData[]> {
  const { sort = 'cost', dir = 'desc', limit = 200 } = options
  
  const url = new URL(DEFAULT_WEB_APP_URL)
  url.searchParams.set('tab', tab)
  url.searchParams.set('sort', sort)
  url.searchParams.set('dir', dir)
  url.searchParams.set('limit', limit.toString())

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      redirect: 'follow'
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    // Ensure we return an array
    if (!Array.isArray(data)) {
      throw new Error('Expected array response from API')
    }
    
    return data as LandingPageData[]
  } catch (error) {
    console.error('Error fetching sheet data:', error)
    
    // Return mock data for development/testing
    if (tab === 'landingPages') {
      console.log('Returning mock data for landing pages')
      return generateMockLandingPageData()
    }
    
    throw new Error(`Failed to fetch data: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Mock data generator for development
function generateMockLandingPageData(): LandingPageData[] {
  const mockUrls = [
    'https://example.com/products/shoes',
    'https://example.com/products/jackets',
    'https://example.com/products/accessories',
    'https://example.com/sale/summer-collection',
    'https://example.com/new-arrivals',
    'https://example.com/products/electronics',
    'https://example.com/products/home-garden',
    'https://example.com/products/sports',
    'https://example.com/products/books',
    'https://example.com/products/toys'
  ]
  
  const statuses = ['active', 'paused', 'inactive']
  
  return mockUrls.map((url, index) => ({
    url,
    clicks: Math.floor(Math.random() * 5000) + 100,
    impr: Math.floor(Math.random() * 50000) + 1000,
    ctr: Math.random() * 0.1 + 0.01, // 1-11%
    cost: Math.random() * 1000 + 50,
    cpc: Math.random() * 2 + 0.5,
    conv: Math.floor(Math.random() * 100) + 1,
    convRate: Math.random() * 0.15 + 0.01, // 1-16%
    cpa: Math.random() * 50 + 10,
    value: Math.random() * 2000 + 100,
    roas: Math.random() * 5 + 0.5, // 0.5-5.5x
    status: statuses[index % statuses.length]
  })).sort((a, b) => b.cost - a.cost) // Sort by cost descending
}// --- TEMP: stub so the Insights page can import it without breaking the build ---
// Replace with the real implementation later.
export const generateInsightsWithProvider = async (..._args: any[]) => {
  return { insights: [], aiInsights: [] };
};
