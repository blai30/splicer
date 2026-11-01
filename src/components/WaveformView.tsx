import type { ReadonlySignal } from '@preact/signals'
import { useSignalEffect } from '@preact/signals'
import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import type { ScrollWindow } from '@/components/useTimelineNavigation'
import { computeBars, visibleSpan } from '@/lib/waveform'

// One bar every 2 px, 1 px wide.
const BAR_STEP_PX = 2
// The canvas covers the view plus this much on each side, in whole chunks, so
// it stays far below browser canvas size limits on long clips and small
// scrolls do not redraw it.
const CHUNK_PX = 256

type WaveformProps = {
  peaks: Float32Array
  clipDuration: number
  segmentStart: number
  segmentEnd: number
  // Drawn block width in CSS px.
  width: number
  // The block's left edge in the scroller's content px, and the scroller's
  // visible window. Without them the whole block is drawn.
  contentX?: number
  scrollWindow?: ReadonlySignal<ScrollWindow>
  class?: string
}

// Waveform strip for a timeline block. Only the part of the block in (or near)
// view gets a canvas, positioned under it inside the block.
export function WaveformView(props: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const lastDrawKey = useRef('')
  const lastPeaks = useRef<Float32Array | null>(null)

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const { peaks, clipDuration, segmentStart, segmentEnd, width, contentX, scrollWindow } =
      propsRef.current
    const view = scrollWindow?.peek()
    const span =
      view && contentX !== undefined && view.width > 0
        ? visibleSpan(width, view.left - contentX, view.width, CHUNK_PX)
        : { from: 0, to: width }
    // Bars stay on the block's 2 px grid wherever the canvas starts.
    const from = Math.floor(span.from / BAR_STEP_PX) * BAR_STEP_PX
    const cssWidth = Math.max(0, Math.floor(span.to - from))
    const cssHeight = Math.floor(canvas.clientHeight)
    const dpr = window.devicePixelRatio || 1

    const key = [
      from,
      cssWidth,
      cssHeight,
      dpr,
      width,
      segmentStart,
      segmentEnd,
      clipDuration,
    ].join()
    if (key === lastDrawKey.current && peaks === lastPeaks.current) return
    lastDrawKey.current = key
    lastPeaks.current = peaks

    canvas.style.left = `${from}px`
    canvas.style.width = `${cssWidth}px`
    if (cssWidth <= 0 || cssHeight <= 0) {
      canvas.width = 0
      canvas.height = 0
      return
    }
    canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
    canvas.height = Math.max(1, Math.floor(cssHeight * dpr))

    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)

    const center = cssHeight / 2
    context.strokeStyle = 'rgba(255,255,255,0.3)'
    context.beginPath()
    context.moveTo(0, center)
    context.lineTo(cssWidth, center)
    context.stroke()

    const segmentDuration = segmentEnd - segmentStart
    if (peaks.length === 0 || clipDuration <= 0 || segmentDuration <= 0 || width <= 0) return

    const startTime = segmentStart + (from / width) * segmentDuration
    const endTime = segmentStart + ((from + cssWidth) / width) * segmentDuration
    const barCount = Math.floor(cssWidth / BAR_STEP_PX)
    const bars = computeBars(peaks, startTime / clipDuration, endTime / clipDuration, barCount)
    const maxHalfHeight = Math.max(1, Math.floor(cssHeight * 0.44))

    context.fillStyle = 'rgba(255,255,255,0.78)'
    for (let bar = 0; bar < barCount; bar++) {
      const halfHeight = Math.max(1, Math.round(bars[bar] * maxHalfHeight))
      context.fillRect(bar * BAR_STEP_PX, Math.floor(center - halfHeight), 1, halfHeight * 2)
    }
  }

  useEffect(draw, [
    props.peaks,
    props.clipDuration,
    props.segmentStart,
    props.segmentEnd,
    props.width,
    props.contentX,
  ])

  // Height changes. The draw key includes the height and pixel ratio, so the
  // resizes draw() itself causes (new canvas width) do not redraw again.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => draw())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // Scrolling redraws only when the view reaches a new chunk.
  useSignalEffect(() => {
    void props.scrollWindow?.value
    draw()
  })

  return (
    <canvas
      ref={canvasRef}
      class={clsx('pointer-events-none absolute top-0 h-full', props.class)}
      aria-hidden="true"
    />
  )
}
