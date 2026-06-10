import type { ExportFormat, MkvCodec, WebmCodec } from '@/lib/types'

// mediabunny codec ids (string unions in mediabunny's VideoCodec/AudioCodec).
export type MbVideoCodec = 'avc' | 'vp9' | 'vp8'
export type MbAudioCodec = 'aac' | 'opus'
export type MbContainer = 'mp4' | 'mov' | 'mkv' | 'webm'

export type CodecSelection = {
  container: MbContainer
  videoCodec: MbVideoCodec
  audioCodec: MbAudioCodec
}

// Formats the WebCodecs/mediabunny engine handles. Anything else uses ffmpeg.
export const WEBCODECS_FORMATS: ExportFormat[] = ['mp4', 'mov', 'mkv', 'webm']

export function selectCodecs(
  format: ExportFormat,
  webmCodec: WebmCodec,
  mkvCodec: MkvCodec
): CodecSelection {
  if (format === 'webm') {
    return { container: 'webm', videoCodec: webmCodec, audioCodec: 'opus' }
  }
  if (format === 'mkv') {
    return mkvCodec === 'vp9'
      ? { container: 'mkv', videoCodec: 'vp9', audioCodec: 'opus' }
      : { container: 'mkv', videoCodec: 'avc', audioCodec: 'aac' }
  }
  // mp4, mov
  return { container: format, videoCodec: 'avc', audioCodec: 'aac' }
}
