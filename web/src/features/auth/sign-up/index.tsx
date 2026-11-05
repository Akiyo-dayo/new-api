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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useSkinAssets } from '@/hooks/use-skin-assets'
import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const skin = useSkinAssets()
  const { status } = useStatus()

  let divider =
    'bg-gradient-to-r from-transparent via-[#ffc46b]/70 to-transparent sm:bg-gradient-to-r sm:from-[#ffc46b]/70 sm:to-transparent'
  if (skin.isLightSkin) {
    divider =
      'bg-gradient-to-r from-transparent via-[#a8c6ff]/70 to-transparent sm:bg-gradient-to-r sm:from-[#a8c6ff]/70 sm:to-transparent'
  }
  if (skin.usesThemeTokens) {
    divider =
      'bg-gradient-to-r from-transparent via-primary/70 to-transparent sm:bg-gradient-to-r sm:from-primary/70 sm:to-transparent'
  }

  return (
    <AuthLayout>
      <div className='w-full space-y-8'>
        <div className='space-y-2'>
          <p className='text-muted-foreground/70 text-center text-[11px] font-semibold tracking-[0.3em] uppercase sm:text-left'>
            {t(skin.copy.badge)}
          </p>
          <div aria-hidden className={`mx-auto h-px w-10 sm:mx-0 ${divider}`} />
          <h2 className='text-center text-2xl font-semibold tracking-tight sm:text-left'>
            {t(skin.copy.signUp)}
          </h2>
          <p className='text-muted-foreground text-left text-sm sm:text-base'>
            {t('Already have an account?')}{' '}
            <Link
              to='/sign-in'
              className='hover:text-primary font-medium underline underline-offset-4'
            >
              {t('Sign in')}
            </Link>
            .
          </p>
        </div>

        <SignUpForm />

        <TermsFooter
          variant='sign-up'
          status={status}
          className='text-center'
        />
      </div>
    </AuthLayout>
  )
}
