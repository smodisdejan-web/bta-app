'use client'

import React, { useState } from 'react'
import { Play, ExternalLink, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { eur, eur2, pct1, cpqlColor, type FbAd } from './mtd-shared'

/* Thumbnail: local `thumb` path if set → else remote thumbnail_url (no-referrer) → else grey placeholder */
function Thumb({ ad }: { ad: FbAd }) {
  const [err, setErr] = useState(false)
  const src = ad.thumb || ad.thumbnail_url || ''
  const showImg = !!src && !err
  return (
    <div className="relative w-[60px] h-[60px] shrink-0">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={60}
          height={60}
          referrerPolicy="no-referrer"
          onError={() => setErr(true)}
          className="w-[60px] h-[60px] rounded-lg object-cover border border-gray-200 bg-gray-50"
        />
      ) : (
        <div className="w-[60px] h-[60px] rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center">
          <ImageIcon className="h-5 w-5 text-gray-300" />
        </div>
      )}
      {ad.is_video && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-black/60 border border-white/40 flex items-center justify-center">
          <Play className="h-3 w-3 text-white" fill="white" />
        </span>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9.5px] uppercase tracking-[0.03em] text-gray-400 font-semibold">{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  )
}

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: 'Learn more',
  SIGN_UP: 'Sign up',
  GET_QUOTE: 'Get quote',
  BOOK_TRAVEL: 'Book now',
  CONTACT_US: 'Contact us',
  MESSAGE_PAGE: 'Send message',
  SUBSCRIBE: 'Subscribe',
  APPLY_NOW: 'Apply now',
  DOWNLOAD: 'Download',
  NO_BUTTON: 'No button',
}

export function CreativeCard({ ad, turkey }: { ad: FbAd; turkey: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const body = ad.body || ''
  const longBody = body.length > 150
  const active = ad.status === 'ACTIVE'
  const ctaLabel = ad.cta ? (CTA_LABELS[ad.cta] || ad.cta.replace(/_/g, ' ').toLowerCase()) : null

  return (
    <div className="bg-white rounded-xl border shadow-sm p-3 flex flex-col gap-2.5">
      {/* Top: thumb + name + status */}
      <div className="flex gap-3">
        <Thumb ad={ad} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <span className="text-[13px] font-bold text-gray-900 leading-snug line-clamp-2" title={ad.name}>{ad.name}</span>
          </div>
          <span
            className={cn(
              'inline-flex mt-1 text-[9.5px] font-bold tracking-wide px-1.5 py-0.5 rounded',
              active ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-gray-100 text-gray-500'
            )}
          >
            {active ? 'ACTIVE' : 'PAUSED'}
          </span>
        </div>
      </div>

      {/* 6-stat grid */}
      <div className="grid grid-cols-3 gap-x-1 gap-y-2 py-2 border-y border-gray-100">
        <Stat label="Spend" value={eur(ad.spend)} />
        <Stat label="Leads" value={ad.landing_leads.toLocaleString('en-US')} />
        <Stat label="CPL" value={ad.cpl > 0 ? eur2(ad.cpl) : '–'} tone={ad.cpl > 0 ? cpqlColor(ad.cpl, turkey) : undefined} />
        <Stat label="CTR" value={pct1(ad.ctr)} />
        <Stat label="Play rate" value={ad.hook_rate != null ? pct1(ad.hook_rate * 100) : '–'} />
        <Stat label="ThruPlay" value={ad.hold_rate != null ? pct1(ad.hold_rate * 100) : '–'} />
      </div>

      {/* Copy block */}
      {(ad.title || body) && (
        <div>
          {ad.title && <div className="text-[12.5px] font-bold text-gray-900 leading-snug mb-1">{ad.title}</div>}
          {body && (
            <p className={cn('text-[12px] text-gray-600 leading-relaxed whitespace-pre-line', !expanded && 'line-clamp-4')}>
              {body}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {longBody && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[11.5px] font-semibold text-[#B39262] hover:text-[#96743c]"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
            {ctaLabel && (
              <span className="text-[9.5px] font-bold tracking-[0.05em] uppercase px-1.5 py-0.5 rounded bg-[#B39262]/10 text-[#8B7355]">
                {ctaLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Drive link */}
      {ad.drive_url && (
        <a
          href={ad.drive_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#B39262]/10 text-[#8B7355] border border-[#B39262]/25 hover:bg-[#B39262]/15 transition"
        >
          <ExternalLink className="h-3 w-3" />
          Source video{ad.drive_confidence === 'medium' ? ' (similar cut)' : ''}
        </a>
      )}
    </div>
  )
}
