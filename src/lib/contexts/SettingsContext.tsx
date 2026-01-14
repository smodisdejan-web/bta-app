// src/lib/contexts/SettingsContext.tsx
'use client'
import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import useSWR, { mutate } from 'swr'
import type { Campaign, Settings, TabData } from '../types'
import { DEFAULT_WEB_APP_URL, getSheetsUrl } from '../config'
import { fetchAllTabsData, getCampaigns } from '../sheetsData'

export type SettingsContextType = {
  settings: Settings
  updateSettings: (newSettings: Partial<Settings>) => void
  setSheetUrl: (url: string) => void
  setCurrency: (currency: string) => void
  setSelectedCampaign: (campaignId: string) => void
  fetchedData: TabData | undefined
  dataError: any
  isDataLoading: boolean
  refreshData: () => void
  campaigns: Campaign[]
}

const defaultSettings: Settings = {
  // Prefer env-based sheets URL; fall back to hardcoded default
  sheetUrl: getSheetsUrl() || DEFAULT_WEB_APP_URL,
  currency: '€',
  selectedCampaign: undefined,
  activeTab: 'daily'
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings)

  // Wrapper to add timeout to fetchAllTabsData
  const fetchWithTimeout = async (url: string): Promise<TabData> => {
    const timeoutMs = 60000 // 60 second timeout - give more time for slow APIs
    let timeoutId: NodeJS.Timeout | null = null
    
    const timeoutPromise = new Promise<TabData>((_, reject) => {
      timeoutId = setTimeout(() => {
        console.warn('Data fetch timeout after 60 seconds')
        reject(new Error('Data fetch timeout after 60 seconds'))
      }, timeoutMs)
    })
    
    const fetchPromise = fetchAllTabsData(url).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
    
    try {
      const result = await Promise.race([fetchPromise, timeoutPromise])
      console.log('Data fetched successfully:', { 
        daily: result.daily?.length || 0, 
        searchTerms: result.searchTerms?.length || 0, 
        adGroups: result.adGroups?.length || 0 
      })
      return result
    } catch (error) {
      console.error('Fetch error or timeout:', error)
      // Return empty data structure on timeout/error so page can render
      return {
        daily: [],
        searchTerms: [],
        adGroups: []
      }
    }
  }

  // Fetch data using useSWR based on sheetUrl with optimized settings
  const { data: fetchedData, error: dataError, isLoading: isDataLoading, mutate: refreshData } = useSWR<TabData>(
    settings.sheetUrl ? settings.sheetUrl : null,
    fetchWithTimeout,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000, // Prevent duplicate requests for 1 minute
      errorRetryCount: 0, // Don't retry on error to avoid hanging
      errorRetryInterval: 2000,
      onError: (error) => {
        console.error('Error fetching data:', error)
      },
      onSuccess: () => {
        console.log('Data loaded successfully')
      },
      // Return empty data after timeout instead of hanging
      onLoadingSlow: () => {
        console.warn('Data loading is taking longer than expected')
      },
      suspense: false,
      shouldRetryOnError: false
    }
  )

  // Log data loading status for debugging
  if (typeof window !== 'undefined') {
    console.log('[SettingsContext] Data status:', {
      hasData: !!fetchedData,
      isLoading: isDataLoading,
      hasError: !!dataError,
      dailyCount: fetchedData?.daily?.length || 0,
      searchTermsCount: fetchedData?.searchTerms?.length || 0,
      adGroupsCount: fetchedData?.adGroups?.length || 0
    })
  }

  // Calculate campaigns based on fetchedData
  const campaigns = useMemo(() => {
    return fetchedData?.daily ? getCampaigns(fetchedData.daily) : []
  }, [fetchedData])

  const setSheetUrl = (url: string) => {
    setSettings(prev => ({ ...prev, sheetUrl: url }))
  }

  const setCurrency = (currency: string) => {
    setSettings(prev => ({ ...prev, currency }))
  }

  const setSelectedCampaign = (id: string) => {
    setSettings(prev => ({ ...prev, selectedCampaign: id }))
  }

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }

  return (
    <SettingsContext.Provider value={{
      settings,
      updateSettings,
      setSheetUrl,
      setCurrency,
      setSelectedCampaign,
      fetchedData,
      dataError,
      isDataLoading,
      refreshData: () => refreshData(),
      campaigns
    }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
} 