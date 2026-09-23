// src/lib/cro-auth.ts
//
// Password gate for the standalone Web Funnel CRO page (/cro-tower) and its two AI routes
// (/api/cro-tower/ask, /api/cro-tower/review). SEPARATE from the BTA `ai_unlock` gate: Tadej
// gets this password and nothing else.
//
//   env CRO_TOWER_PASSWORD   the password (no env = the page is closed, never open)
//   cookie cro_unlock        httpOnly, 30 days, value = SHA-256("cro-tower-v1:" + password)
//
// The cookie carries a hash of the password, not "1", so it cannot be forged by hand and it
// dies the moment the password is rotated. Web Crypto only, so middleware (edge) and the
// Node route handlers share this one function.

export const CRO_COOKIE = 'cro_unlock'
export const CRO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export async function croCookieValue(password: string): Promise<string> {
  const data = new TextEncoder().encode(`cro-tower-v1:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** true when the request carries a valid cro_unlock cookie. false when the env is missing. */
export async function isCroUnlocked(cookieValue: string | undefined | null): Promise<boolean> {
  const pw = process.env.CRO_TOWER_PASSWORD
  if (!pw || !cookieValue) return false
  return cookieValue === (await croCookieValue(pw))
}
