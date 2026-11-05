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

import { useSkinAssets } from '@/hooks/use-skin-assets'

/**
 * Shared ambient backdrop for public pages — skin-tinted radial glows
 * matching the landing hero (Chisa crimson/gold/violet by default, Phoebe
 * sapphire/gold/sky under the Phoebe preset), anchored to the top of the
 * page and dissolving downward so content stays readable.
 *
 * Purely decorative; renders nothing interactive.
 */
export function ChisaAmbient({ className }: { className?: string }) {
  const { isAemeath, isAtri, isLumen, isPhoebe } = useSkinAssets()
  let glows = [
    'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.55 0.21 16 / 80%) 0%, transparent 70%)',
    'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.72 0.11 78 / 60%) 0%, transparent 70%)',
    'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.45 0.09 310 / 40%) 0%, transparent 70%)',
  ]
  if (isPhoebe) {
    glows = [
      'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.52 0.14 258 / 80%) 0%, transparent 70%)',
      'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.78 0.07 245 / 60%) 0%, transparent 70%)',
      'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.5 0.1 235 / 40%) 0%, transparent 70%)',
    ]
  }
  if (isAtri) {
    glows = [
      'radial-gradient(ellipse 62% 52% at 18% 18%, oklch(0.62 0.12 211 / 76%) 0%, transparent 70%)',
      'radial-gradient(ellipse 48% 42% at 82% 12%, oklch(0.75 0.1 184 / 54%) 0%, transparent 70%)',
      'radial-gradient(ellipse 38% 34% at 52% 72%, oklch(0.72 0.12 28 / 30%) 0%, transparent 70%)',
    ]
  }
  // Token skins tint the backdrop with the active palette rather than
  // fixed hues, so the glows follow light and dark mode on their own.
  if (isAemeath) {
    glows = [
      'radial-gradient(ellipse 60% 50% at 20% 20%, color-mix(in oklch, var(--primary) 70%, transparent) 0%, transparent 70%)',
      'radial-gradient(ellipse 50% 40% at 80% 15%, color-mix(in oklch, var(--secondary) 60%, transparent) 0%, transparent 70%)',
      'radial-gradient(ellipse 40% 35% at 50% 70%, color-mix(in oklch, var(--chart-3) 40%, transparent) 0%, transparent 70%)',
    ]
  }
  if (isLumen) {
    glows = [
      'radial-gradient(ellipse 70% 55% at 8% 0%, color-mix(in oklch, var(--primary) 80%, transparent) 0%, color-mix(in oklch, var(--primary) 25%, transparent) 45%, transparent 72%)',
      'radial-gradient(ellipse 40% 35% at 85% 60%, color-mix(in oklch, var(--chart-2) 30%, transparent) 0%, transparent 70%)',
    ]
  }
  return (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.14] ${className ?? ''}`}
        style={{
          background: glows.join(', '),
          maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black 40%, transparent 100%)',
        }}
      />
      {isAtri && (
        <svg
          data-atri-element='ambient-waves'
          aria-hidden='true'
          className='atri-ambient-waves text-primary/20 pointer-events-none absolute top-20 left-0 h-40 w-full'
          viewBox='0 0 1440 160'
          preserveAspectRatio='none'
          fill='none'
        >
          <path
            d='M-80 62C110 8 244 116 438 62S774 8 962 62s360 54 558-4'
            stroke='currentColor'
            strokeWidth='1.2'
          />
          <path
            d='M-110 92c208-54 354 54 548 0s354-54 548 0 374 54 574-8'
            stroke='currentColor'
            strokeWidth='0.8'
            opacity='0.65'
          />
        </svg>
      )}
    </>
  )
}
