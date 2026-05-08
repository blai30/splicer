import { fetchFile } from '@ffmpeg/util'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { ffmpegProgress, ffmpegReady } from './store'
import type { ExportFormat, Framerate, Quality, Segment } from './types'
import { clips } from './store'

let instance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  if (!loadingPromise) {
    const ffmpeg = new FFmpeg()
    ffmpeg.on('progress', ({ progress }) => {
      ffmpegProgress.value = progress
    })
    loadingPromise = ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm',
    }).then(() => {
      instance = ffmpeg
      ffmpegReady.value = true
      return ffmpeg
    }).catch((err) => {
      loadingPromise = null
      throw err
    })
  }
  return loadingPromise
}

function getOutputArgs(format: ExportFormat, quality: Quality, fps: Framerate): string[] {
  const fpsArgs = fps !== 'original' ? ['-r', fps] : []

  if (format === 'webm') {
    const qArgs: Record<Quality, string[]> = {
      lossless: ['-lossless', '1'],
      high: ['-crf', '18', '-b:v', '0'],
      medium: ['-crf', '33', '-b:v', '0'],
      low: ['-crf', '48', '-b:v', '0'],
    }
    return ['-c:v', 'libvpx-vp9', ...qArgs[quality], '-c:a', 'libopus', ...fpsArgs]
  }

  const qArgs: Record<Quality, string[]> = {
    lossless: ['-crf', '0', '-preset', 'ultrafast'],
    high: ['-crf', '18'],
    medium: ['-crf', '23'],
    low: ['-crf', '28'],
  }
  return ['-c:v', 'libx264', ...qArgs[quality], '-c:a', 'aac', ...fpsArgs]
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

export async function exportVideo(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate,
): Promise<{ url: string; size: number }> {
  const ffmpeg = await getFFmpeg()
  ffmpegProgress.value = 0

  if (segments.length === 0) throw new Error('No segments')

  const inputFiles: string[] = []
  const filterParts: string[] = []
  const concatInputs: string[] = []
  let idx = 0

  for (const seg of segments) {
    const clip = clips.value.find((c) => c.id === seg.clipId)
    if (!clip) continue

    const ext = clip.file.name.split('.').pop() ?? 'mp4'
    const fname = `input_${idx}.${ext}`
    await ffmpeg.writeFile(fname, await fetchFile(clip.file))
    inputFiles.push(fname)

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

  const outputFile = `output.${format}`
  const inputArgs = inputFiles.flatMap((f) => ['-i', f])

  await ffmpeg.exec([
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    ...getOutputArgs(format, quality, fps),
    outputFile,
  ])

  const data = await ffmpeg.readFile(outputFile)
  const mimeMap: Record<ExportFormat, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
  }
  const blob = new Blob([data as BlobPart], { type: mimeMap[format] })

  for (const f of inputFiles) await ffmpeg.deleteFile(f)
  await ffmpeg.deleteFile(outputFile)

  return { url: URL.createObjectURL(blob), size: blob.size }
}
