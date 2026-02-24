/**
 * Creates a "Test Tracker" tab in the target Google Sheet.
 *
 * Usage:
 *   npx tsx scripts/setup-test-tracker.ts
 *
 * Requires env vars (in .env.local):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (or GOOGLE_PRIVATE_KEY)
 *
 * The target sheet ID is hard-coded below.
 */

import 'dotenv/config';
import crypto from 'crypto';

// ── Config ──────────────────────────────────────────────────────────
const SHEET_ID = '1ZqxDWyuxCOz5G8DdOTo5ZRMGz5_oxHH9PqtwBe3uUpw';
const TAB_NAME = 'Test Tracker';

const HEADERS = [
  'Test ID',
  'Category',
  'Channel',
  'Test Name',
  'Hypothesis',
  'Success Criteria',
  'Status',
  'Priority',
  'Campaign(s)',
  'Start Date',
  'End Date',
  'Days Running',
  'Baseline',
  'KPI Name',
  'Variant A',
  'Variant B',
  'KPI A',
  'KPI B',
  'Winner',
  'Stat Confidence',
  'Learning',
  'Next Action',
];

// ── Auth (mirrors src/lib/sheets.ts) ────────────────────────────────
function getServiceAccountCreds() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in env',
    );
  }
  return { clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
}

async function getServiceAccountToken(): Promise<string> {
  const creds = getServiceAccountCreds();
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
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .end()
    .sign(creds.privateKey, 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

// ── Helpers ─────────────────────────────────────────────────────────
async function sheetsApi(
  token: string,
  path: string,
  body: unknown,
  method = 'POST',
) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

function colIndex(letter: string): number {
  // A=0, B=1, …, V=21
  return letter.charCodeAt(0) - 65;
}

// ── Build batchUpdate requests ──────────────────────────────────────
function buildRequests(sheetId: number) {
  const requests: unknown[] = [];

  // 1. Write header row
  requests.push({
    updateCells: {
      rows: [
        {
          values: HEADERS.map((h) => ({
            userEnteredValue: { stringValue: h },
            userEnteredFormat: { textFormat: { bold: true } },
          })),
        },
      ],
      fields: 'userEnteredValue,userEnteredFormat.textFormat.bold',
      start: { sheetId, rowIndex: 0, columnIndex: 0 },
    },
  });

  // 2. Freeze header row
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  // 3. Formulas in column L (Days Running), rows 2-100
  const formulaRows = [];
  for (let r = 2; r <= 100; r++) {
    formulaRows.push({
      values: [
        {
          userEnteredValue: {
            formulaValue: `=IF(J${r}="","",IF(K${r}="",TODAY()-J${r},K${r}-J${r}))`,
          },
        },
      ],
    });
  }
  requests.push({
    updateCells: {
      rows: formulaRows,
      fields: 'userEnteredValue',
      start: { sheetId, rowIndex: 1, columnIndex: colIndex('L') },
    },
  });

  // 4. Data validation (dropdowns)
  const validations: { col: string; values: string[] }[] = [
    {
      col: 'B',
      values: [
        'Ads',
        'Landing Page',
        'Offer',
        'Lead Form',
        'Campaign Structure',
        'Targeting',
        'Bids & Budgets',
      ],
    },
    { col: 'C', values: ['Google Ads', 'Facebook Ads', 'Both'] },
    {
      col: 'G',
      values: [
        'Backlog',
        'Prioritized',
        'Running',
        'Analyzing',
        'Done',
        'Killed',
      ],
    },
    { col: 'S', values: ['A', 'B', 'Inconclusive', 'Too Early'] },
    { col: 'T', values: ['Low', 'Medium', 'High'] },
  ];

  for (const v of validations) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: colIndex(v.col),
          endColumnIndex: colIndex(v.col) + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: v.values.map((val) => ({ userEnteredValue: val })),
          },
          showCustomUi: true,
          strict: false,
        },
      },
    });
  }

  // 5. Number format for column H (Priority) — rows 2:100
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 100,
        startColumnIndex: colIndex('H'),
        endColumnIndex: colIndex('H') + 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        },
      },
      fields: 'userEnteredFormat.numberFormat',
    },
  });

  // 6. Date format for columns J and K (Start Date, End Date) — rows 2:100
  for (const col of ['J', 'K']) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: colIndex(col),
          endColumnIndex: colIndex(col) + 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // 7. Number format for columns Q and R (KPI A, KPI B) — rows 2:100
  for (const col of ['Q', 'R']) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: colIndex(col),
          endColumnIndex: colIndex(col) + 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }

  // 8. Auto-resize columns to fit headers
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: HEADERS.length,
      },
    },
  });

  return requests;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('Authenticating with service account…');
  const token = await getServiceAccountToken();

  // Step 1: Add the sheet tab
  console.log(`Creating tab "${TAB_NAME}"…`);
  let newSheetId: number;
  try {
    const addRes = (await sheetsApi(token, ':batchUpdate', {
      requests: [
        {
          addSheet: {
            properties: { title: TAB_NAME },
          },
        },
      ],
    })) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    newSheetId = addRes.replies[0].addSheet.properties.sheetId;
    console.log(`Tab created (sheetId=${newSheetId})`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('already exists')) {
      // Tab exists — look up its sheetId
      console.log('Tab already exists — fetching sheetId…');
      const meta = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties&key=`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ).then((r) => r.json()) as {
        sheets: { properties: { title: string; sheetId: number } }[];
      };
      const match = meta.sheets.find((s) => s.properties.title === TAB_NAME);
      if (!match) throw new Error('Tab exists but could not resolve sheetId');
      newSheetId = match.properties.sheetId;
      console.log(`Resolved existing sheetId=${newSheetId}`);
    } else {
      throw e;
    }
  }

  // Step 2: batchUpdate — headers, formulas, validation, formatting
  console.log('Applying headers, formulas, validation, formatting…');
  const requests = buildRequests(newSheetId);
  await sheetsApi(token, ':batchUpdate', { requests });

  console.log(
    `\n✓ Done! "${TAB_NAME}" is ready:\n  https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${newSheetId}`,
  );
}

main().catch((err) => {
  console.error('ERROR:', err.message ?? err);
  process.exit(1);
});
