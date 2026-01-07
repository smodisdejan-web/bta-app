import { NextRequest, NextResponse } from 'next/server';

import { getOverviewData, CACMode } from '@/lib/overview-data';
import { loadFbDashboard } from '@/lib/loaders/fb-dashboard';

export const dynamic = 'force-dynamic';

function parseDays(param: string | null): number {
  const n = Number(param);
  if (Number.isFinite(n) && n > 0 && n <= 365) return Math.floor(n);
  return 30;
}

function parseCacMode(param: string | null): CACMode {
  return param === 'deals' ? 'deals' : 'leads';
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const days = parseDays(searchParams.get('days'));
  const cacMode = parseCacMode(searchParams.get('cacMode'));

  try {
    const [overviewData, fbDashboard] = await Promise.all([
      getOverviewData(days, cacMode),
      loadFbDashboard()
    ]);

    const payload = {
      ...overviewData,
      // Ensure FB metrics come from dashboard_fb tab
      facebookSummary: fbDashboard ?? overviewData.facebookSummary
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[api/overview] Failed to load overview data', error);
    return NextResponse.json({ error: 'Failed to load overview data' }, { status: 500 });
  }
}

