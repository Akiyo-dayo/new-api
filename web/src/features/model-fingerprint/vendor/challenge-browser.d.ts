export interface Challenge {
  id: string
  expected_count: number
  prompt: string
}
export function generateChallenges(
  count?: number,
  usedLengths?: number[]
): Challenge[]
