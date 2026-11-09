// Goolets CPQL Zone Framework — shared thresholds, classifiers, and visual styles.
// Source of truth for SCALE/MAINTAIN/OPTIMIZE/CUT zone classification across the app.
// Thresholds derived from Goolets knowledge base.

export type Zone = 'scale' | 'maintain' | 'optimize' | 'cut'

export const CAC_THRESHOLDS = { scale: 96, maintain: 150, optimize: 240 } // €
export const ROAS_THRESHOLDS = { cut: 2, optimize: 2.8, maintain: 4 } // x (2.8 = ROMI break-even)
export const AI_SCORE_THRESHOLDS = { cut: 40, optimize: 48, maintain: 55 }
export const QL_RATE_THRESHOLDS = { cut: 35, optimize: 45, maintain: 55 } // %

/**
 * CPQL / CAC zone. Returns null when there is nothing to grade: a missing value, or a zero
 * that only ever means "no quality leads / no spend measured yet". It used to answer
 * 'maintain' for 0, so a dead feed painted a calm gold MAINTAIN badge over a number nobody
 * had measured. No measurement, no zone.
 */
export function zoneForCac(value: number | null | undefined): Zone | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  if (value < CAC_THRESHOLDS.scale) return 'scale'
  if (value < CAC_THRESHOLDS.maintain) return 'maintain'
  if (value < CAC_THRESHOLDS.optimize) return 'optimize'
  return 'cut'
}

export function zoneForRoas(value: number): Zone {
  if (value >= ROAS_THRESHOLDS.maintain) return 'scale'
  if (value >= ROAS_THRESHOLDS.optimize) return 'maintain'
  if (value >= ROAS_THRESHOLDS.cut) return 'optimize'
  return 'cut'
}

export function zoneForAiScore(value: number): Zone {
  if (value >= AI_SCORE_THRESHOLDS.maintain) return 'scale'
  if (value >= AI_SCORE_THRESHOLDS.optimize) return 'maintain'
  if (value >= AI_SCORE_THRESHOLDS.cut) return 'optimize'
  return 'cut'
}

/**
 * CPEL = spend / Excellent lead (Streak AI score >= 70). November 2026 KPI (Dejan, 9.11.2026):
 * < EUR 133 green, EUR 133-333 amber, > EUR 333 red. Three bands only, so `maintain` is unused.
 */
export const CPEL_THRESHOLDS = { scale: 133, optimize: 333 } // EUR

export function zoneForCpel(value: number | null | undefined): Zone | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  if (value < CPEL_THRESHOLDS.scale) return 'scale'
  if (value <= CPEL_THRESHOLDS.optimize) return 'optimize'
  return 'cut'
}

export const CPEL_ZONE_LABEL: Partial<Record<Zone, string>> = {
  scale: 'ON KPI (<€133)',
  optimize: 'WATCH (€133–333)',
  cut: 'OVER (>€333)'
}

export function zoneForQlRate(value: number): Zone {
  if (value >= QL_RATE_THRESHOLDS.maintain) return 'scale'
  if (value >= QL_RATE_THRESHOLDS.optimize) return 'maintain'
  if (value >= QL_RATE_THRESHOLDS.cut) return 'optimize'
  return 'cut'
}

export const ZONE_STYLES: Record<Zone, { border: string; bg: string; text: string; label: string }> = {
  scale: { border: '#047857', bg: '#ecfdf5', text: '#047857', label: 'SCALE' },
  maintain: { border: '#B39262', bg: '#fbf6ea', text: '#8B7355', label: 'MAINTAIN' },
  optimize: { border: '#d97706', bg: '#fef3c7', text: '#92400e', label: 'OPTIMIZE' },
  cut: { border: '#dc2626', bg: '#fef2f2', text: '#991b1b', label: 'CUT' }
}
