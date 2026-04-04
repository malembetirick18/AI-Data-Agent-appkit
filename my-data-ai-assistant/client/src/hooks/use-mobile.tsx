'use client'

import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768

// Module-level singleton — one MediaQueryList shared across all subscribers.
const mql = typeof window !== 'undefined'
  ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  : null

const subscribe = (cb: () => void) => {
  mql?.addEventListener('change', cb)
  return () => mql?.removeEventListener('change', cb)
}

// mql.matches is computed by the browser and cached — no layout reflow needed.
const getSnapshot = () => mql?.matches ?? false

const getServerSnapshot = () => false

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
