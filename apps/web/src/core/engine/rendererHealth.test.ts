import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RECOVERIES,
  RECOVERY_WINDOW_MS,
  RecoveryBudget,
  visibleDelay,
  type VisibilitySource,
} from './rendererHealth'

describe('RecoveryBudget', () => {
  it('allows MAX_RECOVERIES rebuilds per window and refuses the next', () => {
    const budget = new RecoveryBudget()
    for (let i = 0; i < MAX_RECOVERIES; i++) expect(budget.take(i * 1000)).toBe(true)
    expect(budget.take(MAX_RECOVERIES * 1000)).toBe(false)
  })

  it('forgets rebuilds older than the window', () => {
    const budget = new RecoveryBudget(2, 1000)
    expect(budget.take(0)).toBe(true)
    expect(budget.take(500)).toBe(true)
    expect(budget.take(900)).toBe(false)
    // 0 and 500 have aged out; 900 (a refused attempt) still counts.
    expect(budget.take(1600)).toBe(true)
    expect(budget.take(1700)).toBe(false)
  })

  it('defaults to the documented window', () => {
    const budget = new RecoveryBudget()
    for (let i = 0; i < MAX_RECOVERIES; i++) budget.take(0)
    expect(budget.take(RECOVERY_WINDOW_MS - 1)).toBe(false)
    expect(budget.take(2 * RECOVERY_WINDOW_MS)).toBe(true)
  })
})

/** A document stand-in whose visibility the test flips. */
function fakeDocument() {
  const listeners = new Set<() => void>()
  const doc = {
    hidden: false,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  }
  const setHidden = (hidden: boolean) => {
    doc.hidden = hidden
    for (const fn of [...listeners]) fn()
  }
  return { doc: doc as unknown as VisibilitySource, setHidden, listeners }
}

describe('visibleDelay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once, delayMs after arm, and stops listening', () => {
    const { doc, listeners } = fakeDocument()
    const fire = vi.fn()
    const delay = visibleDelay(1000, fire, doc)
    delay.arm()
    delay.arm() // idempotent while pending
    vi.advanceTimersByTime(999)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
    delay.arm()
    vi.advanceTimersByTime(5000)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('never fires while hidden and starts over when shown', () => {
    const { doc, setHidden } = fakeDocument()
    const fire = vi.fn()
    setHidden(true)
    visibleDelay(1000, fire, doc).arm()
    vi.advanceTimersByTime(5000)
    expect(fire).not.toHaveBeenCalled()
    setHidden(false)
    vi.advanceTimersByTime(1000)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('skips a delay that ends hidden, then re-arms on return', () => {
    const { doc, setHidden } = fakeDocument()
    const fire = vi.fn()
    visibleDelay(1000, fire, doc).arm()
    vi.advanceTimersByTime(500)
    setHidden(true)
    vi.advanceTimersByTime(500)
    expect(fire).not.toHaveBeenCalled()
    setHidden(false)
    vi.advanceTimersByTime(999)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('cancel clears the pending delay and the listener for good', () => {
    const { doc, setHidden, listeners } = fakeDocument()
    const fire = vi.fn()
    const delay = visibleDelay(1000, fire, doc)
    delay.arm()
    delay.cancel()
    expect(listeners.size).toBe(0)
    setHidden(true)
    setHidden(false)
    delay.arm()
    vi.advanceTimersByTime(5000)
    expect(fire).not.toHaveBeenCalled()
  })
})
