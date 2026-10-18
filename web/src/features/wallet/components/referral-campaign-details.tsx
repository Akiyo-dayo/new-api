import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatNumber, formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

interface CampaignSummary {
  campaign: { enabled: boolean; threshold: string; reward: string }
  participants: number
  qualified: number
  awarded: number
  total_reward_quota: number
}

export function ReferralCampaignDetails() {
  const { t, i18n } = useTranslation()
  const query = useQuery({
    queryKey: ['referral-campaign'],
    queryFn: async () =>
      requireServerSuccess(
        (
          await api.get<{ success: boolean; data: CampaignSummary }>(
            '/api/user/referral_campaign'
          )
        ).data
      ).data,
    refetchInterval: 30000,
    meta: { errorToast: false },
  })
  if (query.isPending) {
    return (
      <p role='status' className='text-muted-foreground text-xs'>
        {t('Loading referral campaign')}
      </p>
    )
  }
  if (query.isError) {
    return (
      <p role='alert' className='text-destructive text-xs'>
        {t('Unable to load referral campaign')}
      </p>
    )
  }
  const data = query.data
  if (!data.campaign.enabled && data.participants === 0) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div className='space-y-1 text-xs lg:col-span-3'>
      <p className='font-medium'>
        {t('Spending referral campaign')} ·{' '}
        {t(data.campaign.enabled ? 'Active' : 'Paused')}
      </p>
      <p>
        {t(
          'Invite a new user who spends {{threshold}} site units from their wallet to earn {{reward}} site units once.',
          data.campaign
        )}
      </p>
      <p className='text-muted-foreground'>
        {t(
          'Campaign participants: {{participants}} · Qualified: {{qualified}} · Rewarded: {{awarded}} · Rewards: {{rewards}}',
          {
            participants: formatNumber(data.participants, locale),
            qualified: formatNumber(data.qualified, locale),
            awarded: formatNumber(data.awarded, locale),
            rewards: formatQuota(data.total_reward_quota),
          }
        )}
      </p>
      <p className='text-muted-foreground'>
        {t(
          'Rules are fixed at registration. Only final wallet spending counts. Rewards are added to Pending; manually transfer them to balance. No administrator approval is needed.'
        )}
      </p>
      {!data.campaign.enabled && (
        <p className='text-muted-foreground'>
          {t(
            'Campaign paused: progress is preserved. Previously awarded rewards remain available to transfer.'
          )}
        </p>
      )}
    </div>
  )
}
