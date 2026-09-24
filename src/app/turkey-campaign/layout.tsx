import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Turkey Campaign 2026',
}

export default function TurkeyCampaignLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
