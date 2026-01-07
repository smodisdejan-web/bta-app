import { NextResponse } from 'next/server';

const VALID_PRESETS = ['7d', '30d', '90d', 'Custom'];

export async function POST(request: Request) {
  try {
    const { preset, customStart } = await request.json();

    if (!VALID_PRESETS.includes(preset)) {
      return NextResponse.json(
        { error: `Invalid preset. Must be one of: ${VALID_PRESETS.join(', ')}` },
        { status: 400 }
      );
    }

    const sheetsUrl = process.env.NEXT_PUBLIC_SHEETS_URL;
    if (!sheetsUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SHEETS_URL not configured' }, { status: 500 });
    }

    console.log('[fb-preset] Setting preset:', preset, customStart || '');

    const response = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setFbPreset',
        preset,
        customStart
      })
    });

    const result = await response.json();
    console.log('[fb-preset] Response:', result);

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, preset });
  } catch (error) {
    console.error('[fb-preset] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

