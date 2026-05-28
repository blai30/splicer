import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

import { info, debug, warn, error as logError } from '@/lib/logger'
import { assetPath } from '@/lib/paths'
import { ffmpegProgress, ffmpegReady, getClipById } from '@/lib/store'
import type { ExportFormat, Framerate, Quality, Segment } from '@/lib/types'
import { MIME_TYPES } from '@/lib/types'

let instance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

async function deleteFilesBestEffort(ffmpeg: FFmpeg, files: string[]): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      try {
        await ffmpeg.deleteFile(file)
      } catch {
        // Best effort cleanup for temporary virtual files.
      }
    })
  )
}

function canUseStreamCopy(segments: Segment[], format: ExportFormat): boolean {
  if (segments.length === 0) return false

  const sourceExtensions = new Set<string>()

  for (const segment of segments) {
    if (segment.crop) return false
    if (segment.muted) return false
    const clip = getClipById(segment.clipId)
    if (!clip) return false
    sourceExtensions.add(getFileExtension(clip.file.name))
  }

  // Same container -> stream copy
  if (sourceExtensions.size === 1 && sourceExtensions.has(format)) return true

  // MP4 -> MKV remux works (h264 + aac are valid MKV codecs)
  // MP4 -> WEBM does NOT work (webm muxer rejects h264/aac, requires VP8/VP9)
  if (sourceExtensions.size === 1 && sourceExtensions.has('mp4') && format === 'mkv') return true

  return false
}

export async function getFfmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  if (!loadingPromise) {
    const ffmpeg = new FFmpeg()
    info('Initializing FFmpeg')
    ffmpeg.on('log', ({ message }) => {
      debug('ffmpeg log', { message })
      console.log('[FFMPEG]', message)
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('notfound')) {
        logError('ffmpeg log error', { message })
      }
    })
    ffmpeg.on('progress', ({ progress }) => {
      ffmpegProgress.value = progress
      debug('ffmpeg progress', { progress })
    })
    loadingPromise = ffmpeg
      .load({
        coreURL: assetPath('ffmpeg/ffmpeg-core.js'),
        wasmURL: assetPath('ffmpeg/ffmpeg-core.wasm'),
      })
      .then(() => {
        instance = ffmpeg
        ffmpegReady.value = true
        info('FFmpeg ready')
        return ffmpeg
      })
      .catch((err) => {
        loadingPromise = null
        logError('FFmpeg load failed', {
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      })
  }
  return loadingPromise
}

function getOutputArgs(format: ExportFormat, quality: Quality, fps: Framerate): string[] {
  const fpsArgs = fps !== 'original' ? ['-r', fps] : []

  if (format === 'webm') {
    const crf: Record<Quality, string> = { lossless: '0', high: '20', medium: '31', low: '41' }
    const deadline: Record<Quality, string> = {
      lossless: 'best',
      high: 'good',
      medium: 'good',
      low: 'realtime',
    }
    return [
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      crf[quality],
      '-deadline',
      deadline[quality],
      '-c:a',
      'libopus',
      ...fpsArgs,
    ]
  }

  const crf: Record<Quality, string> = { lossless: '0', high: '18', medium: '23', low: '28' }
  const preset: Record<Quality, string> = {
    lossless: 'lossless',
    high: 'medium',
    medium: 'fast',
    low: 'fast',
  }
  return [
    '-c:v',
    'libx264',
    '-crf',
    crf[quality],
    '-preset',
    preset[quality],
    '-c:a',
    'aac',
    ...fpsArgs,
  ]
}

export function cancelExport(): void {
  if (instance) {
    instance.terminate()
    instance = null
    ffmpegReady.value = false
  }
  loadingPromise = null
  ffmpegProgress.value = 0
  warn('Export cancelled / FFmpeg terminated')
}

async function exec(ffmpeg: FFmpeg, args: string[]): Promise<void> {
  info('Running ffmpeg', { args })
  console.log('[FFMPEG CMD]', args.join(' '))
  const ret = await ffmpeg.exec(args)
  if (ret !== 0) {
    logError('FFmpeg error', { code: ret, args })
    throw new Error(`FFmpeg error (code ${ret})`)
  }
}

// Shared helper: write all segment files and build a concat demuxer list.
async function buildConcatList(
  ffmpeg: FFmpeg,
  segments: Segment[],
  runId: string
): Promise<{ inputFiles: string[]; concatList: string }> {
  const inputFiles: string[] = []
  let concatList = ''

  for (const segment of segments) {
    const clip = getClipById(segment.clipId)
    if (!clip) continue

    const ext = getFileExtension(clip.file.name) || 'mp4'
    const fname = `input_${runId}_${inputFiles.length}.${ext}`
    await ffmpeg.writeFile(fname, await fetchFile(clip.file))
    inputFiles.push(fname)

    concatList += `file '${fname}'\n`
    concatList += `inpoint ${segment.startTime}\n`
    concatList += `outpoint ${segment.endTime}\n`
  }

  return { inputFiles, concatList }
}

// Stream-copy path: remux without re-encoding using the concat demuxer.
// Near-instant, no quality loss, output size matches source.
async function exportStreamCopy(
  segments: Segment[],
  format: ExportFormat
): Promise<{ url: string; size: number }> {
  const ffmpeg = await getFfmpeg()
  ffmpegProgress.value = 0

  const runId = crypto.randomUUID().replace(/-/g, '')
  const tempFiles: string[] = []
  const concatFile = `concat_${runId}.txt`
  const outputFile = `output_${runId}.${format}`

  try {
    const { inputFiles, concatList } = await buildConcatList(ffmpeg, segments, runId)
    if (inputFiles.length === 0) throw new Error('No valid segments')
    tempFiles.push(...inputFiles)

    await ffmpeg.writeFile(concatFile, concatList)
    tempFiles.push(concatFile)

    await exec(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputFile])
    // Finalizing: reading output from WASM FS can take noticeable time.
    // Keep progress near-complete but not 100% until readFile finishes.
    ffmpegProgress.value = 0.95
    // Instrumentation: log read start/finish and duration to help diagnose hangs.
    console.log('[FFMPEG] readFile start', outputFile)
    const t0 = performance.now()
    const data = await ffmpeg.readFile(outputFile)
    const t1 = performance.now()
    console.log('[FFMPEG] readFile finished', outputFile, 'duration_ms', Math.round(t1 - t0))
    const blob = new Blob([data as BlobPart], { type: MIME_TYPES[format] })
    ffmpegProgress.value = 1
    return { url: URL.createObjectURL(blob), size: blob.size }
  } finally {
    await deleteFilesBestEffort(ffmpeg, [...tempFiles, outputFile])
  }
}

// Muted stream-copy path: stream-copies video (no re-encode) and re-encodes only
// audio with volume=0 applied to the muted segment time ranges.
// Much faster than full video re-encode for the common mute use case.
async function exportMuteStreamCopy(
  segments: Segment[],
  format: ExportFormat
): Promise<{ url: string; size: number }> {
  const ffmpeg = await getFfmpeg()
  ffmpegProgress.value = 0

  const runId = crypto.randomUUID().replace(/-/g, '')
  const tempFiles: string[] = []
  const concatFile = `concat_${runId}.txt`
  const tempCopyFile = `temp_${runId}.${format}`
  const outputFile = `output_${runId}.${format}`

  // Compute which output time ranges should be muted.
  let outputTime = 0
  const mutedRanges: Array<[number, number]> = []
  for (const segment of segments) {
    const segmentDuration = segment.endTime - segment.startTime
    if (segment.muted) mutedRanges.push([outputTime, outputTime + segmentDuration])
    outputTime += segmentDuration
  }

  try {
    const { inputFiles, concatList } = await buildConcatList(ffmpeg, segments, runId)
    if (inputFiles.length === 0) throw new Error('No valid segments')
    tempFiles.push(...inputFiles)

    // Pass 1: stream copy all segments into a single temp file.
    await ffmpeg.writeFile(concatFile, concatList)
    tempFiles.push(concatFile)
    await exec(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', tempCopyFile])
    tempFiles.push(tempCopyFile)
    ffmpegProgress.value = 0.5

    // Pass 2: stream-copy video, re-encode audio with mute applied to the computed ranges.
    const muteExpr = mutedRanges.map(([s, e]) => `between(t,${s},${e})`).join('+')
    const audioCodec = format === 'webm' ? 'libopus' : 'aac'
    await exec(ffmpeg, [
      '-i',
      tempCopyFile,
      '-c:v',
      'copy',
      '-af',
      `volume=0:enable='${muteExpr}'`,
      '-c:a',
      audioCodec,
      outputFile,
    ])
    // Finalizing: reading output from WASM FS can take noticeable time.
    ffmpegProgress.value = 0.95
    // Instrumentation: log read start/finish and duration to help diagnose hangs.
    console.log('[FFMPEG] readFile start', outputFile)
    const t0 = performance.now()
    const data = await ffmpeg.readFile(outputFile)
    const t1 = performance.now()
    console.log('[FFMPEG] readFile finished', outputFile, 'duration_ms', Math.round(t1 - t0))
    const blob = new Blob([data as BlobPart], { type: MIME_TYPES[format] })
    ffmpegProgress.value = 1
    return { url: URL.createObjectURL(blob), size: blob.size }
  } finally {
    await deleteFilesBestEffort(ffmpeg, [...tempFiles, outputFile])
  }
}

export async function exportVideo(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<{ url: string; size: number }> {
  if (segments.length === 0) throw new Error('No segments')

  // Helper: attempt export and on WASM OOM restart ffmpeg and retry once.
  async function attemptWithRestart<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg && msg.toLowerCase().includes('memory access out of bounds')) {
        // Restart FFmpeg instance and retry once.
        console.warn('[FFMPEG] memory OOB detected — restarting ffmpeg and retrying')
        try {
          if (instance) {
            try {
              instance.terminate()
            } catch {}
            instance = null
          }
          loadingPromise = null
          ffmpegReady.value = false
          // Ensure new instance is loaded before retrying
          await getFfmpeg()
        } catch (restartErr) {
          console.error('[FFMPEG] failed to restart ffmpeg', restartErr)
          throw err
        }
      }
      throw err
    }
  }

  // Use stream copy when lossless + original fps + no per-segment muting
  if (quality === 'lossless' && fps === 'original' && canUseStreamCopy(segments, format)) {
    return attemptWithRestart(() => exportStreamCopy(segments, format))
  }

  // Muted stream copy: video stays lossless, only audio is re-encoded (fast).
  // Applies when lossless + original fps + at least one muted segment + no crop + matching format.
  const hasMuted = segments.some((segment) => segment.muted)
  if (quality === 'lossless' && fps === 'original' && hasMuted) {
    const canMutedCopy = segments.every((segment) => {
      if (segment.crop) return false
      const clip = getClipById(segment.clipId)
      return clip != null && getFileExtension(clip.file.name) === format
    })
    if (canMutedCopy) return attemptWithRestart(() => exportMuteStreamCopy(segments, format))
  }

  const ffmpeg = await getFfmpeg()
  ffmpegProgress.value = 0

  const runId = crypto.randomUUID().replace(/-/g, '')
  const inputFiles: string[] = []
  const tempFiles: string[] = []
  const filterParts: string[] = []
  const concatInputs: string[] = []
  let streamIndex = 0

  const outputFile = `output_${runId}.${format}`

  try {
    for (const segment of segments) {
      const clip = getClipById(segment.clipId)
      if (!clip) continue

      const ext = getFileExtension(clip.file.name) || 'mp4'
      const fname = `input_${runId}_${streamIndex}.${ext}`
      await ffmpeg.writeFile(fname, await fetchFile(clip.file))
      inputFiles.push(fname)
      tempFiles.push(fname)

      let videoFilter = `[${streamIndex}:v]trim=${segment.startTime}:${segment.endTime},setpts=PTS-STARTPTS`
      if (segment.crop) {
        const { x, y, width, height } = segment.crop
        videoFilter += `,crop=${width}:${height}:${x}:${y}`
      }
      videoFilter += `[v${streamIndex}]`

      let audioFilter = `[${streamIndex}:a]atrim=${segment.startTime}:${segment.endTime},asetpts=PTS-STARTPTS`
      if (segment.muted) {
        audioFilter += ',volume=0'
      }
      audioFilter += `[a${streamIndex}]`

      filterParts.push(videoFilter, audioFilter)
      concatInputs.push(`[v${streamIndex}][a${streamIndex}]`)
      streamIndex++
    }

    if (streamIndex === 0) throw new Error('No valid segments')

    // Skip the concat filter for a single segment — it's unnecessary and can hang in WASM.
    const filterComplex =
      streamIndex === 1
        ? filterParts.join(';').replace('[v0]', '[outv]').replace('[a0]', '[outa]')
        : filterParts.join(';') +
          `;${concatInputs.join('')}concat=n=${streamIndex}:v=1:a=1[outv][outa]`

    const inputArgs = inputFiles.flatMap((f) => ['-i', f])

    await exec(ffmpeg, [
      ...inputArgs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[outv]',
      '-map',
      '[outa]',
      ...getOutputArgs(format, quality, fps),
      outputFile,
    ])

    // Finalizing: reading output from WASM FS can take noticeable time.
    return attemptWithRestart(async () => {
      ffmpegProgress.value = 0.95
      // Instrumentation: log read start/finish and duration to help diagnose hangs.
      console.log('[FFMPEG] readFile start', outputFile)
      const t0 = performance.now()
      const data = await ffmpeg.readFile(outputFile)
      const t1 = performance.now()
      console.log('[FFMPEG] readFile finished', outputFile, 'duration_ms', Math.round(t1 - t0))
      const blob = new Blob([data as BlobPart], { type: MIME_TYPES[format] })
      ffmpegProgress.value = 1
      return { url: URL.createObjectURL(blob), size: blob.size }
    })
  } finally {
    await deleteFilesBestEffort(ffmpeg, [...tempFiles, outputFile])
  }
}
