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
import {
  SORT_OPTIONS,
  FILTER_ALL,
  QUOTA_TYPES,
  QUOTA_TYPE_VALUES,
  ENDPOINT_TYPES,
} from '../constants'
import type { ModelStat, PricingModel } from '../types'
import {
  getDynamicPricingSummary,
  isDynamicPricingModel,
} from './dynamic-price'
import { getDisplayGroupRatio } from './model-helpers'

// ----------------------------------------------------------------------------
// Filter Utilities
// ----------------------------------------------------------------------------

/**
 * Filter models by search query
 */
export function filterBySearch(
  models: PricingModel[],
  query: string
): PricingModel[] {
  if (!query) return models

  const lowerQuery = query.toLowerCase()
  return models.filter(
    (m) =>
      m.model_name?.toLowerCase().includes(lowerQuery) ||
      m.description?.toLowerCase().includes(lowerQuery) ||
      m.tags?.toLowerCase().includes(lowerQuery) ||
      m.vendor_name?.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Filter models by vendor
 */
export function filterByVendor(
  models: PricingModel[],
  vendor: string
): PricingModel[] {
  if (vendor === FILTER_ALL) return models
  return models.filter((m) => m.vendor_name === vendor)
}

/**
 * Filter models by group
 */
export function filterByGroup(
  models: PricingModel[],
  group: string
): PricingModel[] {
  if (group === FILTER_ALL) return models
  return models.filter((m) => m.enable_groups?.includes(group))
}

/**
 * Filter models by quota type
 */
export function filterByQuotaType(
  models: PricingModel[],
  quotaType: string
): PricingModel[] {
  if (quotaType === QUOTA_TYPES.ALL) return models
  const targetType =
    quotaType === QUOTA_TYPES.TOKEN
      ? QUOTA_TYPE_VALUES.TOKEN
      : QUOTA_TYPE_VALUES.REQUEST
  return models.filter((m) => m.quota_type === targetType)
}

/**
 * Filter models by endpoint type
 */
export function filterByEndpointType(
  models: PricingModel[],
  endpointType: string
): PricingModel[] {
  if (endpointType === ENDPOINT_TYPES.ALL) return models
  return models.filter((m) =>
    m.supported_endpoint_types?.includes(endpointType)
  )
}

/**
 * Hide models that are only reachable through hidden-by-default groups.
 *
 * Only applies to the "all groups" view: picking such a group explicitly is how
 * a user opts into seeing them. A model that also lives in a visible group is
 * kept — the point is to stop free tiers from padding the list, not to hide the
 * model itself.
 */
export function filterByHiddenGroups(
  models: PricingModel[],
  group: string,
  hiddenGroups: Set<string>
): PricingModel[] {
  if (group !== FILTER_ALL || hiddenGroups.size === 0) return models
  return models.filter((m) => {
    const groups = m.enable_groups
    if (!groups || groups.length === 0) return true
    return groups.some((g) => !hiddenGroups.has(g))
  })
}

/**
 * Get model price for sorting
 */
/**
 * The number the price sorts compare, in the same currency-per-unit the card
 * shows.
 *
 * It has to include the group ratio: the card prints
 * `model_ratio x 2 x groupRatio`, so sorting on `model_ratio` alone puts a
 * model that is free in one group behind a dearer one, and the list reads as
 * though the sort is broken. `selectedGroup` keeps the key on whichever group
 * the square is currently pricing against, exactly like `getDisplayGroupRatio`.
 */
function getModelPrice(model: PricingModel, selectedGroup?: string): number {
  // No configured price at all: `model_ratio` is the backend's 37.5 fallback,
  // which would sort the model as one of the dearest on the square.
  if (model.price_configured === false) return Number.POSITIVE_INFINITY

  const groupRatio = getDisplayGroupRatio(model, selectedGroup)

  if (isDynamicPricingModel(model)) {
    // Coefficients live in the expression, not in model_ratio; the first
    // primary entry is the input price the card leads with.
    const entry = getDynamicPricingSummary(model, {
      tokenUnit: 'M',
      showRechargePrice: false,
      priceRate: 1,
      usdExchangeRate: 1,
      groupRatioMultiplier: groupRatio,
    })?.primaryEntries[0]
    // An expression too exotic to expand has no comparable price; park it at
    // the end rather than pretending it is free.
    return entry ? entry.value * groupRatio : Number.POSITIVE_INFINITY
  }

  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return (model.model_price || 0) * groupRatio
  }
  return model.model_ratio * 2 * groupRatio
}

function byName(a: PricingModel, b: PricingModel): number {
  return (a.model_name || '').localeCompare(b.model_name || '')
}

/**
 * Order two models by price, keeping the ones with no comparable price at the
 * end of the list whichever direction the sort runs. Reversing the comparison
 * would otherwise put "price unknown" at the top of "most expensive first",
 * where it reads as the priciest model on the square.
 */
function comparePrice(
  a: PricingModel,
  b: PricingModel,
  selectedGroup: string | undefined,
  direction: 1 | -1
): number {
  const priceA = getModelPrice(a, selectedGroup)
  const priceB = getModelPrice(b, selectedGroup)
  const unknownA = !Number.isFinite(priceA)
  const unknownB = !Number.isFinite(priceB)
  if (unknownA !== unknownB) return unknownA ? 1 : -1
  if (unknownA) return byName(a, b)
  return direction * (priceA - priceB) || byName(a, b)
}

/**
 * Sort models by specified option.
 *
 * `stats` is keyed by model name; models missing from it have had no traffic in
 * the stats window and sort to the end of popularity / success-rate views
 * instead of being treated as rank 0 or 0% success.
 */
export function sortModels(
  models: PricingModel[],
  sortBy: string,
  stats: Record<string, ModelStat> = {},
  selectedGroup?: string
): PricingModel[] {
  const sorted = [...models]

  const rankOf = (model: PricingModel): number =>
    stats[model.model_name]?.popularity_rank ?? Number.POSITIVE_INFINITY
  // null means "not enough samples"; -1 keeps those behind every real rate
  // (which is a 0-100 percent) without pretending they failed every call.
  const successOf = (model: PricingModel): number =>
    stats[model.model_name]?.success_rate ?? -1

  switch (sortBy) {
    case SORT_OPTIONS.POPULAR:
      sorted.sort((a, b) => rankOf(a) - rankOf(b) || byName(a, b))
      break
    case SORT_OPTIONS.SUCCESS_RATE:
      sorted.sort((a, b) => successOf(b) - successOf(a) || byName(a, b))
      break
    case SORT_OPTIONS.NAME:
      sorted.sort(byName)
      break
    case SORT_OPTIONS.PRICE_LOW:
      sorted.sort((a, b) => comparePrice(a, b, selectedGroup, 1))
      break
    case SORT_OPTIONS.PRICE_HIGH:
      sorted.sort((a, b) => comparePrice(a, b, selectedGroup, -1))
      break
  }

  return sorted
}

/**
 * Apply all filters and sorting to models
 */
export function filterAndSortModels(
  models: PricingModel[],
  filters: {
    search: string
    vendor: string
    group: string
    quotaType: string
    endpointType: string
    tag: string
    sortBy: string
    hiddenGroups?: Set<string>
    stats?: Record<string, ModelStat>
  }
): PricingModel[] {
  let result = filterBySearch(models, filters.search)
  result = filterByVendor(result, filters.vendor)
  result = filterByGroup(result, filters.group)
  result = filterByHiddenGroups(
    result,
    filters.group,
    filters.hiddenGroups ?? new Set()
  )
  result = filterByQuotaType(result, filters.quotaType)
  result = filterByEndpointType(result, filters.endpointType)
  result = filterByTag(result, filters.tag)
  result = sortModels(result, filters.sortBy, filters.stats, filters.group)

  return result
}

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString?: string): string[] {
  if (!tagsString) return []
  return tagsString
    .split(/[,;|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Extract all unique tags from models
 */
export function extractAllTags(models: PricingModel[]): string[] {
  const tagSet = new Set<string>()

  models.forEach((model) => {
    if (model.tags) {
      const tags = parseTags(model.tags)
      tags.forEach((tag) => {
        tagSet.add(tag.toLowerCase())
      })
    }
  })

  return Array.from(tagSet).sort((a, b) => a.localeCompare(b))
}

/**
 * Filter models by tag
 */
export function filterByTag(
  models: PricingModel[],
  tag: string
): PricingModel[] {
  if (tag === FILTER_ALL) return models

  const tagLower = tag.toLowerCase()
  return models.filter((m) => {
    if (!m.tags) return false
    const modelTags = parseTags(m.tags).map((t) => t.toLowerCase())
    return modelTags.includes(tagLower)
  })
}
