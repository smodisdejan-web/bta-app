import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local explicitly (Next.js convention)
config({ path: resolve(process.cwd(), '.env.local') });
// Also try .env as fallback
config({ path: resolve(process.cwd(), '.env') });

const raw = process.env.NEXT_PUBLIC_SHEETS_URL || process.env.NEXT_PUBLIC_SHEET_API_URL;

const which = process.env.NEXT_PUBLIC_SHEETS_URL ? 'NEXT_PUBLIC_SHEETS_URL'
             : process.env.NEXT_PUBLIC_SHEET_API_URL ? 'NEXT_PUBLIC_SHEET_API_URL'
             : 'none';

function mask(v?: string) {
  if (!v) return 'MISSING';
  return `${v.slice(0, 40)}… (len=${v.length})`;
}

console.log('Env check');
console.log('  which var:', which);
console.log('  value (masked):', mask(raw));
console.log('  defined for client (NEXT_PUBLIC_*):', Boolean(process.env.NEXT_PUBLIC_SHEETS_URL));

