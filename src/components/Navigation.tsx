'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Settings } from 'lucide-react'


export function Navigation() {
    const pathname = usePathname()

    return (
        <nav className="fixed top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="container mx-auto px-6 h-16 flex items-center">
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center space-x-8">
                        {/* Logo - Goolets branding */}
                        <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
                            <div className="flex flex-col">
                                <span className="font-bold text-xl text-foreground tracking-tight">
                                    GOOLETS
                                </span>
                                <span className="text-xs text-muted-foreground font-sans uppercase tracking-wider">
                                    AI Agent
                                </span>
                            </div>
                        </Link>
                        
                        {/* Navigation Links */}
                        <div className="flex items-center space-x-1">
                            <Link
                                href="/terms"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/terms" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Search Terms
                            </Link>
                            <Link
                                href="/adgroups"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/adgroups" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Ad Groups
                            </Link>
                            <Link
                                href="/budgets"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/budgets" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Budget Pacing
                            </Link>
                            <Link
                                href="/landing-pages"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/landing-pages" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Landing Pages
                            </Link>
                            <Link
                                href="/insights"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/insights" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Data Insights
                            </Link>
                            <Link
                                href="/overview"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/overview" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Overview
                            </Link>
                            <Link
                                href="/facebook-ads"
                                className={cn(
                                    "px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pathname === "/facebook-ads" 
                                        ? "text-primary bg-primary/10" 
                                        : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                                )}
                            >
                                Facebook Ads
                            </Link>
                        </div>
                    </div>
                    
                    {/* Settings */}
                    <Link
                        href="/settings"
                        className={cn(
                            "p-2 rounded-md transition-all",
                            pathname === "/settings" 
                                ? "text-primary bg-primary/10" 
                                : "text-foreground/70 hover:text-primary hover:bg-primary/5"
                        )}
                    >
                        <Settings size={20} />
                    </Link>
                </div>
            </div>
        </nav>
    )
} 