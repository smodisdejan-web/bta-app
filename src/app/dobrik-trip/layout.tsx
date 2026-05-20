import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dobrik Trip',
}

export default function DobrikTripLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
