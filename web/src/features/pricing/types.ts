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
// ----------------------------------------------------------------------------
// Pricing Types
// ----------------------------------------------------------------------------

export type PricingVendor = {
  id: number
  name: string
  icon?: string
  description?: string
}

export type PricingModel = {
  id: number
  model_name: string
  description?: string
  icon?: string
  vendor_id?: number
  vendor_name?: string
  vendor_icon?: string
  vendor_description?: string
  quota_type: number
  model_ratio: number
  completion_ratio: number
  model_price?: number
  cache_ratio?: number | null
  create_cache_ratio?: number | null
  image_ratio?: number | null
  audio_ratio?: number | null
  audio_completion_ratio?: number | null
  enable_groups: string[]
  tags?: string
  supported_endpoint_types?: string[]
  key?: string
  group_ratio?: Record<string, number>
  /** Billing mode (e.g. "tiered_expr") used to flag dynamic pricing */
  billing_mode?: string
  /** Raw expression describing dynamic / tiered billing */
  billing_expr?: string
  /** Pricing version returned by backend, useful for cache busting */
  pricing_version?: string
  /**
   * False when the model has no price configured at all. `model_ratio` still
   * carries the backend's 37.5 fallback in that case, so rendering it as money
   * invents a price for a model that cannot even be called. Older backends omit
   * the field; `undefined` therefore has to keep meaning "priced".
   */
  price_configured?: boolean
  /**
   * Optional model metadata fields reserved for backend-provided catalog data.
   * Keep them data-driven; do not synthesize display values on the client.
   */
  context_length?: number
  max_output_tokens?: number
  knowledge_cutoff?: string
  release_date?: string
  parameter_count?: string
  input_modalities?: Modality[]
  output_modalities?: Modality[]
  capabilities?: ModelCapability[]
}

/** Input/output modalities supported by a model. */
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file'

/** Functional capabilities a model exposes. */
export type ModelCapability =
  | 'function_calling'
  | 'streaming'
  | 'vision'
  | 'json_mode'
  | 'structured_output'
  | 'reasoning'
  | 'tools'
  | 'system_prompt'
  | 'web_search'
  | 'code_interpreter'
  | 'caching'
  | 'embeddings'

/** One group's display config, produced by service.ResolveGroupDisplay. */
export type GroupDisplayItem = {
  group: string
  /** Empty means the group is not collapsed under any category. */
  category?: string
  /**
   * Models that are only available in hidden-by-default groups are kept out of
   * the "all groups" list, so free tiers do not crowd the model picker.
   */
  hidden_by_default: boolean
}

export type GroupDisplayCategory = {
  name: string
  default_expanded: boolean
}

/** Array order is display order for both lists. */
export type GroupDisplay = {
  groups: GroupDisplayItem[]
  categories: GroupDisplayCategory[]
}

/**
 * Per-model usage stats used for the popularity / success-rate sorts.
 * The backend deliberately exposes a rank rather than raw call counts.
 */
export type ModelStat = {
  /** 1 = most popular. Models with no traffic are absent from the map. */
  popularity_rank: number
  /** Percent (0-100), or null when the sample is too small to be meaningful. */
  success_rate: number | null
}

/**
 * One group's effective rate limit, as produced by service.ResolveRateLimitDisplay.
 *
 * The backend has already applied the "group override, else global default"
 * fallback that middleware/model-rate-limit.go uses, so the numbers here are the
 * ones that actually stop requests. Note the real model is
 * "requests per N-minute window", not RPM/TPM/RPD.
 */
export type GroupRateLimit = {
  group: string
  /** Total requests allowed in the window. 0 means unlimited. */
  total_count: number
  /** Successful requests allowed in the window. */
  success_count: number
  /** True when this row comes from a per-group override, not the global default. */
  overridden: boolean
}

export type RateLimitDisplay = {
  enabled: boolean
  duration_minutes: number
  groups: GroupRateLimit[]
}

export type PricingData = {
  success: boolean
  message?: string
  data: PricingModel[]
  vendors: PricingVendor[]
  group_ratio: Record<string, number>
  usable_group: Record<string, { desc: string; ratio: number }>
  supported_endpoint: Record<string, string>
  auto_groups: string[]
  group_display?: GroupDisplay
  model_stats?: Record<string, ModelStat>
  rate_limit?: RateLimitDisplay
}

export type TokenUnit = 'M' | 'K'
export type PriceType =
  | 'input'
  | 'output'
  | 'cache'
  | 'create_cache'
  | 'image'
  | 'audio_input'
  | 'audio_output'
export type QuotaType = 0 | 1 // 0: token-based, 1: per-request
