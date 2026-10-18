import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { generateChallenges } from '../vendor/challenge-browser'
import { decodeDetector } from '../vendor/detector-codec'
import {
  analyzeSharedOutputs,
  supportsSharedDetector,
} from '../vendor/shared-detector'
import type { Bank } from '../vendor/types'

const bank = JSON.parse(
  readFileSync('public/fingerprint/bank.json', 'utf8')
) as Bank
const detector = decodeDetector(
  new Uint8Array(readFileSync('public/fingerprint/detector.bin'))
)
const text = Array.from({ length: 300 }, (_, i) =>
  String(((i * 37 + 17) % 355) + 1)
).join(' ')
const outputs = [1, 2, 3].map(() => ({ text, expected_count: 300 }))

describe('pinned fingerprint runtime', () => {
  it('creates three independently sized challenges within the upstream sampling range', () => {
    const challenges = generateChallenges()
    expect(challenges).toHaveLength(3)
    expect(new Set(challenges.map((c) => c.expected_count)).size).toBe(3)
    for (const challenge of challenges) {
      expect(challenge.expected_count).toBeGreaterThanOrEqual(292)
      expect(challenge.expected_count).toBeLessThanOrEqual(332)
      expect(challenge.prompt).toContain(String(challenge.expected_count))
    }
  })
  it('ranks all 60 reference candidates and binds calibration to the pinned detector', () => {
    expect(supportsSharedDetector(bank, detector)).toBe(true)
    const result = analyzeSharedOutputs(outputs, bank, detector)
    expect(result.results).toHaveLength(60)
    expect(result.used_outputs).toBe(3)
    expect(result.results.every((r) => Number.isFinite(r.score))).toBe(true)
    expect(
      result.results.reduce((sum, r) => sum + (r.probability ?? 0), 0)
    ).toBeCloseTo(1)
    expect(result.evidence.insufficient).toBe(true)
  })
  it('rejects mismatched reference metadata and does not invent confidence for partial samples', () => {
    expect(() =>
      analyzeSharedOutputs(outputs, { ...bank, built_at: 'wrong' }, detector)
    ).toThrow()
    const partial = analyzeSharedOutputs(
      [
        outputs[0],
        { text: '', expected_count: 300 },
        { text: '1', expected_count: 300 },
      ],
      bank,
      detector,
      { allowPartial: true }
    )
    expect(partial.used_outputs).toBe(1)
    expect(partial.results.every((r) => r.probability === null)).toBe(true)
    expect(
      analyzeSharedOutputs(
        [{ text: '1 2', expected_count: 300 }],
        bank,
        detector
      ).results
    ).toEqual([])
  })
})
