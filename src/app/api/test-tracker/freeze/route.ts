import { NextResponse } from 'next/server'
import { writeCell } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

// Column W = "Frozen Variants" in test_tracker sheet
// Row index: header is row 1, data starts row 2
// We receive { rowIndex: number, variants: object } from the client

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { rowIndex, variants } = body

    if (!rowIndex || !variants) {
      return NextResponse.json({ error: 'Missing rowIndex or variants' }, { status: 400 })
    }

    const json = JSON.stringify(variants)
    const cell = `test_tracker!W${rowIndex}`

    await writeCell(cell, json)

    return NextResponse.json({ ok: true, cell, size: json.length })
  } catch (error) {
    console.error('[api/test-tracker/freeze] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to freeze test data' },
      { status: 500 }
    )
  }
}
