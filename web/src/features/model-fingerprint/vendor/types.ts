export type ServiceTier = 'flex' | 'default' | 'fast' | 'ultrafast'
export interface ApiConfig {
  baseUrl: string
  apiKey: string
  model: string
  effort: string
  format: 'openai' | 'responses' | 'anthropic'
  serviceTier?: ServiceTier
  stream?: boolean
  parallel?: boolean
  relaxed?: boolean
}
export interface Challenge {
  id: string
  expected_count: number
  prompt: string
}
export type SampleState =
  | 'pending'
  | 'requesting'
  | 'streaming'
  | 'done'
  | 'capped'
  | 'rejected'
  | 'stopped'
export type ErrorCode =
  | 'invalid_base_url'
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'direct_network'
  | 'http'
  | 'proxy_unavailable'
  | 'not_json'
  | 'no_stream_body'
  | 'bad_stream_json'
  | 'upstream_stream_error'
  | 'refused'
  | 'incomplete'
  | 'insufficient_numbers'
  | 'no_output'
  | 'responses_incomplete'
  | 'no_usage'
  | 'proxy_missing'
  | 'upstream_not_api'
export interface CodedError extends Error {
  code?: ErrorCode
  httpStatus?: number
  completionDetails?: unknown
}
export interface CollectionProgress {
  completed: number
  total: number
  accepted: number
  message: string
  challengeIndex?: number
  challenges?: {
    text: string
    status: string
    state?: SampleState
    error?: string
    errorCode?: ErrorCode
    httpStatus?: number
    throughput?: import('./throughput').Throughput
  }[]
  outputs?: Output[]
}
export interface Bank {
  built_at: string
  models: {
    id: string
    display_name: string
    family: string
    family_name: string
    response_count: number
  }[]
}
export interface Output {
  text: string
  expected_count: number
}
export interface Analysis {
  prediction: string
  prediction_name: string
  probability: number | null
  used_outputs: number
  family_prediction_name: string
  results: {
    model: string
    display_name: string
    family: string
    family_name: string
    score: number
    probability: number | null
  }[]
  diagnostics: {
    index: number
    parsed_numbers: number
    minimum_numbers: number
    accepted: boolean
  }[]
  evidence: {
    insufficient: boolean
    label: string
    reason: string
    threshold: number | null
    method: string
  }
  decision?: string
  [key: string]: unknown
}
