/**
 * True when a keydown lands in a field the user is typing into (catalog
 * search, observer coordinates, any future select or contenteditable).
 * Every global keyboard shortcut ignores such events — the one shared rule,
 * so the HUD toggle and the globe shortcuts can never disagree. Duck-typed
 * so tests can pass plain objects.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const el = target as Partial<HTMLElement>
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  )
}
