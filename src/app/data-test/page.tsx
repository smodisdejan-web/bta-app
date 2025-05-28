'use client'

import { useState, useEffect } from 'react'
import { useSettings } from '@/lib/contexts/SettingsContext'
import { fetchAllTabsData } from '@/lib/sheetsData'
import { SHEET_TABS, SheetTab } from '@/lib/config'
import { TabData } from '@/lib/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card } from '@/components/ui/card'

export default function DataTestPage() {
    const { settings } = useSettings()
    const [tabData, setTabData] = useState<TabData | null>(null)
    const [selectedTab, setSelectedTab] = useState<SheetTab>('daily')
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!settings.sheetUrl) {
            setIsLoading(false)
            setError('Please configure your Google Sheet URL in settings')
            return
        }

        async function loadData() {
            try {
                setIsLoading(true)
                setError(null)
                const data = await fetchAllTabsData(settings.sheetUrl)
                setTabData(data)
            } catch (err: any) {
                console.error('Error fetching data:', err)
                setError(`Failed to load data: ${err?.message || 'Unknown error'}`)
            } finally {
                setIsLoading(false)
            }
        }

        loadData()
    }, [settings.sheetUrl])

    // Get the data for the selected tab
    const getSelectedTabData = () => {
        if (!tabData) return []
        // Ensure that tabData[selectedTab] is correctly typed or handled if undefined
        const currentTabData = tabData[selectedTab as keyof TabData] as any[] | undefined;
        return currentTabData || [];
    }

    // Get all data keys (column names) for the selected tab
    const getDataKeys = () => {
        const data = getSelectedTabData()
        if (data.length === 0) return []
        return Object.keys(data[0] || {})
    }

    const selectedTabData = getSelectedTabData()
    const dataKeys = getDataKeys()

    return (
        <div className="container mx-auto px-4 py-12 mt-16">
            <h1 className="text-3xl font-bold mb-8">Data Testing Page</h1>

            {error ? (
                <div className="text-red-500 mb-4">{error}</div>
            ) : isLoading ? (
                <div>Loading...</div>
            ) : (
                <div className="space-y-8">
                    <div>
                        <label className="block text-sm font-medium mb-2">Select Data Tab</label>
                        <Select value={selectedTab} onValueChange={(value) => setSelectedTab(value as SheetTab)}>
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Select tab" />
                            </SelectTrigger>
                            <SelectContent>
                                {SHEET_TABS.map((tab) => (
                                    <SelectItem key={tab} value={tab}>
                                        {tab}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <Card className="p-4 bg-white rounded-lg shadow">
                        <h2 className="text-xl font-semibold mb-2">Tab: {selectedTab}</h2>
                        <p className="mb-4">Total rows: {selectedTabData.length}</p>

                        {selectedTabData.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            {dataKeys.map((key) => (
                                                <th
                                                    key={key}
                                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                                >
                                                    {key}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {selectedTabData.slice(0, 10).map((row, rowIndex) => (
                                            <tr key={rowIndex}>
                                                {dataKeys.map((key) => (
                                                    <td key={`${rowIndex}-${key}`} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {typeof row[key as keyof typeof row] === 'number'
                                                            ? Number(row[key as keyof typeof row]).toLocaleString()
                                                            : String(row[key as keyof typeof row])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p>No data available for this tab</p>
                        )}
                    </Card>
                </div>
            )}
        </div>
    )
} 