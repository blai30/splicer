// Smooths jumpy ffmpeg progress into an ETA and an x-realtime-ish speed.
// Time is passed in by the caller (ms) so the module stays pure and testable.
export class EtaTracker {
  private firstProgress: number | null = null
  private firstTimeMs = 0
  private samples = 0

  sample(progress: number, nowMs: number): void {
    if (this.firstProgress === null) {
      this.firstProgress = progress
      this.firstTimeMs = nowMs
    }
    this.samples++
  }

  // Estimated seconds remaining, or null when there is not enough signal yet.
  etaSeconds(progress: number, nowMs: number): number | null {
    if (this.firstProgress === null || this.samples < 2) return null
    const progressDelta = progress - this.firstProgress
    const timeDeltaMs = nowMs - this.firstTimeMs
    if (progressDelta <= 0 || timeDeltaMs <= 0) return null
    const ratePerMs = progressDelta / timeDeltaMs
    const remaining = (1 - progress) / ratePerMs
    return remaining / 1000
  }

  // Encode rate as fraction-per-second (UI can format as needed).
  speedPerSecond(progress: number, nowMs: number): number | null {
    if (this.firstProgress === null || this.samples < 2) return null
    const progressDelta = progress - this.firstProgress
    const timeDeltaMs = nowMs - this.firstTimeMs
    if (progressDelta <= 0 || timeDeltaMs <= 0) return null
    return (progressDelta / timeDeltaMs) * 1000
  }
}
