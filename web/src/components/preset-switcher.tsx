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
import { Check, Palette } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemeCustomization } from '@/context/theme-customization-provider'
import { THEME_PRESETS } from '@/lib/theme-customization'
import { cn } from '@/lib/utils'

/**
 * Compact theme-preset switcher for the public header. The full ConfigDrawer
 * depends on console-only providers (sidebar, layout), so public pages get
 * this preset-only entry instead.
 */
export function PresetSwitcher() {
  const { t } = useTranslation()
  const { customization, setPreset } = useThemeCustomization()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className='size-9'
            aria-label={t('Open theme settings')}
          >
            <Palette className='size-4' aria-hidden='true' />
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuLabel>{t('Color preset')}</DropdownMenuLabel>
        {THEME_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onClick={() => setPreset(preset.value)}
            aria-label={t(`preset.${preset.value}`)}
          >
            <span className='border-border/60 flex overflow-hidden rounded-full border'>
              {preset.swatches.map((swatch) => (
                <span
                  key={swatch}
                  className='size-2.5'
                  style={{ background: swatch }}
                />
              ))}
            </span>
            <span>{t(`preset.${preset.value}`)}</span>
            <Check
              aria-hidden='true'
              className={cn(
                'ml-auto size-4',
                customization.preset === preset.value
                  ? 'opacity-100'
                  : 'opacity-0'
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
