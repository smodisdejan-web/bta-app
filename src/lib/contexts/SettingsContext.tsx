// src/lib/contexts/SettingsContext.tsx
'use client'
import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import useSWR, { mutate } from 'swr'
import type { Campaign, Settings, TabData } from '../types'
import { DEFAULT_WEB_APP_URL } from '../config'
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
  sheetUrl: DEFAULT_WEB_APP_URL,
  currency: '$',
  selectedCampaign: undefined,
  activeTab: 'daily'
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings)

  // Fetch data using useSWR based on sheetUrl
  const { data: fetchedData, error: dataError, isLoading: isDataLoading, mutate: refreshData } = useSWR<TabData>(
    settings.sheetUrl ? settings.sheetUrl : null,
    fetchAllTabsData,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  )

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