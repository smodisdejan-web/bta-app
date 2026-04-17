'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Overview', href: '/overview' },
  { label: 'Facebook Ads', href: '/facebook-ads' },
  {
    label: 'Google Ads',
    href: '/google-ads',
    dropdown: [
      { label: 'Overview', href: '/google-ads' },
      { label: 'Search Terms', href: '/terms' },
      { label: 'Ad Groups', href: '/ad-groups' },
      { label: 'Budget Pacing', href: '/budget-pacing' },
      { label: 'Landing Pages', href: '/landing-pages' },
      { label: 'Data Insights', href: '/data-insights' }
    ]
  },
  { label: 'GA4 Landing Pages', href: '/ga4-landing-pages' },
  { label: 'Tests', href: '/tests' },
  { label: 'Vessel Funnel', href: '/vessel-funnel' },
  { label: 'Reports', href: 'https://goolets-reports.vercel.app/', external: true }
] as const

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="40" cy="40" r="34"/>
        <path d="M38 14 L38 66 M38 14 C22 14 14 24 14 40 C14 56 22 66 38 66"/>
        <path d="M42 14 L42 66 M42 14 C58 14 66 24 66 40 C66 56 58 66 42 66"/>
      </g>
    </svg>
  )
}

export function Navigation() {
  const pathname = usePathname()
  const [openDropdown, setOpenDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Hide navigation on auth/unlock screens — they own the full viewport
  if (pathname === '/unlock') return null

  const isActive = (href: string) => pathname === href || (href === '/overview' && pathname === '/')
  const isGoogleActive = ['/google-ads', '/terms', '/ad-groups', '/budget-pacing', '/landing-pages', '/data-insights'].includes(pathname)

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto px-6 h-16 flex items-center">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <BrandMark className="h-8 w-8 text-foreground" />
              <div className="flex flex-col leading-none">
                <span className="font-serif text-xl text-foreground tracking-[0.25em] font-medium">GOOLETS</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-[0.3em] mt-1">AI Agent</span>
              </div>
            </Link>

            <div className="flex items-center space-x-1">
              {navItems.map((item) => {
                if ('external' in item && item.external) {
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-sm font-medium rounded-md transition-all text-foreground/70 hover:text-primary hover:bg-primary/5"
                    >
                      {item.label}
                    </a>
                  )
                }

                if (!('dropdown' in item) || !item.dropdown) {
                  const active = isActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'px-3 py-2 text-sm font-medium rounded-md transition-all',
                        active ? 'text-primary bg-primary/10' : 'text-foreground/70 hover:text-primary hover:bg-primary/5'
                      )}
                    >
                      {item.label}
                    </Link>
                  )
                }

                const active = isGoogleActive

                return (
                  <div key={item.href} className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setOpenDropdown((o) => !o)}
                      className={cn(
                        'px-3 py-2 text-sm font-medium rounded-md transition-all inline-flex items-center gap-1',
                        active ? 'text-primary bg-primary/10' : 'text-foreground/70 hover:text-primary hover:bg-primary/5'
                      )}
                    >
                      {item.label}
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {openDropdown && (
                      <div className="absolute left-0 mt-2 min-w-[180px] rounded-lg border border-border bg-card shadow-lg py-2">
                        {item.dropdown.map((sub) => {
                          const subActive = isActive(sub.href)
                          return (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              className={cn(
                                'block px-4 py-2 text-sm transition-colors',
                                subActive ? 'text-primary' : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                              )}
                              onClick={() => setOpenDropdown(false)}
                            >
                              {sub.label}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <Link
            href="/settings"
            className={cn(
              'p-2 rounded-md transition-all',
              pathname === '/settings' ? 'text-primary bg-primary/10' : 'text-foreground/70 hover:text-primary hover:bg-primary/5'
            )}
          >
            <Settings size={20} />
          </Link>
        </div>
      </div>
    </nav>
  )
}
