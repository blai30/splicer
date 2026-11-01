// Keeps a second track (audio) written just ahead of the video as the video
// loop reports its progress, without making that loop wait on it: the work is
// chained and runs in the gaps while video frames are drawn and encoded, so the
// two encoders stay busy together. The loop only waits when the track falls
// more than `maxLagSec` behind, which bounds what the muxer has to buffer.
export function createTrackPacer(
  advance: (untilSec: number) => Promise<void>,
  options: { leadSec: number; maxLagSec: number }
) {
  let work: Promise<void> = Promise.resolve()
  let scheduledUntil = 0
  let completedUntil = 0
  return {
    async videoReached(videoSec: number): Promise<void> {
      const target = videoSec + options.leadSec
      if (target > scheduledUntil) {
        scheduledUntil = target
        work = work.then(async () => {
          await advance(target)
          completedUntil = target
        })
        // Failures surface from the next wait or from drain().
        work.catch(() => {})
      }
      if (completedUntil < videoSec - options.maxLagSec) await work
    },
    // Wait for everything scheduled so far, rethrowing its failure.
    drain: (): Promise<void> => work,
  }
}
