import { getClipById } from '@/lib/store'
import type { AdvancedSegment, Track } from '@/lib/types'

export type MixedAudio = {
  sampleRate: number
  channelData: Float32Array[]
}

const OUTPUT_SAMPLE_RATE = 48000
const OUTPUT_CHANNELS = 2

// Decode each source once, place every audible segment at its timelineStart with
// per-clip and per-track gain, and render the sum offline. Returns the mixed
// planar PCM, or null when nothing is audible.
export async function mixAdvancedAudio(
  segments: AdvancedSegment[],
  tracks: Track[],
  durationSec: number
): Promise<MixedAudio | null> {
  if (durationSec <= 0) return null
  const mutedTracks = new Set(tracks.filter((track) => track.muted).map((track) => track.id))
  const audible = segments.filter((segment) => !segment.muted && !mutedTracks.has(segment.trackId))
  if (audible.length === 0) return null

  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return null

  const decodeCtx = new AudioCtx()
  const decoded = new Map<string, AudioBuffer | null>()
  try {
    for (const segment of audible) {
      if (decoded.has(segment.clipId)) continue
      const clip = getClipById(segment.clipId)
      if (!clip) {
        decoded.set(segment.clipId, null)
        continue
      }
      try {
        decoded.set(segment.clipId, await decodeCtx.decodeAudioData(await clip.file.arrayBuffer()))
      } catch {
        decoded.set(segment.clipId, null)
      }
    }
  } finally {
    void decodeCtx.close()
  }

  const lengthFrames = Math.ceil(durationSec * OUTPUT_SAMPLE_RATE)
  const offline = new OfflineAudioContext(OUTPUT_CHANNELS, lengthFrames, OUTPUT_SAMPLE_RATE)
  let placed = 0
  for (const segment of audible) {
    const buffer = decoded.get(segment.clipId)
    if (!buffer) continue
    const source = offline.createBufferSource()
    source.buffer = buffer
    const gain = offline.createGain()
    gain.gain.value = segment.volume ?? 1
    source.connect(gain).connect(offline.destination)
    const clipDuration = Math.max(0, segment.sourceEnd - segment.sourceStart)
    source.start(segment.timelineStart, segment.sourceStart, clipDuration)
    placed++
  }
  if (placed === 0) return null

  const rendered = await offline.startRendering()
  const channelData: Float32Array[] = []
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    channelData.push(new Float32Array(rendered.getChannelData(channel)))
  }
  return { sampleRate: rendered.sampleRate, channelData }
}
