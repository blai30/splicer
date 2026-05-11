import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

import { clips, ffmpegProgress, ffmpegReady } from '@/lib/store'
import type { ExportFormat, Framerate, Quality, Segment } from '@/lib/types'

const MIME_TYPES: Record<ExportFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

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

  for (const seg of segments) {
    if (seg.muted || seg.crop) return false
    const clip = clips.value.find((c) => c.id === seg.clipId)
    if (!clip) return false
    if (getFileExtension(clip.file.name) !== format) return false
  }

  return true
}

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  if (!loadingPromise) {
    const ffmpeg = new FFmpeg()
    ffmpeg.on('progress', ({ progress }) => {
      ffmpegProgress.value = progress
    })
    loadingPromise = ffmpeg
      .load({
        coreURL: `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`,
        wasmURL: `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.wasm`,
      })
      .then(() => {
        instance = ffmpeg
        ffmpegReady.value = true
        return ffmpeg
      })
      .catch((err) => {
        loadingPromise = null
        throw err
      })
  }
  return loadingPromise
}

function getOutputArgs(format: ExportFormat, quality: Quality, fps: Framerate): string[] {
  const fpsArgs = fps !== 'original' ? ['-r', fps] : []

  if (format === 'webm') {
    const crf: Record<Quality, string> = { lossless: '18', high: '24', medium: '33', low: '48' }
    return ['-c:v', 'libvpx-vp9', '-crf', crf[quality], '-b:v', '0', '-c:a', 'libopus', ...fpsArgs]
  }

  const crf: Record<Quality, string> = { lossless: '18', high: '22', medium: '28', low: '35' }
  const preset: Record<Quality, string> = {
    lossless: 'slow',
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
}

async function exec(ffmpeg: FFmpeg, args: string[]): Promise<void> {
  const ret = await ffmpeg.exec(args)
  if (ret !== 0) throw new Error(`FFmpeg error (code ${ret})`)
}

// Stream-copy path: remux without re-encoding using the concat demuxer.
// Near-instant, no quality loss, output size matches source.
async function exportStreamCopy(
  segments: Segment[],
  format: ExportFormat
): Promise<{ url: string; size: number }> {
  const ffmpeg = await getFFmpeg()
  ffmpegProgress.value = 0

  const runId = crypto.randomUUID().replace(/-/g, '')
  const inputFiles: string[] = []
  const tempFiles: string[] = []
  const concatFile = `concat_${runId}.txt`
  const outputFile = `output_${runId}.${format}`
  let concatList = ''

  try {
    for (const seg of segments) {
      const clip = clips.value.find((c) => c.id === seg.clipId)
      if (!clip) continue

      const ext = getFileExtension(clip.file.name) || 'mp4'
      const fname = `input_${runId}_${inputFiles.length}.${ext}`
      await ffmpeg.writeFile(fname, await fetchFile(clip.file))
      inputFiles.push(fname)
      tempFiles.push(fname)

      concatList += `file '${fname}'\n`
      concatList += `inpoint ${seg.startTime}\n`
      concatList += `outpoint ${seg.endTime}\n`
    }

    if (inputFiles.length === 0) throw new Error('No valid segments')

    await ffmpeg.writeFile(concatFile, concatList)
    tempFiles.push(concatFile)

    await exec(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputFile])
    ffmpegProgress.value = 1

    const data = await ffmpeg.readFile(outputFile)
    const blob = new Blob([data as BlobPart], { type: MIME_TYPES[format] })
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

  // Use stream copy when lossless + original fps + no muted segments
  if (quality === 'lossless' && fps === 'original' && canUseStreamCopy(segments, format)) {
    return exportStreamCopy(segments, format)
  }

  const ffmpeg = await getFFmpeg()
  ffmpegProgress.value = 0

  const runId = crypto.randomUUID().replace(/-/g, '')
  const inputFiles: string[] = []
  const tempFiles: string[] = []
  const filterParts: string[] = []
  const concatInputs: string[] = []
  let idx = 0

  const outputFile = `output_${runId}.${format}`

  try {
    for (const seg of segments) {
      const clip = clips.value.find((c) => c.id === seg.clipId)
      if (!clip) continue

      const ext = getFileExtension(clip.file.name) || 'mp4'
      const fname = `input_${runId}_${idx}.${ext}`
      await ffmpeg.writeFile(fname, await fetchFile(clip.file))
      inputFiles.push(fname)
      tempFiles.push(fname)

      let videoFilter = `[${idx}:v]trim=${seg.startTime}:${seg.endTime},setpts=PTS-STARTPTS`
      if (seg.crop) {
        const { x, y, width, height } = seg.crop
        videoFilter += `,crop=${width}:${height}:${x}:${y}`
      }
      videoFilter += `[v${idx}]`

      const dur = seg.endTime - seg.startTime
      const audioFilter = seg.muted
        ? `aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration=${dur}[a${idx}]`
        : `[${idx}:a]atrim=${seg.startTime}:${seg.endTime},asetpts=PTS-STARTPTS[a${idx}]`

      filterParts.push(videoFilter, audioFilter)
      concatInputs.push(`[v${idx}][a${idx}]`)
      idx++
    }

    if (idx === 0) throw new Error('No valid segments')

    const filterComplex =
      filterParts.join(';') + `;${concatInputs.join('')}concat=n=${idx}:v=1:a=1[outv][outa]`

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

    const data = await ffmpeg.readFile(outputFile)
    const blob = new Blob([data as BlobPart], { type: MIME_TYPES[format] })
    return { url: URL.createObjectURL(blob), size: blob.size }
  } finally {
    await deleteFilesBestEffort(ffmpeg, [...tempFiles, outputFile])
  }
}
