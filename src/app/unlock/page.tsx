import { Suspense } from 'react';
import UnlockClient from './UnlockClient';

export const dynamic = 'force-dynamic'; // avoid static prerender issues

export default function UnlockPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <UnlockClient />
    </Suspense>
  );
}


