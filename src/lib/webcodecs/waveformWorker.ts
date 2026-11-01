import type { WaveformRequest, WaveformResponse } from '../waveform'
import { extractWaveformPeaks } from '../waveformExtract'

// Decodes clip audio into waveform peaks off the main thread, so long imports
// do not stall playback or the timeline. The peaks buffer is transferred back.
self.onmessage = async (event: MessageEvent<WaveformRequest>) => {
  const { id, file, duration, peakCount } = event.data
  const peaks = await extractWaveformPeaks(file, duration, peakCount)
  const response: WaveformResponse = { id, peaks }
  ;(self as unknown as Worker).postMessage(response, [peaks.buffer])
}
