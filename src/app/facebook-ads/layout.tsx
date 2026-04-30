import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Facebook Ads',
}

export default function FacebookAdsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
