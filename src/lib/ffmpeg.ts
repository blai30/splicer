import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

import { EtaTracker } from '@/lib/exportEta'
import { nextRecoveryStep } from '@/lib/exportRecovery'
import { encodeOptionsFor, isolationAvailable, computeThreadCount } from '@/lib/ffmpegCapabilities'
import type { CoreMode, EncodeOptions } from '@/lib/ffmpegCapabilities'
import { info, debug, warn, error as logError } from '@/lib/logger'
import { assetPath } from '@/lib/paths'
import {
  coreMode,
  coreModeReason,
  exportEtaSeconds,
  ffmpegProgress,
  ffmpegReady,
  getClipById,
  webmCodec,
} from '@/lib/store'
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
  const audioPresence = new Set<boolean>()

  for (const segment of segments) {
    if (segment.crop) return false
    if (segment.muted) return false
    const clip = getClipById(segment.clipId)
    if (!clip) return false
    sourceExtensions.add(getFileExtension(clip.file.name))
    audioPresence.add(clip.hasAudio !== false)
  }

  // The concat demuxer needs a uniform stream layout; mixing clips with and
  // without audio produces broken output.
  if (audioPresence.size > 1) return false

  // Same container -> stream copy
  if (sourceExtensions.size === 1 && sourceExtensions.has(format)) return true

  // MP4 -> MKV or MP4 -> MOV remux works (h264 + aac are valid MKV/MOV codecs)
  // MP4 -> WEBM does NOT work (webm muxer rejects h264/aac, requires VP8/VP9)
  if (
    sourceExtensions.size === 1 &&
    sourceExtensions.has('mp4') &&
    (format === 'mkv' || format === 'mov')
  )
    return true

  return false
}

// Sticky for the rest of the session once a runtime MT failure forces a
// downgrade; survives restartFfmpeg so we do not re-probe back into MT.
let forceSingleThread = false

// A wedged MT worker may never resolve OR reject load()/exec(); bound the probe
// so a hang falls back to single-thread instead of bricking the whole app.
const MT_PROBE_TIMEOUT_MS = 10_000

// Remember a failed MT probe so users do not pay the 10s timeout every session.
// Tagged with the core version so upgrading @ffmpeg/core-mt triggers a re-probe.
const MT_PROBE_VERSION = '0.12.10'
const MT_PROBE_KEY = 'splicer_mt_probe'

function isMtKnownUnsupported(): boolean {
  try {
    return localStorage.getItem(MT_PROBE_KEY) === `unsupported:${MT_PROBE_VERSION}`
  } catch {
    return false
  }
}

function rememberMtUnsupported(): void {
  try {
    localStorage.setItem(MT_PROBE_KEY, `unsupported:${MT_PROBE_VERSION}`)
  } catch {}
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function createInstance(): FFmpeg {
  const ffmpeg = new FFmpeg()
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
  return ffmpeg
}

// Probe MT viability on its own instance: load + a sub-second threaded smoke
// encode, all under a timeout. Returns the ready instance, or null to fall back
// (the throwaway instance is terminated so a partial load cannot leak).
async function tryLoadMultithread(): Promise<FFmpeg | null> {
  const ffmpeg = createInstance()
  try {
    await withTimeout(
      (async () => {
        await ffmpeg.load({
          coreURL: assetPath('ffmpeg/mt/ffmpeg-core.js'),
          wasmURL: assetPath('ffmpeg/mt/ffmpeg-core.wasm'),
          workerURL: assetPath('ffmpeg/mt/ffmpeg-core.worker.js'),
        })
        // Use a realistic frame size and a modest thread count: row-mt across
        // too few pixel rows (e.g. 16x16 with 8 threads) deadlocks libvpx and
        // would reject a perfectly working MT core.
        const threads = String(Math.min(4, Math.max(2, computeThreadCount())))
        const exitCode = await ffmpeg.exec([
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=256x144:d=0.2',
          '-frames:v',
          '3',
          '-c:v',
          'libvpx-vp9',
          '-row-mt',
          '1',
          '-cpu-used',
          '5',
          '-threads',
          threads,
          'smoke.webm',
        ])
        await deleteFilesBestEffort(ffmpeg, ['smoke.webm'])
        if (exitCode !== 0) throw new Error(`smoke exit ${exitCode}`)
      })(),
      MT_PROBE_TIMEOUT_MS,
      'MT core probe'
    )
    return ffmpeg
  } catch (err) {
    warn('MT core probe failed, falling back to single-thread', {
      message: err instanceof Error ? err.message : String(err),
    })
    try {
      ffmpeg.terminate()
    } catch {}
    return null
  }
}

export async function getFfmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  if (!loadingPromise) {
    loadingPromise = (async () => {
      info('Initializing FFmpeg')
      let chosen: FFmpeg | null = null
      let mode: CoreMode = 'singlethread'

      if (!forceSingleThread && !isMtKnownUnsupported() && isolationAvailable()) {
        chosen = await tryLoadMultithread()
        if (chosen) {
          mode = 'multithread'
          coreModeReason.value = ''
        } else {
          // Cache the failure so the next session skips the slow probe entirely.
          rememberMtUnsupported()
          coreModeReason.value = 'Multi-threaded core unavailable in this browser'
        }
      } else if (forceSingleThread) {
        coreModeReason.value = 'Multi-threaded export failed at runtime'
      } else if (isMtKnownUnsupported()) {
        coreModeReason.value = 'Multi-threaded core unavailable in this browser'
      } else {
        coreModeReason.value = 'Cross-origin isolation unavailable'
      }

      if (!chosen) {
        const ffmpeg = createInstance()
        await ffmpeg.load({
          coreURL: assetPath('ffmpeg/ffmpeg-core.js'),
          wasmURL: assetPath('ffmpeg/ffmpeg-core.wasm'),
        })
        chosen = ffmpeg
        mode = 'singlethread'
      }

      instance = chosen
      coreMode.value = mode
      ffmpegReady.value = true
      info('FFmpeg ready', { mode })
      return chosen
    })().catch((err) => {
      loadingPromise = null
      logError('FFmpeg load failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    })
  }
  return loadingPromise
}

function getOutputArgs(
  format: ExportFormat,
  quality: Quality,
  fps: Framerate,
  options: EncodeOptions
): string[] {
  const fpsArgs = fps !== 'original' ? ['-r', fps] : []
  const threadArgs =
    options.threads && options.threads > 1
      ? ['-row-mt', '1', '-threads', String(options.threads)]
      : []

  if (format === 'webm') {
    // VP8: markedly faster to encode than VP9 at a size cost.
    if (options.webmCodec === 'vp8') {
      const vp8Crf: Record<Quality, string> = {
        lossless: '4',
        high: '10',
        medium: '20',
        low: '30',
      }
      return [
        '-c:v',
        'libvpx',
        '-b:v',
        '0',
        '-crf',
        vp8Crf[quality],
        ...threadArgs,
        '-c:a',
        'libopus',
        ...fpsArgs,
      ]
    }

    const crf: Record<Quality, string> = { lossless: '0', high: '20', medium: '31', low: '41' }
    // cpu-used is the real speed/quality dial for libvpx; deadline best is
    // dropped entirely because it does not finish in WASM.
    const cpuUsed: Record<Quality, string> = {
      lossless: '2',
      high: '2',
      medium: '3',
      low: '5',
    }
    const deadline: Record<Quality, string> = {
      lossless: 'good',
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
      '-cpu-used',
      cpuUsed[quality],
      ...threadArgs,
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

  // Format-specific codec choices for browser-forward WASM builds
  if (format === 'avi') {
    // AVI prefers MPEG-4 video and MP3 audio for broad compatibility
    return ['-c:v', 'mpeg4', '-qscale:v', '3', '-c:a', 'libmp3lame', ...fpsArgs]
  }

  if (format === 'mov') {
    // MOV: use H.264 + AAC (compatible with QuickTime)
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
  coreMode.value = null
  ffmpegProgress.value = 0
  warn('Export canceled / FFmpeg terminated')
}

async function exec(ffmpeg: FFmpeg, args: string[]): Promise<void> {
  info('Running ffmpeg', { args })
  console.log('[FFMPEG CMD]', args.join(' '))

  // Keep the most recent log lines so a failure can surface the actual
  // ffmpeg message instead of just an exit code.
  const recentLogs: string[] = []
  const onLog = ({ message }: { message: string }) => {
    recentLogs.push(message)
    if (recentLogs.length > 10) recentLogs.shift()
  }
  ffmpeg.on('log', onLog)

  let exitCode: number
  try {
    exitCode = await ffmpeg.exec(args)
  } finally {
    ffmpeg.off('log', onLog)
  }

  if (exitCode !== 0) {
    const detail =
      [...recentLogs].reverse().find((line) => /error|invalid|failed|no such/i.test(line)) ??
      recentLogs.at(-1)
    logError('FFmpeg error', { code: exitCode, args, detail })
    throw new Error(detail ? `FFmpeg error: ${detail}` : `FFmpeg error (code ${exitCode})`)
  }
}

// ---------------------------------------------------------------------------
// Export planning (pure): decide the strategy and build the full command
// list up front. No WASM, no file I/O - everything here is testable data.
// ---------------------------------------------------------------------------

type ExportPlan = {
  format: ExportFormat
  inputFiles: { name: string; file: File }[]
  textFiles: { name: string; contents: string }[]
  commands: string[][]
  // Files produced by intermediate commands, deleted alongside inputs.
  intermediateFiles: string[]
  outputFile: string
}

// Shared helper: name the segment input files and build a concat demuxer list.
function buildConcatInputs(
  segments: Segment[],
  runId: string
): { inputFiles: ExportPlan['inputFiles']; concatList: string } {
  const inputFiles: ExportPlan['inputFiles'] = []
  let concatList = ''

  for (const segment of segments) {
    const clip = getClipById(segment.clipId)
    if (!clip) continue

    const ext = getFileExtension(clip.file.name) || 'mp4'
    const fileName = `input_${runId}_${inputFiles.length}.${ext}`
    inputFiles.push({ name: fileName, file: clip.file })

    concatList += `file '${fileName}'\n`
    concatList += `inpoint ${segment.startTime}\n`
    concatList += `outpoint ${segment.endTime}\n`
  }

  return { inputFiles, concatList }
}

// Stream-copy plan: remux without re-encoding using the concat demuxer.
// Near-instant, no quality loss, output size matches source.
function planStreamCopy(segments: Segment[], format: ExportFormat, runId: string): ExportPlan {
  const { inputFiles, concatList } = buildConcatInputs(segments, runId)
  const concatFile = `concat_${runId}.txt`
  const outputFile = `output_${runId}.${format}`

  return {
    format,
    inputFiles,
    textFiles: [{ name: concatFile, contents: concatList }],
    commands: [['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputFile]],
    intermediateFiles: [],
    outputFile,
  }
}

// Muted stream-copy plan: pass 1 stream-copies all segments into a single temp
// file, pass 2 stream-copies video and re-encodes only audio with volume=0
// applied to the muted segment time ranges.
// Much faster than full video re-encode for the common mute use case.
function planMuteStreamCopy(segments: Segment[], format: ExportFormat, runId: string): ExportPlan {
  const { inputFiles, concatList } = buildConcatInputs(segments, runId)
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

  const muteExpr = mutedRanges.map(([start, end]) => `between(t,${start},${end})`).join('+')
  let audioCodec = 'aac'
  if (format === 'webm') audioCodec = 'libopus'
  else if (format === 'avi') audioCodec = 'libmp3lame'

  return {
    format,
    inputFiles,
    textFiles: [{ name: concatFile, contents: concatList }],
    commands: [
      ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', tempCopyFile],
      [
        '-i',
        tempCopyFile,
        '-c:v',
        'copy',
        '-af',
        `volume=0:enable='${muteExpr}'`,
        '-c:a',
        audioCodec,
        outputFile,
      ],
    ],
    intermediateFiles: [tempCopyFile],
    outputFile,
  }
}

// Full re-encode plan: per-segment trimming + optional crop + mute handling in
// a filter graph, concatenated and encoded with format-specific codecs.
function planFullEncode(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate,
  runId: string,
  options: EncodeOptions
): ExportPlan {
  const inputFiles: ExportPlan['inputFiles'] = []
  const filterParts: string[] = []
  const concatInputs: string[] = []
  let streamIndex = 0

  const outputFile = `output_${runId}.${format}`

  for (const segment of segments) {
    const clip = getClipById(segment.clipId)
    if (!clip) continue

    const ext = getFileExtension(clip.file.name) || 'mp4'
    const fileName = `input_${runId}_${streamIndex}.${ext}`
    inputFiles.push({ name: fileName, file: clip.file })

    let videoFilter = `[${streamIndex}:v]trim=${segment.startTime}:${segment.endTime},setpts=PTS-STARTPTS`
    if (segment.crop) {
      const { x, y, width, height } = segment.crop
      videoFilter += `,crop=${width}:${height}:${x}:${y}`
    }
    if (options.maxDimension) {
      // Cap the longest side, preserve aspect ratio, keep dimensions even for
      // yuv420. Used by OOM recovery to shrink the memory footprint.
      const cap = options.maxDimension
      videoFilter += `,scale=w=${cap}:h=${cap}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    }
    videoFilter += `[v${streamIndex}]`

    // Clips without an audio stream get generated silence of the segment's
    // duration; mapping [i:a] for them would make the whole command fail.
    let audioFilter: string
    if (clip.hasAudio === false) {
      const segmentDuration = segment.endTime - segment.startTime
      audioFilter = `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${segmentDuration},asetpts=PTS-STARTPTS`
    } else {
      audioFilter = `[${streamIndex}:a]atrim=${segment.startTime}:${segment.endTime},asetpts=PTS-STARTPTS`
      if (segment.muted) {
        audioFilter += ',volume=0'
      }
    }
    audioFilter += `[a${streamIndex}]`

    filterParts.push(videoFilter, audioFilter)
    concatInputs.push(`[v${streamIndex}][a${streamIndex}]`)
    streamIndex++
  }

  // Skip the concat filter for a single segment - it's unnecessary and can hang in WASM.
  const filterComplex =
    streamIndex === 1
      ? filterParts.join(';').replace('[v0]', '[outv]').replace('[a0]', '[outa]')
      : filterParts.join(';') +
        `;${concatInputs.join('')}concat=n=${streamIndex}:v=1:a=1[outv][outa]`

  const inputArgs = inputFiles.flatMap((input) => ['-i', input.name])

  return {
    format,
    inputFiles,
    textFiles: [],
    commands: [
      [
        ...inputArgs,
        '-filter_complex',
        filterComplex,
        '-map',
        '[outv]',
        '-map',
        '[outa]',
        ...getOutputArgs(format, quality, fps, options),
        outputFile,
      ],
    ],
    intermediateFiles: [],
    outputFile,
  }
}

export function planExport(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate,
  runId: string,
  options: EncodeOptions
): ExportPlan {
  // Use stream copy when lossless + original fps + no per-segment muting
  if (quality === 'lossless' && fps === 'original' && canUseStreamCopy(segments, format)) {
    return planStreamCopy(segments, format, runId)
  }

  // Muted stream copy: video stays lossless, only audio is re-encoded (fast).
  // Applies when lossless + original fps + at least one muted segment + no crop + matching format.
  const hasMuted = segments.some((segment) => segment.muted)
  if (quality === 'lossless' && fps === 'original' && hasMuted) {
    const canMutedCopy = segments.every((segment) => {
      if (segment.crop) return false
      const clip = getClipById(segment.clipId)
      return clip != null && getFileExtension(clip.file.name) === format && clip.hasAudio !== false
    })
    if (canMutedCopy) return planMuteStreamCopy(segments, format, runId)
  }

  return planFullEncode(segments, format, quality, fps, runId, options)
}

// ---------------------------------------------------------------------------
// Export execution: one run lifecycle for every plan - write files, run the
// commands, finalize the output, clean up the WASM FS.
// ---------------------------------------------------------------------------

async function runExport(plan: ExportPlan): Promise<{ url: string; size: number }> {
  if (plan.inputFiles.length === 0) throw new Error('No valid segments')

  const ffmpeg = await getFfmpeg()
  ffmpegProgress.value = 0

  // Per-run ETA listener. The global progress handler in getFfmpeg keeps
  // driving ffmpegProgress; this one only feeds the ETA tracker.
  const eta = new EtaTracker()
  exportEtaSeconds.value = null
  const onProgress = ({ progress }: { progress: number }) => {
    eta.sample(progress, performance.now())
    exportEtaSeconds.value = eta.etaSeconds(progress, performance.now())
  }
  ffmpeg.on('progress', onProgress)

  const tempFiles: string[] = []

  try {
    for (const input of plan.inputFiles) {
      await ffmpeg.writeFile(input.name, await fetchFile(input.file))
      tempFiles.push(input.name)
    }
    for (const textFile of plan.textFiles) {
      await ffmpeg.writeFile(textFile.name, textFile.contents)
      tempFiles.push(textFile.name)
    }

    for (let i = 0; i < plan.commands.length; i++) {
      await exec(ffmpeg, plan.commands[i])
      // Show coarse progress between passes of a multi-command plan.
      if (i < plan.commands.length - 1) {
        ffmpegProgress.value = (i + 1) / plan.commands.length
      }
    }

    // Finalizing: reading output from WASM FS can take noticeable time.
    // Keep progress near-complete but not 100% until readFile finishes.
    ffmpegProgress.value = 0.95
    // Instrumentation: log read start/finish and duration to help diagnose hangs.
    console.log('[FFMPEG] readFile start', plan.outputFile)
    const t0 = performance.now()
    const data = await ffmpeg.readFile(plan.outputFile)
    const t1 = performance.now()
    console.log('[FFMPEG] readFile finished', plan.outputFile, 'duration_ms', Math.round(t1 - t0))
    const blob = new Blob([data as BlobPart], { type: MIME_TYPES[plan.format] })
    ffmpegProgress.value = 1
    return { url: URL.createObjectURL(blob), size: blob.size }
  } finally {
    ffmpeg.off('progress', onProgress)
    exportEtaSeconds.value = null
    await deleteFilesBestEffort(ffmpeg, [...tempFiles, ...plan.intermediateFiles, plan.outputFile])
  }
}

function isWasmOomError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.toLowerCase().includes('memory access out of bounds')
}

function isWorkerThreadError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    message.includes('worker') ||
    message.includes('pthread') ||
    message.includes('atomics') ||
    message.includes('sharedarraybuffer')
  )
}

async function restartFfmpeg(): Promise<void> {
  if (instance) {
    try {
      instance.terminate()
    } catch {}
    instance = null
  }
  loadingPromise = null
  ffmpegReady.value = false
  // Ensure the new instance is loaded before retrying
  await getFfmpeg()
}

export async function exportVideo(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<{ url: string; size: number }> {
  if (segments.length === 0) throw new Error('No segments')

  const runId = crypto.randomUUID().replace(/-/g, '')
  const mode = coreMode.value ?? 'singlethread'
  const options = encodeOptionsFor(mode, webmCodec.value)

  while (true) {
    const plan = planExport(segments, format, quality, fps, runId, options)
    try {
      return await runExport(plan)
    } catch (err) {
      if (isWorkerThreadError(err) && coreMode.value === 'multithread') {
        warn('MT worker error mid-export, downgrading to single-thread', {
          message: err instanceof Error ? err.message : String(err),
        })
        forceSingleThread = true
        coreMode.value = 'singlethread'
        coreModeReason.value = 'Multi-threaded export failed at runtime'
        await restartFfmpeg()
        // Rebuild options for single-thread and retry once.
        options.threads = null
        continue
      }
      if (!isWasmOomError(err)) throw err
      console.warn('[FFMPEG] memory OOB detected - attempting recovery')
      try {
        await restartFfmpeg()
      } catch (restartErr) {
        console.error('[FFMPEG] failed to restart ffmpeg', restartErr)
        throw err
      }
      // OOM is resolution-bound: downscale the longest side, do not touch CRF.
      const step = nextRecoveryStep({ maxDimension: options.maxDimension ?? null })
      if (!step) {
        throw new Error(
          `Ran out of memory exporting ${format}. This video is too large for in-browser encoding even at reduced resolution. Try a shorter selection or a lower FPS.`
        )
      }
      warn('Retrying export at reduced resolution after OOM', {
        capPx: step.maxDimension,
      })
      info(`Export ran out of memory; retrying downscaled to ${step.maxDimension}px`)
      options.maxDimension = step.maxDimension
    }
  }
}
