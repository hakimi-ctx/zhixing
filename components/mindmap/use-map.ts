'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MapController, MapState } from './controller'

export function useMapState(controller: MapController): MapState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
}

/**
 * Local text for a panel field that writes through on every keystroke. The draft follows the map
 * (undo, another topic selected) only while the field is not being typed in, so the caret never jumps.
 */
export function useDraft(value: string): [string, (next: string) => void, React.RefObject<HTMLElement | null>] {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (ref.current && ref.current === document.activeElement) return
    setDraft(value)
  }, [value])
  return [draft, setDraft, ref]
}
