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
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { FadeIn } from '@/components/page-transition'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: ReactNode
  className?: string
  bordered?: boolean
}

export function EmptyState(props: EmptyStateProps) {
  const { t } = useTranslation()
  const Icon = props.icon

  return (
    <FadeIn>
      <Empty
        className={cn(
          'min-h-[300px]',
          props.bordered && 'border',
          props.className
        )}
      >
        <EmptyHeader>
          {/* Chisa sprite is always the empty-state visual; an explicit
           * `icon` prop becomes a small badge pinned to the sprite's
           * bottom-right corner instead of replacing her. */}
          <div className='relative -mb-2'>
            <img
              src='/chisa/chisa-sprite.webp'
              alt=''
              aria-hidden
              className='pointer-events-none h-28 w-auto opacity-90 select-none dark:opacity-80'
            />
            {Icon && (
              <span className='bg-background text-muted-foreground absolute -right-1 -bottom-1 rounded-full border p-1.5 shadow-sm'>
                <Icon className='size-4' />
              </span>
            )}
          </div>
          <EmptyTitle>{props.title ?? t('No Data')}</EmptyTitle>
          {props.description != null && (
            <EmptyDescription>{props.description}</EmptyDescription>
          )}
        </EmptyHeader>
        {props.action != null && <EmptyContent>{props.action}</EmptyContent>}
      </Empty>
    </FadeIn>
  )
}
