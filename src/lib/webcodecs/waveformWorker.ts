import { createPauseGate, type WaveformResponse, type WaveformWorkerMessage } from '../waveform'
import { extractWaveformPeaks } from '../waveformExtract'

// Decodes clip audio into waveform peaks off the main thread, so long imports
// do not stall playback or the timeline. The peaks buffer is transferred back.
// The page pauses it while an export runs so the two do not share decoders.
const gate = createPauseGate()

self.onmessage = async (event: MessageEvent<WaveformWorkerMessage>) => {
  const message = event.data
  if (message.type === 'pause') return gate.pause()
  if (message.type === 'resume') return gate.resume()
  const { id, file, duration, peakCount } = message
  const peaks = await extractWaveformPeaks(file, duration, peakCount, gate.wait)
  const response: WaveformResponse = { id, peaks }
  ;(self as unknown as Worker).postMessage(response, [peaks.buffer])
}
