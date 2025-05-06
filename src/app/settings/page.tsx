// src/app/settings/page.tsx

'use client'

import { useSettings } from '@/lib/contexts/SettingsContext'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fetchAllTabsData, getCampaigns } from '@/lib/sheetsData'
import { CURRENCY_OPTIONS } from '@/lib/utils'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { useToast } from "@/hooks/use-toast"

export default function SettingsPage() {
  const router = useRouter()
  const { settings, setSheetUrl, setCurrency, refreshData, isDataLoading: isContextLoading, dataError: contextError } = useSettings()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (contextError) {
      setError('Error loading initial data. Check URL or network.');
    }
  }, [contextError]);

  const handleUpdate = async () => {
    setIsLoading(true)
    setError(undefined)

    try {
      await refreshData()
      router.push('/')
    } catch (err) {
      console.error('Error updating data:', err)
      setError('Failed to update data. Please check your Sheet URL or network connection.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-12 mt-16">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-12">Settings</h1>

          <Card className="p-6 bg-white shadow-sm">
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="sheetUrl" className="text-base">
                    Google Sheet URL
                  </Label>
                  <div className="mt-2">
                    <Input
                      id="sheetUrl"
                      value={settings.sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      placeholder="Enter your Google Sheet URL"
                      className="h-12"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-base">Currency</Label>
                  <div className="mt-2">
                    <Select value={settings.currency} onValueChange={setCurrency}>
                      <SelectTrigger className="h-12 w-[200px]">
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {error && (
                <div className="text-sm text-red-500 bg-red-50 p-3 rounded-md">
                  {error}
                </div>
              )}

              <div className="pt-4">
                <Button
                  onClick={handleUpdate}
                  disabled={isLoading || isContextLoading || !settings.sheetUrl}
                  className="w-full h-12 text-lg bg-[#ea580c] hover:bg-[#c2410c] text-white"
                >
                  {isLoading || isContextLoading ? (
                    'Updating...'
                  ) : (
                    <span className="flex items-center gap-2">
                      Update & View Dashboard
                      <ArrowRight className="w-5 h-5" />
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
} 