import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { referralCampaignSchema } from '../referral-campaign-schema'
import { ReferralCampaignSettings } from '../referral-campaign-settings'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <ReferralCampaignSettings
          value='{"enabled":false,"threshold":"20","reward":"5"}'
          complianceConfirmed
        />
      </SettingsPageProvider>
    </>
  )
}

test('saves campaign switch and amounts as one configuration document', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory(),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  fireEvent.click(await screen.findByRole('switch'))
  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'Wallet spending threshold (site units)',
    }),
    { target: { value: '25.5' } }
  )
  fireEvent.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'ReferralCampaign',
      value: '{"enabled":true,"threshold":"25.5","reward":"5"}',
    })
  )
})

test.each(['0', '-1', 'NaN', 'Infinity', '1.0000001', '999999999999999999'])(
  'rejects invalid campaign amount %s',
  (threshold) => {
    expect(
      referralCampaignSchema.safeParse({
        enabled: true,
        threshold,
        reward: '5',
      }).success
    ).toBe(false)
  }
)
