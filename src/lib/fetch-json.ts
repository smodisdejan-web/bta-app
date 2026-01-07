// src/lib/fetch-json.ts

export interface FetchJsonResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: any;
}

/**
 * Robust JSON fetcher with timeout, cache-busting, and error handling
 */
export async function fetchJson(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 8000
): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Add cache-busting timestamp
    const u = new URL(url);
    u.searchParams.set('_ts', String(Date.now()));

    console.log('[fetchJson] Fetching:', u.toString().slice(0, 100) + '...');

    const res = await fetch(u.toString(), {
      cache: 'no-store',
      signal: controller.signal,
      redirect: 'follow',
      ...opts
    });

    const text = await res.text();

    // Try to parse as JSON
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    console.log(
      '[fetchJson] Response:',
      res.ok,
      res.status,
      Array.isArray(body) ? `${body.length} rows` : typeof body
    );

    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      body
    };
  } catch (err: any) {
    console.error('[fetchJson] Error:', err?.name === 'AbortError' ? 'Timeout' : err);
    return {
      ok: false,
      status: 0,
      contentType: '',
      body: { error: err?.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : String(err) }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
