import crypto from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

type NamedRangeRecord<T extends string> = Record<T, string | number>;

function assertSheetId() {
  if (!SHEET_ID) {
    throw new Error('GOOGLE_SHEETS_ID is required to read/write Sheets ranges');
  }
}

function getServiceAccountCreds() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

async function getServiceAccountToken(): Promise<string> {
  const creds = getServiceAccountCreds();
  if (!creds) {
    throw new Error('Service account credentials missing (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)');
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const payload = {
    iss: creds.clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp,
    iat,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsigned = `${base64url(header)}.${base64url(payload)}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).end().sign(creds.privateKey, 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Failed to fetch service account token: ${res.status} ${msg}`);
  }

  const json = await res.json();
  return json.access_token as string;
}

export async function readNamedRanges<T extends string>(names: readonly T[]): Promise<NamedRangeRecord<T>> {
  assertSheetId();
  if (!API_KEY) {
    throw new Error('GOOGLE_SHEETS_API_KEY is required for readNamedRanges');
  }
  const ranges = names.map((n) => `ranges=${encodeURIComponent(n)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${ranges}&majorDimension=ROWS&key=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`readNamedRanges failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const result = {} as NamedRangeRecord<T>;
  for (const name of names) {
    const match = (data.valueRanges || []).find((vr: any) => vr.range?.includes(name));
    const v = match?.values?.[0]?.[0];
    result[name] = v ?? '';
  }
  return result;
}

export async function writeCell(a1: string, value: string): Promise<void> {
  assertSheetId();
  const token = await getServiceAccountToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(a1)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      range: a1,
      majorDimension: 'ROWS',
      values: [[value]],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`writeCell failed: ${res.status} ${text}`);
  }
}

