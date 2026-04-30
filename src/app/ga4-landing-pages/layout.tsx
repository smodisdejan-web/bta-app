import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'GA4 Landing Pages',
}

export default function GA4LandingPagesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
