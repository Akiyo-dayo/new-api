import { z } from 'zod'

const amount = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0 && Number(value) <= 18014398509)
export const referralCampaignSchema = z.object({
  enabled: z.boolean(),
  threshold: amount,
  reward: amount,
})
export type ReferralCampaign = z.infer<typeof referralCampaignSchema>
