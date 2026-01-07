/**
 * Map UI day counts to dashboard_fb preset values.
 */
export function daysToPreset(days: number): string {
  switch (days) {
    case 7:
      return '7d';
    case 30:
      return '30d';
    case 60:
      return '60d';
    case 90:
      return '90d';
    default:
      return '30d';
  }
}

/**
 * Sync the Facebook preset to Google Sheets via the /api/fb-preset route.
 */
export async function syncFbPreset(days: number): Promise<boolean> {
  const preset = daysToPreset(days);

  try {
    console.log(`[syncFbPreset] Syncing to ${preset} (${days} days)`);

    const response = await fetch('/api/fb-preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });

    const result = await response.json();

    if (!response.ok || result?.error) {
      console.error('[syncFbPreset] Failed:', result?.error);
      return false;
    }

    console.log('[syncFbPreset] Success:', result);
    return true;
  } catch (error) {
    console.error('[syncFbPreset] Error:', error);
    return false;
  }
}

