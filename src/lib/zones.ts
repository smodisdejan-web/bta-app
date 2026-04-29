// Goolets CPQL Zone Framework — shared thresholds, classifiers, and visual styles.
// Source of truth for SCALE/MAINTAIN/OPTIMIZE/CUT zone classification across the app.
// Thresholds derived from Goolets knowledge base.

export type Zone = 'scale' | 'maintain' | 'optimize' | 'cut'

export const CAC_THRESHOLDS = { scale: 96, maintain: 150, optimize: 240 } // €
export const ROAS_THRESHOLDS = { cut: 2, optimize: 2.8, maintain: 4 } // x (2.8 = ROMI break-even)
export const AI_SCORE_THRESHOLDS = { cut: 40, optimize: 48, maintain: 55 }
export const QL_RATE_THRESHOLDS = { cut: 35, optimize: 45, maintain: 55 } // %

export function zoneForCac(value: number): Zone {
  if (value === 0) return 'maintain'
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
