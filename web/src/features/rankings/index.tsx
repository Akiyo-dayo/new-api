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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChisaAmbient } from '@/components/chisa-ambient'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  MarketShareSection,
  ModelsSection,
  PulseSection,
  RankingsHero,
  UserSpendingSection,
} from './components'
import { useRankings } from './hooks/use-rankings'
import type { RankingMode, RankingPeriod } from './types'

const VALID_PERIODS = new Set<RankingPeriod>(['today', 'week', 'month', 'year'])
const VALID_MODES = new Set<RankingMode>(['rolling', 'natural'])
const RANKING_MODE_STORAGE_KEY = 'newapi:rankings-mode'

function readStoredMode(): RankingMode {
  if (typeof window === 'undefined') return 'rolling'
  try {
    const stored = window.localStorage.getItem(RANKING_MODE_STORAGE_KEY)
    return VALID_MODES.has(stored as RankingMode)
      ? (stored as RankingMode)
      : 'rolling'
  } catch {
    return 'rolling'
  }
}

function saveStoredMode(mode: RankingMode) {
  try {
    window.localStorage.setItem(RANKING_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore restricted browser storage; URL state still works.
  }
}

export function Rankings() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/rankings/' })
  const navigate = useNavigate()

  const period: RankingPeriod = VALID_PERIODS.has(
    search.period as RankingPeriod
  )
    ? (search.period as RankingPeriod)
    : 'week'

  const modeFromSearch = VALID_MODES.has(search.mode as RankingMode)
    ? (search.mode as RankingMode)
    : undefined
  const [storedMode, setStoredMode] = useState<RankingMode>(readStoredMode)
  const mode = modeFromSearch ?? storedMode
  const rankingsQuery = useRankings(period, mode)
  const snapshot = rankingsQuery.data?.data
  const isRoot = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )

  useEffect(() => {
    saveStoredMode(mode)
    setStoredMode(mode)
    if (modeFromSearch === undefined) {
      navigate({
        to: '/rankings',
        replace: true,
        search: (prev) => ({ ...prev, mode }),
      })
    }
  }, [mode, modeFromSearch, navigate])

  const handlePeriodChange = (next: RankingPeriod) => {
    navigate({
      to: '/rankings',
      search: (prev) => ({ ...prev, period: next }),
    })
  }

  const handleModeChange = (next: RankingMode) => {
    saveStoredMode(next)
    setStoredMode(next)
    navigate({
      to: '/rankings',
      replace: true,
      search: (prev) => ({ ...prev, mode: next }),
    })
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <ChisaAmbient />
        <PageTransition className='relative mx-auto w-full max-w-[1280px] space-y-8 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
          <RankingsHero
            mode={mode}
            period={period}
            onModeChange={handleModeChange}
            onPeriodChange={handlePeriodChange}
          />

          {rankingsQuery.isLoading ? <RankingsLoading /> : null}
          {!rankingsQuery.isLoading && !snapshot ? (
            <RankingsError
              message={
                rankingsQuery.error instanceof Error
                  ? rankingsQuery.error.message
                  : t('Unable to load rankings data')
              }
            />
          ) : null}
          {!rankingsQuery.isLoading && snapshot ? (
            <>
              <ModelsSection
                history={snapshot.models_history}
                rows={snapshot.models}
                period={period}
              />

              {isRoot && snapshot.user_spending ? (
                <UserSpendingSection
                  ranking={snapshot.user_spending}
                  period={period}
                />
              ) : null}

              <MarketShareSection
                history={snapshot.vendor_share_history}
                rows={snapshot.vendors}
                period={period}
              />

              <PulseSection
                movers={snapshot.top_movers}
                droppers={snapshot.top_droppers}
              />
            </>
          ) : null}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}

function RankingsLoading() {
  return (
    <div className='space-y-6'>
      <Skeleton className='h-[420px] w-full rounded-xl' />
      <Skeleton className='h-[360px] w-full rounded-xl' />
      <Skeleton className='h-[180px] w-full rounded-xl' />
    </div>
  )
}

function RankingsError(props: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className='bg-card rounded-xl border border-dashed px-6 py-12 text-center'>
      <h2 className='text-foreground text-base font-semibold'>
        {t('Unable to load rankings')}
      </h2>
      <p className='text-muted-foreground mx-auto mt-2 max-w-md text-sm'>
        {props.message}
      </p>
    </div>
  )
}
