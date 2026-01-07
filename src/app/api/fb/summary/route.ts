import { NextResponse } from 'next/server';
import { loadFbDashboard } from '@/lib/loaders/fb-dashboard';

export async function GET() {
  try {
    const data = await loadFbDashboard();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[api/fb/summary] failed', error);
    return NextResponse.json({ error: error?.message || 'Failed to load Facebook summary' }, { status: 500 });
  }
}

