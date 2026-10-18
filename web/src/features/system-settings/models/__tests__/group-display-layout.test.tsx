import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateSystemOption } from '../../api'
import { GroupDisplayEditor } from '../group-display-editor'

vi.mock('../../api', () => ({ updateSystemOption: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function Fixture() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const groups = Array.from({ length: 32 }, (_, i) => ({
    group: `group-${String(i + 1).padStart(2, '0')}`,
    category: 'Example',
  }))
  return (
    <QueryClientProvider client={client}>
      <div className='flex h-full min-h-0 flex-col'>
        <GroupDisplayEditor
          value={JSON.stringify({
            groups,
            categories: [{ name: 'Example', default_expanded: false }],
          })}
          groupRatio={JSON.stringify(
            Object.fromEntries(groups.map((row) => [row.group, 1]))
          )}
        />
      </div>
    </QueryClientProvider>
  )
}

describe('group display editor layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateSystemOption).mockReset()
    vi.mocked(updateSystemOption).mockResolvedValue({
      success: true,
      message: '',
    })
  })

  it('keeps a long card at its content height so the settings page can scroll to the last group and save', () => {
    render(<Fixture />)
    const card = screen
      .getByText('Model Square Display')
      .closest('[data-slot="card"]')
    // Cards clip overflow by design; shrinking inside the fixed-height settings
    // frame would hide the last rows without creating any scrollable overflow.
    expect(card).toHaveClass('shrink-0')
    expect(screen.getByText('group-32')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('does not report success when the server rejects the display configuration', async () => {
    vi.mocked(updateSystemOption).mockResolvedValue({
      success: false,
      message: 'Display configuration rejected',
    })
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Display configuration rejected')
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('saves the reordered last group without losing category and visibility settings', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    const last = screen.getByText('group-32').closest('[draggable]')
    const first = screen.getByText('group-01').closest('[draggable]')
    if (!last || !first) throw new Error('Missing draggable group rows')
    fireEvent.dragStart(last)
    fireEvent.dragOver(first)
    fireEvent.drop(first)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateSystemOption).toHaveBeenCalled())
    const request = vi.mocked(updateSystemOption).mock.calls[0][0]
    expect(request.key).toBe('GroupDisplayConfig')
    const config = JSON.parse(String(request.value))
    expect(config.groups).toHaveLength(32)
    expect(config.groups[0]).toEqual({ group: 'group-32', category: 'Example' })
    expect(config.groups[1]).toEqual({ group: 'group-01', category: 'Example' })
    expect(config.categories).toEqual([
      { name: 'Example', default_expanded: false },
    ])
    expect(
      config.groups.every(
        (row: { hidden_by_default?: boolean }) =>
          row.hidden_by_default === undefined
      )
    ).toBe(true)
  })
})
