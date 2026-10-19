import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { DetailSheet } from '../components/detail-sheet'
import { AvailabilityBoard } from '../index'
import { aggregateByModel, sortAggregates } from '../lib/aggregate'
import type { AvailabilityCell } from '../types'

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  queryCells = CELLS
})

const CELLS: AvailabilityCell[] = [
  {
    group: 'group-a',
    model: 'model-good',
    success: 1000,
    errors: 1,
    availability: 1000 / 1001,
    last_success_at: 1,
    last_error_at: 2,
    recent_errors: [],
  },
  {
    group: 'group-a',
    model: 'model-bad',
    success: 50,
    errors: 50,
    availability: 0.5,
    last_success_at: 1,
    last_error_at: 2,
    recent_errors: [
      { channel_id: 7, content: 'upstream timeout', created_at: 2 },
    ],
  },
  {
    group: 'group-b',
    model: 'model-bad',
    success: 90,
    errors: 10,
    availability: 0.9,
    last_success_at: 3,
    last_error_at: 4,
    recent_errors: [],
  },
]

let queryCells = CELLS

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({
      data: {
        data: {
          groups: ['group-a', 'group-b'],
          models: ['model-good', 'model-bad'],
          cells: queryCells,
          window_hours: 24,
          generated_at: 1,
        },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }),
  }
})

describe('aggregateByModel', () => {
  it('weights availability by request volume and keeps worst level', () => {
    const aggregates = aggregateByModel(CELLS)
    const bad = aggregates.find((a) => a.model === 'model-bad')
    expect(bad).toBeDefined()
    // (50 + 90) / (100 + 100) = 0.7
    expect(bad?.availability).toBeCloseTo(0.7)
    expect(bad?.level).toBe('critical')
    // worst group first
    expect(bad?.cells[0].group).toBe('group-a')
  })

  it('sorts worst-first by default', () => {
    const sorted = sortAggregates(aggregateByModel(CELLS), 'worst')
    expect(sorted[0].model).toBe('model-bad')
  })
})

describe('availability board layout', () => {
  it('refreshes open details from the current account query instead of retaining raw errors', () => {
    const { rerender } = render(<AvailabilityBoard />)
    fireEvent.click(screen.getByRole('button', { name: 'model-bad' }))
    expect(screen.getByText('upstream timeout')).toBeTruthy()

    queryCells = [
      {
        ...CELLS[1],
        recent_errors: [
          { content: 'Upstream request timed out', created_at: 3 },
        ],
      },
    ]
    useAuthStore.getState().auth.setUser({ id: 2, username: 'reader', role: 1 })
    rerender(<AvailabilityBoard />)

    expect(screen.queryByText('upstream timeout')).toBeNull()
    expect(screen.getByText('Upstream request timed out')).toBeTruthy()
    expect(screen.queryByText(/Channel\s+#7/)).toBeNull()
  })

  it('lets ordinary users view statistics without displaying administrator error details', () => {
    useAuthStore.getState().auth.setUser({ id: 2, username: 'reader', role: 1 })
    render(<AvailabilityBoard />)
    fireEvent.click(screen.getByRole('button', { name: 'model-bad' }))
    expect(screen.getByText('Availability by group')).toBeTruthy()
    expect(screen.getByText('upstream timeout')).toBeTruthy()
    expect(screen.queryByText(/Channel\s+#7/)).toBeNull()
  })
  it('renders summary stats, legend and one row per model', () => {
    render(<AvailabilityBoard />)

    expect(screen.getByTestId('availability-summary')).toBeTruthy()
    expect(screen.getByTestId('availability-legend')).toBeTruthy()

    const rows = screen.getAllByTestId('availability-model-row')
    expect(rows).toHaveLength(2)
    // popularity-first default ordering puts the busiest model on top
    expect(rows[0].getAttribute('aria-label')).toBe('model-good')

    // per-group status strips are present
    expect(
      screen.getAllByTestId('availability-group-strip').length
    ).toBeGreaterThan(0)
  })

  it('filters to degraded models only', () => {
    render(<AvailabilityBoard />)

    fireEvent.click(screen.getByRole('switch'))

    const rows = screen.getAllByTestId('availability-model-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('aria-label')).toBe('model-bad')
  })

  it('opens the detail sheet with per-group breakdown and merged errors', () => {
    render(<AvailabilityBoard />)

    // Open the degraded model explicitly after switching to popularity order.
    fireEvent.click(screen.getByRole('button', { name: 'model-bad' }))

    // group breakdown rows and the merged recent error card
    expect(screen.getByText('Availability by group')).toBeTruthy()
    expect(screen.getByText('upstream timeout')).toBeTruthy()
    expect(screen.getByText(/Channel\s+#7/)).toBeTruthy()
  })

  it('orders sheet groups by the active sort mode', () => {
    const aggregate = aggregateByModel([
      {
        group: 'group-small-bad',
        model: 'm',
        success: 5,
        errors: 5,
        availability: 0.5,
        last_success_at: 1,
        last_error_at: 2,
        recent_errors: [],
      },
      {
        group: 'group-big-good',
        model: 'm',
        success: 495,
        errors: 5,
        availability: 0.99,
        last_success_at: 3,
        last_error_at: 4,
        recent_errors: [],
      },
    ])[0]

    const { rerender } = render(
      <DetailSheet aggregate={aggregate} sortMode='worst' onClose={() => {}} />
    )
    let titles = screen.getAllByTitle(/group-/)
    expect(titles[0].textContent).toBe('group-small-bad')

    rerender(
      <DetailSheet aggregate={aggregate} sortMode='volume' onClose={() => {}} />
    )
    titles = screen.getAllByTitle(/group-/)
    expect(titles[0].textContent).toBe('group-big-good')

    rerender(
      <DetailSheet aggregate={aggregate} sortMode='name' onClose={() => {}} />
    )
    titles = screen.getAllByTitle(/group-/)
    expect(titles[0].textContent).toBe('group-big-good')
  })
})
