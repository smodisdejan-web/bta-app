// GET /cro-tower/unlock — minimal password page for the Web Funnel CRO tower. Plain HTML from a
// route handler (no app layout, no BTA navigation). The form posts to /api/cro-tower/unlock.
export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export async function GET(request: Request) {
  const url = new URL(request.url)
  const err = url.searchParams.get('e')
  const next = url.searchParams.get('next') || '/cro-tower'
  const safeNext = next.startsWith('/cro-tower') ? next : '/cro-tower'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goolets · Web Funnel · CRO</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@500;600&display=swap">
<style>
:root{--ground:#F3EFE6;--surface:#FFF;--line:#E0DCD4;--ink:#121212;--muted:#706A5C;--gold:#B39262;--bad:#B23327}
@media (prefers-color-scheme:dark){:root{--ground:#14120F;--surface:#1C1915;--line:#34302A;--ink:#F1ECE2;--muted:#9D9584;--gold:#C9A87A;--bad:#E58372}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--ground);color:var(--ink);font:14px/1.5 Inter,system-ui,sans-serif;padding:16px}
form{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:28px 24px;width:100%;max-width:360px}
h1{font:500 22px 'Playfair Display',Georgia,serif;margin:0 0 4px}p{margin:0 0 18px;color:var(--muted);font-size:12.5px}
input{font:inherit;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink)}
input:focus{outline:none;border-color:var(--gold)}button{margin-top:12px;width:100%;font:600 13px Inter,sans-serif;padding:10px;border-radius:8px;border:0;background:var(--ink);color:var(--ground);cursor:pointer}
.err{color:var(--bad);font-size:12px;margin-top:10px}
</style></head><body>
<form method="post" action="/api/cro-tower/unlock">
<h1>Goolets · Web Funnel</h1><p>CRO tower. Enter the password you were sent.</p>
<input type="password" name="password" autocomplete="current-password" autofocus required aria-label="Password">
<input type="hidden" name="next" value="${esc(safeNext)}">
<button type="submit">Open</button>
${err ? '<div class="err">Wrong password, try again.</div>' : ''}
</form></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
