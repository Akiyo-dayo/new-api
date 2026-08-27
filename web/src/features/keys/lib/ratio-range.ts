/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

/**
 * A key whose group is `ratio:<min>-<max>` is not bound to one group: at request
 * time the backend collects every usable group whose ratio falls in the range,
 * tries the cheapest price level first, and rotates between groups that share
 * that price. Mirrors `ratio_setting.TokenGroupRatioRangePrefix`.
 */
export const RATIO_RANGE_PREFIX = 'ratio:'

/**
 * Bounds are kept as strings, exactly as they sit in the token's group field.
 * Parsing them to numbers here would rewrite a half-typed `0.` into `0` under
 * the user's cursor.
 */
export type RatioRangeBounds = { min: string; max: string }

export function isRatioRangeGroup(value: string | undefined): boolean {
  return !!value?.startsWith(RATIO_RANGE_PREFIX)
}

export function parseRatioRange(
  value: string | undefined
): RatioRangeBounds | null {
  if (!value?.startsWith(RATIO_RANGE_PREFIX)) return null
  const body = value.slice(RATIO_RANGE_PREFIX.length)
  // Look for the separator from index 1 so a leading '-' reads as a sign rather
  // than an empty lower bound, matching the backend parser.
  const separator = body.indexOf('-', 1)
  if (separator < 0) return { min: body, max: '' }
  return { min: body.slice(0, separator), max: body.slice(separator + 1) }
}

export function formatRatioRange(min: string, max: string): string {
  return `${RATIO_RANGE_PREFIX}${min}-${max}`
}

/**
 * Shortest round-trippable text for a ratio, so a bound picked off the ladder is
 * byte-identical to the group ratio the backend compares against. `0.1375` must
 * not become `0.14` — that bound would exclude the very group it came from.
 */
export function formatRatioBound(ratio: number): string {
  return String(ratio)
}

/** One price level: every usable group that bills at the same ratio. */
export type PriceTier = {
  ratio: number
  /** Groups charging this ratio, name-sorted. */
  groups: string[]
  /** Union of the models those groups serve, name-sorted. */
  models: string[]
}

/** A model reachable through the range, and what it will actually cost. */
export type ResolvedModel = {
  model: string
  /**
   * The ratio this model bills at: the cheapest in-range tier that serves it.
   * The backend walks the same ascending list and stops at the first tier with
   * a live channel, so this is what the user pays unless that tier is down.
   */
  ratio: number
  /** Groups inside the billing tier that serve the model. */
  groups: string[]
  /** How many in-range tiers serve it. 1 means only one price is possible. */
  tierCount: number
}

export type RangeResolution = {
  /** False when the bounds are not two numbers with min <= max. */
  valid: boolean
  tiers: PriceTier[]
  groups: string[]
  models: ResolvedModel[]
  /** Models every in-range tier serves — the part of the range that rotates. */
  sharedModelCount: number
}

/**
 * Invert the pricing catalogue into `group -> models`.
 *
 * `enable_groups` on a pricing row lists every group serving the model,
 * including groups this user cannot use: `/api/pricing` filters the model list
 * by usable groups but never trims the array itself. Skipping that intersection
 * would offer tiers the user has no access to.
 *
 * Rows with `price_configured === false` are dropped for the same reason:
 * `/v1/models` hides them and a call to one is refused, so listing them would
 * hand out a key whose allow-list contains models it cannot call.
 */
export function buildGroupModels(
  pricingModels: {
    model_name: string
    enable_groups?: string[]
    price_configured?: boolean
  }[],
  usableGroups: Iterable<string>
): Record<string, string[]> {
  const usable = new Set(usableGroups)
  const byGroup: Record<string, string[]> = {}
  for (const pricingModel of pricingModels) {
    if (pricingModel.price_configured === false) continue
    for (const group of pricingModel.enable_groups ?? []) {
      if (!usable.has(group)) continue
      const bucket = byGroup[group]
      if (bucket) bucket.push(pricingModel.model_name)
      else byGroup[group] = [pricingModel.model_name]
    }
  }
  for (const names of Object.values(byGroup)) names.sort()
  return byGroup
}

/**
 * Build the price ladder: one rung per distinct ratio, cheapest first.
 *
 * Rungs are keyed on the ratio rather than on the group because two groups
 * charging the same multiplier are one price to the buyer — and the backend
 * treats them as a single rotation pool.
 *
 * Groups with no configured ratio are left out: they have no place on a price
 * scale, and `GetUserGroupsInRatioRange` skips them for the same reason.
 */
export function buildPriceLadder(
  groupRatios: Record<string, number | undefined>,
  groupModels: Record<string, string[]>
): PriceTier[] {
  const byRatio = new Map<number, { groups: string[]; models: Set<string> }>()
  for (const [group, ratio] of Object.entries(groupRatios)) {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) continue
    let rung = byRatio.get(ratio)
    if (!rung) {
      rung = { groups: [], models: new Set() }
      byRatio.set(ratio, rung)
    }
    rung.groups.push(group)
    for (const name of groupModels[group] ?? []) rung.models.add(name)
  }
  return [...byRatio.entries()]
    .map(([ratio, rung]) => ({
      ratio,
      groups: rung.groups.sort(),
      models: [...rung.models].sort(),
    }))
    .sort((a, b) => a.ratio - b.ratio)
}

/**
 * Work out what a range actually buys: which tiers it covers, which models it
 * can call, and which tier each of those models will be billed at.
 *
 * `modelFilter`, when given, is the key's own model allow-list — previewing the
 * whole catalogue for a key that may call only two models would answer a
 * question the user did not ask.
 */
export function resolveRatioRange(
  ladder: PriceTier[],
  bounds: RatioRangeBounds,
  groupModels: Record<string, string[]>,
  modelFilter?: string[]
): RangeResolution {
  const empty: RangeResolution = {
    valid: false,
    tiers: [],
    groups: [],
    models: [],
    sharedModelCount: 0,
  }
  if (bounds.min.trim() === '' || bounds.max.trim() === '') return empty
  const min = Number(bounds.min)
  const max = Number(bounds.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return empty

  const tiers = ladder.filter((tier) => tier.ratio >= min && tier.ratio <= max)
  const allowed = modelFilter?.length ? new Set(modelFilter) : null

  const byModel = new Map<string, ResolvedModel>()
  for (const tier of tiers) {
    for (const name of tier.models) {
      if (allowed && !allowed.has(name)) continue
      const existing = byModel.get(name)
      if (existing) {
        existing.tierCount += 1
        continue
      }
      // First (cheapest) tier wins: the backend tries tiers in this same order.
      byModel.set(name, {
        model: name,
        ratio: tier.ratio,
        groups: tier.groups.filter((group) =>
          (groupModels[group] ?? []).includes(name)
        ),
        tierCount: 1,
      })
    }
  }

  const models = [...byModel.values()].sort(
    (a, b) => a.ratio - b.ratio || a.model.localeCompare(b.model)
  )
  return {
    valid: true,
    tiers,
    groups: tiers.flatMap((tier) => tier.groups),
    models,
    sharedModelCount:
      tiers.length === 0
        ? 0
        : models.filter((item) => item.tierCount === tiers.length).length,
  }
}

/**
 * The bounds a click on the ladder should produce.
 *
 * Behaves like a date-range picker: the first click pins one end, the next
 * click on a different rung completes the span, and clicking once a span is
 * finished starts over from that rung. Bounds always come from real rung
 * ratios, so a range can never land between two tiers and silently match
 * nothing — the failure mode of typing `0.14` when the group sits at `0.1375`.
 */
export function toggleLadderBound(
  ladder: PriceTier[],
  bounds: RatioRangeBounds | null,
  ratio: number
): RatioRangeBounds {
  const picked = formatRatioBound(ratio)
  if (!bounds) return { min: picked, max: picked }
  const min = Number(bounds.min)
  const max = Number(bounds.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { min: picked, max: picked }
  }
  // A completed span covers more than one rung; clicking again restarts.
  const spanned = ladder.filter(
    (tier) => tier.ratio >= min && tier.ratio <= max
  ).length
  if (spanned > 1) return { min: picked, max: picked }
  if (ratio < min) return { min: picked, max: bounds.max }
  if (ratio > max) return { min: bounds.min, max: picked }
  return { min: picked, max: picked }
}
