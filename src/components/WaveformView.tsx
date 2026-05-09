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
      el.width = Math.max(1, Math.floor(width * dpr))
      el.height = Math.max(1, Math.floor(height * dpr))

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

      for (let bar = 0; bar < barCount; bar++) {
        const from = startIdx + Math.floor((bar / barCount) * visibleLength)
        const to = startIdx + Math.floor(((bar + 1) / barCount) * visibleLength)

        let peak = 0
        for (let i = from; i <= to && i < peaks.length; i++) {
          if (peaks[i] > peak) peak = peaks[i]
        }

        const h = Math.max(1, Math.round(peak * maxHalfHeight))
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
