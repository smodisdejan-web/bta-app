import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local explicitly (Next.js convention)
config({ path: resolve(process.cwd(), '.env.local') });
// Also try .env as fallback
config({ path: resolve(process.cwd(), '.env') });

const raw = process.env.OPENAI_API_KEY || '';

const masked = raw ? raw.slice(0,8) + '...' + raw.slice(-4) : '(missing)';

const clientVisible = Object.keys(process.env).some(k => k === 'NEXT_PUBLIC_OPENAI_KEY');

console.log(JSON.stringify({
  ok: !!raw,
  keyMasked: masked,
  clientVisible: clientVisible,
}, null, 2));

