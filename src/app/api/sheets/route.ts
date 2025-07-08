// src/app/api/sheets/route.ts
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sheetUrl = searchParams.get('sheetUrl')
  const tab = searchParams.get('tab')

  if (!sheetUrl || !tab) {
    return NextResponse.json({ error: 'Missing sheetUrl or tab parameter' }, { status: 400 })
  }

  try {
    const externalUrl = `${sheetUrl}?tab=${tab}`
    const response = await fetch(externalUrl, {
      // Revalidate every 10 minutes
      next: { revalidate: 600 } 
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch from Google Sheets: ${response.statusText}`)
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('API Route Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
    return NextResponse.json({ error: 'Failed to fetch data', details: errorMessage }, { status: 500 })
  }
} 