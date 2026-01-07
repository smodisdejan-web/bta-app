// src/app/layout.tsx 
import './globals.css'
import { Inter } from 'next/font/google'
import { SettingsProvider } from '@/lib/contexts/SettingsContext'
import { Navigation } from '@/components/Navigation'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SettingsProvider>
          <Navigation />
          <main className="min-h-screen bg-gray-50 pt-20 md:pt-24">
            {children}
          </main>
          <Toaster />
        </SettingsProvider>
      </body>
    </html>
  )
} 