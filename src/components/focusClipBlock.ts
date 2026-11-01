// Move keyboard focus to a timeline clip block and bring it into view. Called
// right after the selection moves; the block is already in the DOM.
export function focusClipBlock(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) return
  element.focus({ preventScroll: true })
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// Whether keyboard focus is on a clip block now, so a pointer press on another
// block can carry the roving focus along instead of stranding it.
export function clipBlockHasFocus(attribute: string): boolean {
  return document.activeElement?.hasAttribute(attribute) ?? false
}
