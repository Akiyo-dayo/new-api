import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  referralCampaignSchema,
  type ReferralCampaign,
} from './referral-campaign-schema'

export function ReferralCampaignSettings(props: {
  value: string
  complianceConfirmed: boolean
}) {
  const { t } = useTranslation()
  const update = useUpdateOption()
  let defaults: ReferralCampaign = {
    enabled: false,
    threshold: '20',
    reward: '5',
  }
  try {
    const parsed = referralCampaignSchema.safeParse(JSON.parse(props.value))
    if (parsed.success) defaults = parsed.data
  } catch {
    /* Invalid persisted settings stay disabled until corrected. */
  }
  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<ReferralCampaign>({
      resolver: zodResolver(referralCampaignSchema),
      defaultValues: defaults,
      onSubmit: async (data) => {
        await update.mutateAsync({
          key: 'ReferralCampaign',
          value: JSON.stringify(data),
        })
      },
    })
  return (
    <SettingsSection title={t('Spending referral campaign')}>
      <FormNavigationGuard when={isDirty} />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Only users invited during the campaign participate. Registration rewards can stack. Rules are fixed when each user registers. Pausing preserves progress and stops new enrollments and awards; restarting resumes them.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit}>
          <SettingsPageFormActions
            onSave={handleSubmit}
            isSaving={isSubmitting || update.isPending}
          />
          <FormDirtyIndicator isDirty={isDirty} />
          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>
                      {t('Enable spending referral campaign')}
                    </FormLabel>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!props.complianceConfirmed && !field.value}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            {(['threshold', 'reward'] as const).map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t(
                        name === 'threshold'
                          ? 'Wallet spending threshold (site units)'
                          : 'One-time referral reward (site units)'
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} inputMode='decimal' />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </SettingsFormGrid>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Site units are face value, without exchange-rate conversion. Only final wallet spending counts, not top-ups, subscriptions, failed tasks or reservations. Rewards require manual transfer to balance, not administrator approval.'
            )}
          </p>
          {!props.complianceConfirmed && (
            <p className='text-destructive text-xs'>
              {t(
                'Non-zero invitation rewards require compliance confirmation in Payment Gateway settings.'
              )}
            </p>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
