import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { ReferralCampaignDetails } from '../components/referral-campaign-details'

test('paused campaign keeps manual transfer explanation and earned reward summary', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        campaign: { enabled: false, threshold: '20', reward: '5' },
        participants: 3,
        qualified: 1,
        awarded: 1,
        total_reward_quota: 2500000,
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReferralCampaignDetails />
    </QueryClientProvider>
  )
  expect(
    await screen.findByText('Spending referral campaign', { exact: false })
  ).toBeVisible()
  expect(
    screen.getByText(/Previously awarded rewards remain available/)
  ).toBeVisible()
  expect(screen.getByText(/No administrator approval is needed/)).toBeVisible()
  expect(screen.getByText(/Campaign participants: 3/)).toHaveTextContent(
    'Rewarded: 1'
  )
})
