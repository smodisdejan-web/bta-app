// src/app/layout.tsx
import './globals.css'
import { Inter, Cormorant_Garamond, Dancing_Script } from 'next/font/google'
import { SettingsProvider } from '@/lib/contexts/SettingsContext'
import { Navigation } from '@/components/Navigation'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif-display',
  display: 'swap',
})

const dancingScript = Dancing_Script({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-script',
  display: 'swap',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable} ${dancingScript.variable}`}>
      <body className={inter.className}>
        <SettingsProvider>
          <Navigation />
          <main className="min-h-screen bg-background pt-16">
            {children}
          </main>
          <Toaster />
        </SettingsProvider>
      </body>
    </html>
  )
}
