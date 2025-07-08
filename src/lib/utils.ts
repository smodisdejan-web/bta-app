// src/lib/utils.ts 

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$'
}

export const CURRENCY_OPTIONS = [
  { value: '$', label: 'USD ($)' },
  { value: 'A$', label: 'AUD (A$)' },
  { value: 'C$', label: 'CAD (C$)' },
  { value: '€', label: 'EUR (€)' },
  { value: '£', label: 'GBP (£)' }
] as const

export function formatCurrency(value: number, currency: string): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return `${currency}0.00`;
  }
  return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatCurrencyForAxis(value: number, currency: string): string {
  return `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function formatNumber(value: number): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return '-';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })
}

export function formatPercent(value: number): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return '-';
  }
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function formatConversions(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function formatConversionsForAxis(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
