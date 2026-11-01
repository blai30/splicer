import { canEncodeAudio } from 'mediabunny'

import type { MbAudioCodec } from '../exportCodecs'

type AacEncoderModule = { registerAacEncoder: () => void }

// The WASM AAC encoder is most of an export worker's code, and only browsers
// without a native AAC encoder (notably Firefox) need it, so it loads on demand
// into its own chunk instead of with every worker.
export async function ensureAacEncoder(
  audioCodec: MbAudioCodec,
  canEncodeNatively: (codec: 'aac') => Promise<boolean> = canEncodeAudio,
  loadEncoder: () => Promise<AacEncoderModule> = () => import('@mediabunny/aac-encoder')
): Promise<boolean> {
  if (audioCodec !== 'aac' || (await canEncodeNatively('aac'))) return false
  const { registerAacEncoder } = await loadEncoder()
  registerAacEncoder()
  return true
}
