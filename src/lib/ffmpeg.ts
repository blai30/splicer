import { fetchFile } from '@ffmpeg/util'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { ffmpegProgress, ffmpegReady } from './store'
import type { ExportFormat, Segment } from './types'
import { clips } from './store'

let instance: FFmpeg | null = null

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  const ffmpeg = new FFmpeg()
  ffmpeg.on('progress', ({ progress }) => {
    ffmpegProgress.value = progress
  })
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
  })
  instance = ffmpeg
  ffmpegReady.value = true
  return ffmpeg
}

// Writes a segment's source file into ffmpeg FS and returns the written filename
async function writeSegmentInput(
  ffmpeg: FFmpeg,
  seg: Segment,
  index: number,
): Promise<string | null> {
  const clip = clips.value.find((c) => c.id === seg.clipId)
  if (!clip) return null
  const fname = `input_${index}.${clip.file.name.split('.').pop()}`
  await ffmpeg.writeFile(fname, await fetchFile(clip.file))
  return fname
}

export async function exportVideo(
  segments: Segment[],
  format: ExportFormat,
): Promise<string> {
  const ffmpeg = await getFFmpeg()
  ffmpegProgress.value = 0

  if (segments.length === 0) throw new Error('No segments')

  const inputFiles: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const fname = await writeSegmentInput(ffmpeg, segments[i], i)
    if (fname) inputFiles.push(fname)
  }

  // Build a concat list with per-segment trim, mute, and crop filters
  const filterParts: string[] = []
  const concatInputs: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const clip = clips.value.find((c) => c.id === seg.clipId)
    if (!clip) continue

    let videoFilter = `[${i}:v]trim=${seg.startTime}:${seg.endTime},setpts=PTS-STARTPTS`
    if (seg.crop) {
      const { x, y, width, height } = seg.crop
      videoFilter += `,crop=${width}:${height}:${x}:${y}`
    }
    videoFilter += `[v${i}]`

    let audioFilter: string
    if (seg.muted) {
      audioFilter = `[${i}:a]volume=0,atrim=${seg.startTime}:${seg.endTime},asetpts=PTS-STARTPTS[a${i}]`
    } else {
      audioFilter = `[${i}:a]atrim=${seg.startTime}:${seg.endTime},asetpts=PTS-STARTPTS[a${i}]`
    }

    filterParts.push(videoFilter, audioFilter)
    concatInputs.push(`[v${i}][a${i}]`)
  }

  const n = segments.length
  const filterComplex =
    filterParts.join(';') +
    `;${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv][outa]`

  const outputFile = `output.${format}`
  const inputArgs = inputFiles.flatMap((f) => ['-i', f])

  await ffmpeg.exec([
    ...inputArgs,
    '-filter_complex',
    filterComplex,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    outputFile,
  ])

  const data = await ffmpeg.readFile(outputFile)
  const mimeMap: Record<ExportFormat, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
  }
  const blob = new Blob([data as BlobPart], { type: mimeMap[format] })

  // Clean up FS
  for (const f of inputFiles) await ffmpeg.deleteFile(f)
  await ffmpeg.deleteFile(outputFile)

  return URL.createObjectURL(blob)
}
