import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelFingerprint } from '..'

vi.mock('@/features/playground/api', () => ({
  getUserGroups: vi.fn().mockResolvedValue([
    { value: 'vip', label: 'VIP' },
    { value: 'standard', label: 'Standard' },
  ]),
  getUserModels: vi
    .fn()
    .mockResolvedValue([{ value: 'test-model', label: 'Test model' }]),
}))
// Worker is a browser boundary; ranking itself is exercised against real data in analysis.test.
vi.mock('../use-fingerprint-analysis', () => ({
  useFingerprintAnalysis: () => ({
    reference: { models: 60, builtAt: '2026-10-17' },
    error: '',
    prepare: vi.fn(),
    analyze: vi.fn(),
  }),
}))

afterEach(cleanup)

describe('fingerprint workspace', () => {
  it('shows route-specific disclosure before key input and clears only local saved credentials on explicit action', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'model-fingerprint-profiles',
      JSON.stringify([
        {
          model: 'saved',
          baseUrl: 'https://example.com',
          apiKey: 'saved-test-key',
        },
      ])
    )
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ModelFingerprint />
      </QueryClientProvider>
    )
    await user.click(screen.getByRole('tab', { name: 'Custom API' }))
    const notice = screen.getByRole('region', {
      name: 'API key transmission and storage',
    })
    expect(notice).toHaveTextContent('not to this site backend')
    const key = screen.getByLabelText('API key')
    expect(
      notice.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await user.click(
      screen.getByRole('button', { name: 'Clear saved API keys' })
    )
    expect(key).toHaveValue('')
    expect(localStorage.getItem('model-fingerprint-profiles')).not.toContain(
      'saved-test-key'
    )
    localStorage.removeItem('model-fingerprint-profiles')
  })
  it('requires explicit model selection and charge consent and resets model on group change', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelFingerprint />
      </QueryClientProvider>
    )
    const start = screen.getByRole('button', { name: 'Start inspection' })
    expect(start).toBeDisabled()
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Group' })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByRole('option', { name: 'VIP' }))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Model' })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(screen.getByRole('option', { name: 'Test model' }))
    expect(start).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I understand that this inspection uses my balance.',
      })
    )
    expect(start).toBeEnabled()
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByRole('option', { name: 'Standard' }))
    expect(start).toBeDisabled()
    expect(
      screen.getByRole('checkbox', {
        name: 'I understand that this inspection uses my balance.',
      })
    ).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
      'Select a model'
    )
  })
})
