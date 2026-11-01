import { clips } from '@/lib/store'

// The clip pool is shared by the Basic and Advanced editors. A clip (and the
// object URL backing its preview) may be released only when nothing can reach
// it anymore: neither editor's live state nor any entry on either editor's
// undo/redo stacks. Each editor registers a provider that yields every clip id
// it can still reach; collectUnusedClips() releases the rest.

export type ClipReferenceProvider = () => Iterable<string>

const providers = new Set<ClipReferenceProvider>()

export function registerClipReferences(provider: ClipReferenceProvider): () => void {
  providers.add(provider)
  return () => providers.delete(provider)
}

export function referencedClipIds(): Set<string> {
  const ids = new Set<string>()
  for (const provider of providers) {
    for (const id of provider()) ids.add(id)
  }
  return ids
}

// Drop clips no editor can reach and revoke their object URLs. Returns the
// number of clips released.
export function collectUnusedClips(): number {
  const referenced = referencedClipIds()
  const current = clips.value
  const kept = current.filter((clip) => referenced.has(clip.id))
  if (kept.length === current.length) return 0
  for (const clip of current) {
    if (referenced.has(clip.id)) continue
    try {
      URL.revokeObjectURL(clip.objectUrl)
    } catch {
      // Best-effort: revoking an already-revoked URL is harmless.
    }
  }
  clips.value = kept
  return current.length - kept.length
}

// Add a clip to the pool unless one with the same id is already present.
export function addClipToPool(clip: (typeof clips.value)[number]): void {
  if (clips.value.some((existing) => existing.id === clip.id)) return
  clips.value = [...clips.value, clip]
}
