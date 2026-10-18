import { createFileRoute, redirect } from '@tanstack/react-router'

import { ModelFingerprint } from '@/features/model-fingerprint'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

export const Route = createFileRoute('/_authenticated/model-fingerprint/')({
  beforeLoad: () => {
    if (!isSidebarModuleEnabled('chat', 'playground')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ModelFingerprint,
})
