import type { ActionProgress, VisualAction, VisualState } from '../types.js'

export function verifyActionProgress({
  before,
  action,
  after,
}: {
  before: VisualState
  action: VisualAction
  after: VisualState
}): ActionProgress {
  if (action.type === 'wait') {
    return {
      changed: true,
      reason: 'wait_completed',
    }
  }

  if (before.url !== after.url) {
    return {
      changed: true,
      reason: 'url_changed',
    }
  }

  if (before.title !== after.title) {
    return {
      changed: true,
      reason: 'title_changed',
    }
  }

  if (before.screenshot.id !== after.screenshot.id) {
    return {
      changed: true,
      reason: 'screenshot_changed',
    }
  }

  if (before.visibleText !== after.visibleText) {
    return {
      changed: true,
      reason: 'visible_text_changed',
    }
  }

  return {
    changed: false,
    reason: 'no_visible_progress',
  }
}
