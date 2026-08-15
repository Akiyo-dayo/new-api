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
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatQuota } from '@/lib/format'

import type { RankingPeriod, UserSpendingRanking } from '../types'

const PERIOD_DESCRIPTIONS: Record<RankingPeriod, string> = {
  today: 'User spending today',
  week: 'User spending this week',
  month: 'User spending this month',
  year: 'User spending this year',
}

export function UserSpendingSection(props: {
  ranking: UserSpendingRanking
  period: RankingPeriod
}) {
  const { t } = useTranslation()

  return (
    <section className='bg-card overflow-hidden rounded-lg border'>
      <header className='flex items-start justify-between gap-4 px-5 py-4'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-foreground inline-flex items-center gap-2 text-base font-semibold'>
            <Users className='text-primary size-4' />
            {t('User Spending Leaderboard')}
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(PERIOD_DESCRIPTIONS[props.period])}
          </p>
        </div>
        <div className='shrink-0 text-right'>
          <div className='text-foreground font-mono text-2xl font-semibold tabular-nums'>
            {formatQuota(props.ranking.total_quota)}
          </div>
          <div className='text-muted-foreground/80 text-[10px] font-medium tracking-widest uppercase'>
            {t('total spending')}
          </div>
        </div>
      </header>

      <div className='border-t px-5 py-2'>
        {props.ranking.users.length === 0 ? (
          <div className='text-muted-foreground/80 py-8 text-center text-sm'>
            {t('No user spending data')}
          </div>
        ) : (
          <ul className='divide-border divide-y'>
            {props.ranking.users.map((row) => (
              <li key={row.user_id} className='flex items-center gap-3 py-3'>
                <span className='text-muted-foreground/80 w-6 shrink-0 text-right font-mono text-xs tabular-nums'>
                  {row.rank}.
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='text-foreground truncate text-sm font-medium'>
                    {row.username || t('Unnamed user')}
                  </p>
                  <p className='text-muted-foreground/70 text-xs'>
                    {t('User ID')}: {row.user_id}
                  </p>
                </div>
                <div className='text-foreground shrink-0 font-mono text-sm font-semibold tabular-nums'>
                  {formatQuota(row.total_quota)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
