import {
  seek as advancedSeek,
  stepFrame as advancedStepFrame,
} from '@/lib/advanced/advancedPlayback'
import { goToEnd, goToStart, stepFrame, stepSeconds } from '@/lib/playback'
import { advancedPlayhead } from '@/lib/store'
import type { SeekKeyAction } from '@/lib/timelineKeyboard'
import { revealTimelinePlayhead } from '@/lib/timelineNavigator'

// Keyboard seeks from a focused playhead or seek bar slider. Each keeps the
// playhead it moved in view, as the global shortcuts do.

export function seekBasicByKey(action: SeekKeyAction) {
  if (action.kind === 'frames') stepFrame(action.amount)
  else if (action.kind === 'seconds') stepSeconds(action.amount)
  else if (action.kind === 'start') goToStart()
  else goToEnd()
  revealTimelinePlayhead()
}

export function seekAdvancedByKey(action: SeekKeyAction) {
  if (action.kind === 'frames') advancedStepFrame(action.amount)
  else if (action.kind === 'seconds') advancedSeek(advancedPlayhead.peek() + action.amount)
  else if (action.kind === 'start') advancedSeek(0)
  // Advanced seeks clamp to the project end.
  else advancedSeek(Number.POSITIVE_INFINITY)
  revealTimelinePlayhead()
}
