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

/**
 * Shared Chisa (千咲) ambient backdrop for public pages — crimson / gold /
 * dark-violet radial glows matching the landing hero, anchored to the top
 * of the page and dissolving downward so content stays readable.
 *
 * Purely decorative; renders nothing interactive.
 */
export function ChisaAmbient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.14] ${className ?? ''}`}
      style={{
        background: [
          'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.55 0.21 16 / 80%) 0%, transparent 70%)',
          'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.72 0.11 78 / 60%) 0%, transparent 70%)',
          'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.45 0.09 310 / 40%) 0%, transparent 70%)',
        ].join(', '),
        maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, black 40%, transparent 100%)',
      }}
    />
  )
}
