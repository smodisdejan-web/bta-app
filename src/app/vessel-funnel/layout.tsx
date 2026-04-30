import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Vessel Funnel',
}

export default function VesselFunnelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
