import confetti from 'canvas-confetti'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

import type { Analysis } from '../vendor/types'

// Ikaleio/lm-detector 50a364bc, MIT. Keep the source matching and confidence rules.
export const canonicalModel = (model: string) =>
  model
    .trim()
    .replace(/^[^/]+\//, '')
    .replaceAll(/(?<!\d)(\d)-(\d)(?!\d)/g, '$1.$2')
export function isModelMatch(result: Analysis, selected: string): boolean {
  const top = result.results[0]
  const confidence = top?.probability
  return (
    result.decision !== 'unscorable' &&
    Boolean(top) &&
    confidence !== null &&
    confidence !== undefined &&
    Number.isFinite(confidence) &&
    confidence >= 0.75 &&
    Boolean(canonicalModel(selected)) &&
    canonicalModel(top.model) === canonicalModel(selected)
  )
}
export function useModelMatchCelebration(
  result: Analysis | null,
  selected: string | null
) {
  const reduced = useReducedMotion()
  const last = useRef<Analysis | null>(null)
  useEffect(() => {
    if (last.current === result) return
    last.current = result
    if (reduced || !result || !selected || !isModelMatch(result, selected)) {
      return
    }
    const reach = document.documentElement.clientWidth * 0.75
    const rise = document.documentElement.clientHeight * 0.6
    const decay = 0.94
    const angle = (Math.atan2(rise, reach) * 180) / Math.PI
    const fire = confetti.create(undefined, {
      resize: true,
      disableForReducedMotion: true,
    })
    const options = {
      particleCount: 220,
      spread: 32,
      startVelocity: Math.hypot(reach, rise) * (1 - decay),
      decay,
      gravity: 0.9,
      ticks: 240,
    }
    void fire({ ...options, angle, origin: { x: 0, y: 1 } })
    void fire({ ...options, angle: 180 - angle, origin: { x: 1, y: 1 } })
    return () => fire.reset()
  }, [result, selected, reduced])
}
