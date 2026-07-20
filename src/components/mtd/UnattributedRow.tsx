'use client'

import React, { useState } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { intFmt } from './mtd-shared'

/**
 * Unattributed / no-UTM row — pinned last after the campaign list.
 * Amber/flagged (not error-red). Spend + CPQL show "—" (nothing attributable).
 * The campaign table + this row sum to the headline totals.
 */
export function UnattributedRow({
  scored,
  quality,
  note,
  sources,
  sourcesNote,
}: {
  scored: number
  quality: number
  note: string
  sources?: string[]
  sourcesNote?: string
}) {
  const [open, setOpen] = useState(false)
  const hasSources = !!sources && sources.length > 0

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => hasSources && setOpen((v) => !v)}
        className={cn(
          'w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left',
          hasSources && 'cursor-pointer hover:bg-amber-50'
        )}
      >
        <div className="flex items-center gap-2 min-w-[240px] flex-1">
          {hasSources && (
            <ChevronRight className={cn('h-4 w-4 text-amber-500 shrink-0 transition-transform', open && 'rotate-90')} />
          )}
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <div>
            <div className="text-sm font-bold text-amber-900">Unattributed / no-UTM</div>
            <div className="text-[11px] text-amber-700">{note}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 ml-auto">
          <Tile label="Spend" value="—" />
          <Tile label="Leads" value={intFmt(scored)} />
          <Tile label="QL" value={intFmt(quality)} />
          <Tile label="CPQL" value="—" />
        </div>
      </button>
      {open && hasSources && (
        <div className="px-4 pb-4 pt-1 border-t border-amber-200">
          {sourcesNote && <p className="text-[11px] text-amber-700 mb-2">{sourcesNote}</p>}
          <p className="text-[11px] font-semibold text-amber-800 mb-2">
            {sources!.length} source variants to fix — team to-do (ad naming → campaign UTM):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sources!.map((s) => (
              <code key={s} className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-white border border-amber-200 text-amber-900 break-all">
                {s}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right min-w-[52px]">
      <div className="text-[9.5px] uppercase tracking-[0.03em] text-amber-600 font-semibold">{label}</div>
      <div className="text-sm font-bold text-amber-900 tabular-nums">{value}</div>
    </div>
  )
}
