'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Settings } from 'lucide-react'


export function Navigation() {
    const pathname = usePathname()

    return (
        <nav className="fixed top-0 z-50 w-full border-b bg-white">
            <div className="container mx-auto px-4 h-16 flex items-center">
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center space-x-6">
                        <Link href="/" className="flex items-center">
                            <span className="font-bold">
                                Google Ads Dashboard
                            </span>
                        </Link>
                        <Link
                            href="/terms"
                            className={cn(
                                "text-sm font-medium transition-colors hover:text-foreground/80",
                                pathname === "/terms" ? "text-foreground" : "text-foreground/60"
                            )}
                        >
                            Search Terms
                        </Link>
                        <Link
                            href="/adgroups"
                            className={cn(
                                "text-sm font-medium transition-colors hover:text-foreground/80",
                                pathname === "/adgroups" ? "text-foreground" : "text-foreground/60"
                            )}
                        >
                            Ad Groups
                        </Link>
                        <Link
                            href="/data-test"
                            className={cn(
                                "text-sm font-medium transition-colors hover:text-foreground/80",
                                pathname === "/data-test" ? "text-foreground" : "text-foreground/60"
                            )}
                        >
                            Data Test
                        </Link>
                    </div>
                    <Link
                        href="/settings"
                        className={cn(
                            "transition-colors hover:text-foreground/80",
                            pathname === "/settings" ? "text-foreground" : "text-foreground/60"
                        )}
                    >
                        <Settings size={20} />
                    </Link>
                </div>
            </div>
        </nav>
    )
} 