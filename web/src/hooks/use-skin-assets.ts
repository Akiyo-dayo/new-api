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
import type { ThemePreset } from '@/lib/theme-customization'

const SKIN_PROFILES = {
  chisa: {
    sprite: '/chisa/chisa-sprite.webp',
    icon: '/chisa/chisa-icon.webp',
    splash: '/chisa/chisa-splash.webp',
    convene: '/chisa/chisa-convene.webp',
    keyArt: '/chisa/academy-key-art.webp',
    emblem: '/chisa/sta-emblem.png',
    copy: {
      badge: 'Star Torch Academy · Registrar',
      organization: 'Star Torch Academy',
      organizationLocalized: 'Star Torch Academy · 星炬学院',
      registry: 'Star Torch Academy · Office of the Registrar',
      motto: 'Sever the Strings of Fate',
      tagline:
        'No 8AM classes, no failed courses — one student pass for every model.',
      enterAction: 'Enter Affairs System',
      joinAction: 'Enroll Now',
      pricingAction: 'Tuition & Fees',
      capability: 'Instant enrollment · Pay per credit · All courses open',
      duty: 'Registrar on duty · Kuzuha Chisa',
      character: 'Chisa · 朽叶千咲',
      signIn: 'Back to School — Sign In',
      signUp: 'Enrollment Registration',
      edition: 'Chisa Edition',
      modelLab: 'Star Torch Academy · Model laboratory',
      nodesStatusZh: '星炬学院全球节点实时运行状态',
      nodesStatusEn: 'Live status of Star Torch Academy nodes',
      komariQuote: '「 纵使长夜湮灭，星光自有其炬。 」',
      komariSignature: '千咲 · 湮灭之夜 ｜ 星炬学院 Star Torch Academy',
      seal: 'STAR TORCH ACADEMY · 星炬学院 · REGISTRAR ·',
    },
  },
  phoebe: {
    sprite: '/phoebe/phoebe-sprite.webp',
    icon: '/phoebe/phoebe-icon.webp',
    splash: '/phoebe/phoebe-splash.webp?v=phoebe-r4',
    convene: '/phoebe/phoebe-convene.webp?v=phoebe-r3',
    keyArt: '/phoebe/phoebe-key-art.webp?v=phoebe-r3',
    emblem: '/phoebe/order-emblem.png',
    copy: {
      badge: 'Order of the Deep · Acolyte',
      organization: 'Order of the Deep',
      organizationLocalized: 'Order of the Deep · 隐海修会',
      registry: 'Order of the Deep · Registry',
      motto: 'May Light Guide Your Way',
      tagline: 'May every request find its light — one pass for every model.',
      enterAction: 'Enter the Sanctum',
      joinAction: 'Join the Order',
      pricingAction: 'Offerings & Fees',
      capability: 'Instant blessing · Pay per token · Every model within reach',
      duty: 'Acolyte on duty · Phoebe',
      character: 'Phoebe · 菲比',
      signIn: 'Return to the Sanctum — Sign In',
      signUp: 'Acolyte Registration',
      edition: 'Phoebe Edition',
      modelLab: 'Order of the Deep · Model Laboratory',
      nodesStatusZh: '隐海修会全球节点实时运行状态',
      nodesStatusEn: 'Live status of Order of the Deep nodes',
      komariQuote: '「 愿你所行之路，皆有微光相伴。 」',
      komariSignature: '菲比 · 静谧夜祷 ｜ 隐海修会 Order of the Deep',
      seal: 'ORDER OF THE DEEP · 隐海修会 · ACOLYTE ·',
    },
  },
  atri: {
    sprite: '/atri/atri-sprite.webp?v=atri-r2',
    icon: '/atri/atri-icon.webp?v=atri-r2',
    splash: '/atri/atri-splash.webp?v=atri-r2',
    convene: '/atri/atri-convene.webp?v=atri-r2',
    keyArt: '/atri/atri-key-art.webp?v=atri-r2',
    emblem: '/atri/tide-emblem.svg?v=atri-r2',
    copy: {
      badge: 'ATRI · My Dear Moments',
      organization: 'ATRI',
      organizationLocalized: 'ATRI · 亚托莉',
      registry: 'ATRI · My Dear Moments',
      motto: 'Let time stop, for you are so beautiful.',
      tagline:
        'Share a summer memory with Atri — one connection for every model.',
      enterAction: 'Meet Atri Again',
      joinAction: 'Begin My Dear Moments',
      pricingAction: 'Model Rates',
      capability: 'My Dear Moments · One connection · Every model',
      duty: 'My Dear Moments · Atri',
      character: 'Atri · 亚托莉',
      signIn: 'Return to My Dear Moments — Sign In',
      signUp: 'Begin a New Memory',
      edition: 'ATRI Edition',
      modelLab: 'ATRI · Model Laboratory',
      nodesStatusZh: '与亚托莉一起查看全球节点实时状态',
      nodesStatusEn: 'Live status of nodes with Atri',
      komariQuote: '「 时间停止吧，你是多么美丽。 」',
      komariSignature: '亚托莉 · 我挚爱的时光 ｜ ATRI -My Dear Moments-',
      seal: 'ATRI · 亚托莉 · MY DEAR MOMENTS ·',
    },
  },
  aemeath: {
    sprite: '/aemeath/aemeath-sprite.webp?v=aemeath-r1',
    icon: '/aemeath/aemeath-icon.webp?v=aemeath-r1',
    splash: '/aemeath/aemeath-splash.webp?v=aemeath-r1',
    convene: '/aemeath/aemeath-convene.webp?v=aemeath-r1',
    keyArt: '/aemeath/aemeath-key-art.webp?v=aemeath-r1',
    emblem: '/aemeath/starlance-emblem.svg?v=aemeath-r1',
    copy: {
      badge: 'Rabelle College · Synchronist',
      organization: 'Rabelle College',
      organizationLocalized: 'Rabelle College · 拉贝尔学部',
      registry: 'Startorch Academy · Rabelle College',
      motto: "Let's go save the world!",
      tagline: 'A digital ghost at your side — one key for every model.',
      enterAction: 'Board the Exostrider',
      joinAction: 'Enroll at Rabelle',
      pricingAction: 'Course Rates',
      capability: 'Instant sync · Pay per token · Every model in orbit',
      duty: 'Synchronist on duty · Aemeath',
      character: 'Aemeath · 爱弥斯',
      signIn: 'Back to Rabelle — Sign In',
      signUp: 'Synchronist Registration',
      edition: 'Aemeath Edition',
      modelLab: 'Rabelle College · Model Laboratory',
      nodesStatusZh: '拉贝尔学部全球节点实时运行状态',
      nodesStatusEn: 'Live status of Rabelle College nodes',
      komariQuote: '「 星海轻歌，长航不止。 」',
      komariSignature: '爱弥斯 · 星海轻歌 ｜ 星炬学院 Startorch Academy',
      seal: 'STARTORCH ACADEMY · 拉贝尔学部 · SYNCHRONIST ·',
    },
  },
  lumen: {
    sprite: '/lumen/lumen-sprite.svg?v=lumen-r1',
    icon: '/lumen/lumen-icon.webp?v=lumen-r1',
    splash: '/lumen/lumen-splash.svg?v=lumen-r1',
    convene: '/lumen/lumen-convene.svg?v=lumen-r1',
    keyArt: '/lumen/lumen-key-art.svg?v=lumen-r1',
    emblem: '/lumen/lumen-emblem.svg?v=lumen-r1',
    copy: {
      badge: 'Lumen · Night Study',
      organization: 'Lumen Study',
      organizationLocalized: 'Lumen Study · 微光书房',
      registry: 'Lumen Study · Reading Room',
      motto: 'Think clearly. Answer kindly.',
      tagline:
        'A small, steady light for every question — one key for every model.',
      enterAction: 'Enter the Study',
      joinAction: 'Pull Up a Chair',
      pricingAction: 'Rates',
      capability: 'Steady light · Pay per token · Every model on the shelf',
      duty: 'Lamp lit · Lumen',
      character: 'Lumen · 微光',
      signIn: 'Welcome back — Sign In',
      signUp: 'Join the Study',
      edition: 'Lumen Edition',
      modelLab: 'Lumen Study · Model Laboratory',
      nodesStatusZh: '微光书房 · 全球节点实时状态',
      nodesStatusEn: 'Live status of Lumen Study nodes',
      komariQuote: '「 夜再长，也总有一盏灯为你亮着。 」',
      komariSignature: '微光 · 书房夜读 ｜ Lumen Study',
      seal: 'LUMEN STUDY · 微光书房 · NIGHT READING ·',
    },
  },
} as const

export type CharacterSkin = keyof typeof SKIN_PROFILES

/** Resolves artwork and copy for a preset. Other presets deliberately retain
 * the shipped Chisa presentation. */
export function getSkinAssets(preset: ThemePreset) {
  let key: CharacterSkin = 'chisa'
  if (
    preset === 'phoebe' ||
    preset === 'atri' ||
    preset === 'aemeath' ||
    preset === 'lumen'
  ) {
    key = preset
  }
  const profile = SKIN_PROFILES[key]
  return {
    ...profile,
    key,
    isPhoebe: key === 'phoebe',
    isAtri: key === 'atri',
    isAemeath: key === 'aemeath',
    isLumen: key === 'lumen',
    isLightSkin: key !== 'chisa',
    // Aemeath and Lumen draw their decorative colors from the active theme
    // tokens (`--primary`, `--secondary`, ...) instead of the hard-coded sky
    // and rose classes the earlier light skins ship with.
    usesThemeTokens: key === 'aemeath' || key === 'lumen',
  }
}

export function useSkinAssets() {
  const { customization } = useThemeCustomization()
  return getSkinAssets(customization.preset)
}
