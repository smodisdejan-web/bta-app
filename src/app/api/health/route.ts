export const dynamic = 'force-dynamic';

export async function GET() {
  const url =
    process.env.NEXT_PUBLIC_SHEETS_URL ||
    process.env.NEXT_PUBLIC_SHEET_API_URL;

  const usingVar = process.env.NEXT_PUBLIC_SHEETS_URL
    ? 'NEXT_PUBLIC_SHEETS_URL'
    : process.env.NEXT_PUBLIC_SHEET_API_URL
    ? 'NEXT_PUBLIC_SHEET_API_URL'
    : undefined;

  return new Response(
    JSON.stringify({
      ok: Boolean(url),
      envHasSheetsUrl: Boolean(url),
      usingVar,
      now: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}
