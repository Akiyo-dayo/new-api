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
 * A handful of lamplight motes drifting up the landing page. Positions are
 * fixed so the scene stays calm; timing is staggered per mote via CSS vars.
 * Purely decorative — `prefers-reduced-motion` freezes them in place.
 */
const MOTES = [
  { left: '18%', top: '26%', size: 7, duration: 15, delay: 0 },
  { left: '9%', top: '44%', size: 5, duration: 19, delay: 4 },
  { left: '27%', top: '58%', size: 4, duration: 17, delay: 8 },
  { left: '14%', top: '72%', size: 6, duration: 21, delay: 2 },
  { left: '58%', top: '34%', size: 4, duration: 18, delay: 6 },
  { left: '66%', top: '62%', size: 5, duration: 16, delay: 11 },
] as const

export function LumenMotes() {
  const skin = useSkinAssets()
  if (!skin.isLumen) return null

  return (
    <div
      data-lumen-element='motes'
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 overflow-hidden'
    >
      {MOTES.map((mote) => (
        <span
          key={`${mote.left}-${mote.top}`}
          className='lumen-mote'
          style={
            {
              left: mote.left,
              top: mote.top,
              width: `${mote.size}px`,
              height: `${mote.size}px`,
              '--mote-duration': `${mote.duration}s`,
              '--mote-delay': `${mote.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
