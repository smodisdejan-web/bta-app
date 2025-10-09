// src/hooks/use-adgroups.ts
import useSWR from 'swr'
import { fetchAdGroups } from '@/lib/sheetsData'
import { AdGroupRecord } from '@/lib/types'

/**
 * Hook to fetch and manage ad groups data
 * @param sheetUrl - URL of the Google Sheets API endpoint
 * @returns SWR response with ad groups data
 */
export function useAdGroups(sheetUrl: string) {
  const { data, error, isLoading, mutate } = useSWR<AdGroupRecord[]>(
    sheetUrl ? `adGroups-${sheetUrl}` : null,
    () => fetchAdGroups(sheetUrl),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5000
    }
  )

  return {
    adGroups: data || [],
    error,
    isLoading,
    refresh: mutate
  }
}
