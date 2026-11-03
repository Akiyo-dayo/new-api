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
import { useThemeCustomization } from '@/context/theme-customization-provider'

/**
 * Resolves skin-branded artwork for the active theme preset. Chisa is the
 * shipped default and keeps the historical `/chisa/` paths; the Phoebe
 * preset swaps in the `/phoebe/` artwork. Returns the paths plus `isPhoebe`
 * so callers can also switch accent colors and copy.
 */
export function useSkinAssets() {
  const { customization } = useThemeCustomization()
  const isPhoebe = customization.preset === 'phoebe'
  return {
    isPhoebe,
    sprite: isPhoebe
      ? '/phoebe/phoebe-sprite.webp'
      : '/chisa/chisa-sprite.webp',
    icon: isPhoebe ? '/phoebe/phoebe-icon.webp' : '/chisa/chisa-icon.webp',
    splash: isPhoebe
      ? '/phoebe/phoebe-splash.webp?v=phoebe-r4'
      : '/chisa/chisa-splash.webp',
    convene: isPhoebe
      ? '/phoebe/phoebe-convene.webp?v=phoebe-r3'
      : '/chisa/chisa-convene.webp',
    keyArt: isPhoebe
      ? '/phoebe/phoebe-key-art.webp?v=phoebe-r3'
      : '/chisa/academy-key-art.webp',
    emblem: isPhoebe ? '/phoebe/order-emblem.png' : '/chisa/sta-emblem.png',
  }
}
