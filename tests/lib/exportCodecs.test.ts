import { describe, expect, it } from 'vitest'

import { selectCodecs, WEBCODECS_FORMATS } from '@/lib/exportCodecs'

describe('selectCodecs', () => {
  it('maps mp4 and mov to H.264 + AAC', () => {
    expect(selectCodecs('mp4', 'vp9', 'h264')).toEqual({
      container: 'mp4',
      videoCodec: 'avc',
      audioCodec: 'aac',
    })
    expect(selectCodecs('mov', 'vp9', 'h264')).toEqual({
      container: 'mov',
      videoCodec: 'avc',
      audioCodec: 'aac',
    })
  })

  it('maps webm to the chosen VP codec + Opus', () => {
    expect(selectCodecs('webm', 'vp9', 'h264')).toEqual({
      container: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    })
    expect(selectCodecs('webm', 'vp8', 'h264').videoCodec).toBe('vp8')
  })

  it('maps mkv per the mkv codec choice', () => {
    expect(selectCodecs('mkv', 'vp9', 'h264')).toEqual({
      container: 'mkv',
      videoCodec: 'avc',
      audioCodec: 'aac',
    })
    expect(selectCodecs('mkv', 'vp9', 'vp9')).toEqual({
      container: 'mkv',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    })
  })

  it('lists every WebCodecs-handled format', () => {
    expect(WEBCODECS_FORMATS).toEqual(['mp4', 'mov', 'mkv', 'webm'])
  })
})
