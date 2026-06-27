import { useSyncExternalStore } from 'react'

let activeCharacterId: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): string | null {
  return activeCharacterId
}

/** Tracks the character the user last opened in Chat (route or tab). */
export function setActiveCharacterId(id: string | null): void {
  if (activeCharacterId === id) return
  activeCharacterId = id
  listeners.forEach((listener) => listener())
}

export function useActiveCharacterId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
