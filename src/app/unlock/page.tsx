import { Suspense } from 'react';
import UnlockClient from './UnlockClient';

export const metadata = { title: "Unlock • Goolets AI Agent" };

export default function UnlockPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <UnlockClient />
    </Suspense>
  );
}
