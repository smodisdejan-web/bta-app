import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Google Ads',
}

export default function GoogleAdsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
