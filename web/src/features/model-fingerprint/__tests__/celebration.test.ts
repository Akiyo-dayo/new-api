import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const effect = vi.hoisted(() => ({
  fire: vi.fn(),
  reset: vi.fn(),
  reduced: false,
}))
vi.mock('canvas-confetti', () => ({
  default: {
    create: () => Object.assign(effect.fire, { reset: effect.reset }),
  },
}))
vi.mock('motion/react', () => ({ useReducedMotion: () => effect.reduced }))

import {
  canonicalModel,
  isModelMatch,
  useModelMatchCelebration,
} from '../lib/celebration'
import type { Analysis } from '../vendor/types'

const result = (probability: number | null, model = 'claude-opus-5.5') =>
  ({ decision: 'scored', results: [{ model, probability }] }) as Analysis

describe('model match celebration', () => {
  it('fires both sides once, cleans up and respects reduced motion', () => {
    effect.fire.mockClear()
    effect.reset.mockClear()
    effect.reduced = false
    const value = result(0.99)
    const hook = renderHook(() =>
      useModelMatchCelebration(value, 'claude-opus-5.5')
    )
    expect(effect.fire).toHaveBeenCalledTimes(2)
    expect(effect.fire).toHaveBeenCalledWith(
      expect.objectContaining({ origin: { x: 0, y: 1 }, particleCount: 220 })
    )
    hook.rerender()
    expect(effect.fire).toHaveBeenCalledTimes(2)
    hook.unmount()
    expect(effect.reset).toHaveBeenCalledOnce()
    effect.reduced = true
    const reduced = renderHook(() =>
      useModelMatchCelebration(result(0.99), 'claude-opus-5.5')
    )
    expect(effect.fire).toHaveBeenCalledTimes(2)
    reduced.unmount()
    effect.reduced = false
  })
  it('matches upstream canonical names only at normal confidence', () => {
    expect(canonicalModel('anthropic/claude-opus-5-5')).toBe('claude-opus-5.5')
    expect(canonicalModel('gpt-4-2024-08-06')).toBe('gpt-4-2024-08-06')
    expect(isModelMatch(result(0.75), 'anthropic/claude-opus-5-5')).toBe(true)
    expect(isModelMatch(result(0.749), 'claude-opus-5.5')).toBe(false)
    expect(isModelMatch(result(null), 'claude-opus-5.5')).toBe(false)
    expect(isModelMatch(result(Number.NaN), 'claude-opus-5.5')).toBe(false)
    expect(isModelMatch(result(0.99), 'other-model')).toBe(false)
    expect(
      isModelMatch(
        { ...result(0.99), decision: 'unscorable' },
        'claude-opus-5.5'
      )
    ).toBe(false)
  })
})
