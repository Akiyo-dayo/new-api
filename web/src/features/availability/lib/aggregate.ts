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
import type { AvailabilityCell } from '../types'

export type AvailabilityLevel =
  | 'none'
  | 'good'
  | 'fair'
  | 'degraded'
  | 'critical'

export const DEGRADED_THRESHOLD = 0.99

export function levelOf(availability: number | undefined): AvailabilityLevel {
  if (availability === undefined || Number.isNaN(availability)) return 'none'
  if (availability >= 0.99) return 'good'
  if (availability >= 0.95) return 'fair'
  if (availability >= 0.8) return 'degraded'
  return 'critical'
}

/** Solid segment colors for the per-group status strip. */
export const LEVEL_BAR_CLASS: Record<AvailabilityLevel, string> = {
  none: 'bg-muted-foreground/20',
  good: 'bg-emerald-500',
  fair: 'bg-lime-500',
  degraded: 'bg-orange-500',
  critical: 'bg-red-500',
}

/** Foreground colors for percentages and the summary figures. */
export const LEVEL_TEXT_CLASS: Record<AvailabilityLevel, string> = {
  none: 'text-muted-foreground',
  good: 'text-emerald-600 dark:text-emerald-400',
  fair: 'text-lime-600 dark:text-lime-400',
  degraded: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
}

/** Small status dot used in legends and list rows. */
export const LEVEL_DOT_CLASS: Record<AvailabilityLevel, string> = {
  none: 'bg-muted-foreground/30',
  good: 'bg-emerald-500',
  fair: 'bg-lime-500',
  degraded: 'bg-orange-500',
  critical: 'bg-red-500',
}

export interface ModelAggregate {
  model: string
  success: number
  errors: number
  /** Request-weighted availability across all groups serving this model. */
  availability: number
  /** Worst level among the model's groups, used for the status dot. */
  level: AvailabilityLevel
  /** Cells sorted worst-first so the strip and details lead with problems. */
  cells: AvailabilityCell[]
}

const LEVEL_RANK: Record<AvailabilityLevel, number> = {
  critical: 0,
  degraded: 1,
  fair: 2,
  good: 3,
  none: 4,
}

export function aggregateByModel(cells: AvailabilityCell[]): ModelAggregate[] {
  const byModel = new Map<string, AvailabilityCell[]>()
  for (const cell of cells) {
    const list = byModel.get(cell.model)
    if (list) {
      list.push(cell)
    } else {
      byModel.set(cell.model, [cell])
    }
  }

  const aggregates: ModelAggregate[] = []
  for (const [model, modelCells] of byModel) {
    const success = modelCells.reduce((sum, c) => sum + c.success, 0)
    const errors = modelCells.reduce((sum, c) => sum + c.errors, 0)
    const total = success + errors
    const availability = total > 0 ? success / total : 1
    const sorted = [...modelCells].sort(
      (a, b) => a.availability - b.availability
    )
    const level = sorted.reduce<AvailabilityLevel>(
      (worst, c) =>
        LEVEL_RANK[levelOf(c.availability)] < LEVEL_RANK[worst]
          ? levelOf(c.availability)
          : worst,
      'none'
    )
    aggregates.push({
      model,
      success,
      errors,
      availability,
      level,
      cells: sorted,
    })
  }
  return aggregates
}

export type SortMode = 'worst' | 'name' | 'volume'

export function sortAggregates(
  list: ModelAggregate[],
  mode: SortMode
): ModelAggregate[] {
  const sorted = [...list]
  switch (mode) {
    case 'name':
      sorted.sort((a, b) => a.model.localeCompare(b.model))
      break
    case 'volume':
      sorted.sort((a, b) => b.success + b.errors - (a.success + a.errors))
      break
    case 'worst':
    default:
      sorted.sort((a, b) => {
        const diff = a.availability - b.availability
        if (Math.abs(diff) > 1e-9) return diff
        return b.success + b.errors - (a.success + a.errors)
      })
      break
  }
  return sorted
}

export function formatPercent(value: number): string {
  if (value >= 0.9995) return '100%'
  return `${(value * 100).toFixed(1)}%`
}

export function formatCount(value: number): string {
  return value.toLocaleString()
}
