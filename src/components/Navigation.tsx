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
  { label: 'Vessel Funnel', href: '/vessel-funnel' }
] as const

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

  const isActive = (href: string) => pathname === href || (href === '/overview' && pathname === '/')
  const isGoogleActive = ['/google-ads', '/terms', '/ad-groups', '/budget-pacing', '/landing-pages', '/data-insights'].includes(pathname)

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto px-6 h-16 flex items-center">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-8">
            {/* Logo - Goolets branding */}
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <div className="flex flex-col">
                <span className="font-bold text-xl text-foreground tracking-tight">GOOLETS</span>
                <span className="text-xs text-muted-foreground font-sans uppercase tracking-wider">AI Agent</span>
              </div>
            </Link>

            {/* Navigation Links */}
            <div className="flex items-center space-x-1">
              {navItems.map((item) => {
                if (!item.dropdown) {
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
                      <div className="absolute left-0 mt-2 min-w-[180px] rounded-lg border border-gray-200 bg-white shadow-lg py-2">
                        {item.dropdown.map((sub) => {
                          const subActive = isActive(sub.href)
                          return (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              className={cn(
                                'block px-4 py-2 text-sm transition-colors',
                                subActive ? 'text-[#B39262]' : 'text-foreground/80 hover:bg-gray-50 hover:text-foreground'
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

          {/* Settings */}
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