import { useEffect, useRef } from 'preact/hooks'

type WaveformViewProps = {
  peaks: number[]
  clipDuration: number
  segmentStart: number
  segmentEnd: number
  class?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function WaveformView({
  peaks,
  clipDuration,
  segmentStart,
  segmentEnd,
  class: className,
}: WaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastSizeRef = useRef<{ width: number; height: number; dpr: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const el = canvasRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const dpr = window.devicePixelRatio || 1
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)
      const nextSize = { width, height, dpr }
      const prevSize = lastSizeRef.current
      const resized =
        !prevSize ||
        prevSize.width !== nextSize.width ||
        prevSize.height !== nextSize.height ||
        prevSize.dpr !== nextSize.dpr

      if (resized) {
        el.width = Math.max(1, Math.floor(width * dpr))
        el.height = Math.max(1, Math.floor(height * dpr))
        lastSizeRef.current = nextSize
      }

      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const center = height / 2
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.moveTo(0, center)
      ctx.lineTo(width, center)
      ctx.stroke()

      if (peaks.length === 0 || clipDuration <= 0 || segmentEnd <= segmentStart) return

      const startRatio = clamp(segmentStart / clipDuration, 0, 1)
      const endRatio = clamp(segmentEnd / clipDuration, 0, 1)
      const startIdx = Math.floor(startRatio * (peaks.length - 1))
      const endIdx = Math.max(startIdx + 1, Math.ceil(endRatio * (peaks.length - 1)))
      const visibleLength = Math.max(1, endIdx - startIdx)

      const barStep = 2
      const barCount = Math.max(1, Math.floor(width / barStep))
      const maxHalfHeight = Math.max(1, Math.floor(height * 0.44))

      ctx.fillStyle = 'rgba(255,255,255,0.78)'

      const bucketMax = new Float32Array(barCount)
      for (let i = startIdx; i < endIdx && i < peaks.length; i++) {
        const relative = (i - startIdx) / visibleLength
        const bucket = Math.min(barCount - 1, Math.max(0, Math.floor(relative * barCount)))
        const value = peaks[i]
        if (value > bucketMax[bucket]) bucketMax[bucket] = value
      }

      for (let bar = 0; bar < barCount; bar++) {
        const h = Math.max(1, Math.round(bucketMax[bar] * maxHalfHeight))
        const x = bar * barStep
        const y = Math.floor(center - h)
        ctx.fillRect(x, y, 1, h * 2)
      }
    }

    draw()

    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks, clipDuration, segmentStart, segmentEnd])

  return <canvas ref={canvasRef} class={className} aria-hidden="true" />
}
