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
import { describe, expect, it } from 'vitest'

import { getSkinAssets } from '@/hooks/use-skin-assets'

describe('character skin assets', () => {
  it('resolves independent ATRI artwork, copy, and light-surface behavior', () => {
    const skin = getSkinAssets('atri')

    expect(skin.key).toBe('atri')
    expect(skin.isAtri).toBe(true)
    expect(skin.isPhoebe).toBe(false)
    expect(skin.isLightSkin).toBe(true)
    expect(skin.splash).toBe('/atri/atri-splash.webp?v=atri-r2')
    expect(skin.convene).toBe('/atri/atri-convene.webp?v=atri-r2')
    expect(skin.keyArt).toBe('/atri/atri-key-art.webp?v=atri-r2')
    expect(skin.copy.organization).toBe('ATRI')
    expect(skin.copy.motto).toBe('Let time stop, for you are so beautiful.')
    expect(skin.copy.badge).not.toBe(getSkinAssets('phoebe').copy.badge)
  })

  it.each(['chisa', 'phoebe'] as const)(
    'keeps the existing %s artwork and copy unchanged',
    (preset) => {
      const skin = getSkinAssets(preset)

      expect(skin.key).toBe(preset)
      expect(skin.isAtri).toBe(false)
      expect(skin.splash).toContain(`/${preset}/`)
      expect(skin.copy.character).toContain(
        preset === 'chisa' ? 'Chisa' : 'Phoebe'
      )
    }
  )

  it('resolves Aemeath artwork and copy as a token-driven light skin', () => {
    const skin = getSkinAssets('aemeath')

    expect(skin.key).toBe('aemeath')
    expect(skin.isAemeath).toBe(true)
    expect(skin.isAtri).toBe(false)
    expect(skin.isLightSkin).toBe(true)
    expect(skin.usesThemeTokens).toBe(true)
    expect(skin.splash).toBe('/aemeath/aemeath-splash.webp?v=aemeath-r1')
    expect(skin.convene).toBe('/aemeath/aemeath-convene.webp?v=aemeath-r1')
    expect(skin.keyArt).toBe('/aemeath/aemeath-key-art.webp?v=aemeath-r1')
    expect(skin.emblem).toBe('/aemeath/starlance-emblem.svg?v=aemeath-r1')
    expect(skin.copy.organization).toBe('Rabelle College')
    expect(skin.copy.motto).toBe("Let's go save the world!")
  })

  it.each(['chisa', 'phoebe', 'atri'] as const)(
    'keeps %s on its hard-coded decorative colors',
    (preset) => {
      expect(getSkinAssets(preset).usesThemeTokens).toBe(false)
    }
  )

  it('retains Chisa assets for non-character presets', () => {
    const skin = getSkinAssets('ocean-breeze')

    expect(skin.key).toBe('chisa')
    expect(skin.splash).toBe('/chisa/chisa-splash.webp')
    expect(skin.isLightSkin).toBe(false)
  })
})
