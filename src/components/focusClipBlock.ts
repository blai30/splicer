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

// Carry focus to a block that just became the selection when focus is still on
// another block (End, Home, undo): otherwise focus stays on an unselected
// block, screen readers hear nothing, and the next arrow key starts from it.
export function followSelectionFocus(attribute: string, selector: string): void {
  const focused = document.activeElement
  if (!focused?.hasAttribute(attribute)) return
  if (focused === document.querySelector(selector)) return
  focusClipBlock(selector)
}
