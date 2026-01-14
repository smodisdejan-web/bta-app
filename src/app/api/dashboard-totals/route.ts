import { NextResponse } from 'next/server'
import { fetchFacebookAds, calculateTotals } from '@/lib/facebook-ads'
import { fetchGoogleAds, calculateGoogleTotals } from '@/lib/google-ads'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '7', 10)

  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)

  // Facebook data (same helpers as FB page)
  const fbData = await fetchFacebookAds()
  const fbFiltered = fbData.filter((row) => {
    if (!row.date) return false
    const d = new Date(row.date)
    return d >= start && d <= end
  })
  const fbTotals = calculateTotals(fbFiltered)

  // Google data (same helpers as Google page)
  const gaData = await fetchGoogleAds()
  const gaFiltered = gaData.filter((row) => {
    if (!row.date) return false
    const d = new Date(row.date)
    return d >= start && d <= end
  })
  const gaTotals = calculateGoogleTotals(gaFiltered)

  // Combined
  const totalLeads = (fbTotals.fbFormLeads || 0) + (fbTotals.landingLeads || 0) + (gaTotals.conversions || 0)
  const totalSpend = (fbTotals.spend || 0) + (gaTotals.spend || 0)

  return NextResponse.json({
    fb: fbTotals,
    google: gaTotals,
    combined: {
      leads: totalLeads,
      spend: totalSpend
    }
  })
}

