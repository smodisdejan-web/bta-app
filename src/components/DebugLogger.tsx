'use client'

import { useEffect } from 'react'

export default function DebugLogger(props: any) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[Overview Debug]', props)
  }, [props])

  return null
}

