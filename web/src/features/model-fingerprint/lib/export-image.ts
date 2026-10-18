import type { TFunction } from 'i18next'

import type { Analysis } from '../vendor/types'

export async function exportResultImage(
  result: Analysis,
  t: TFunction
): Promise<void> {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1100
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const styles = getComputedStyle(document.documentElement)
  const background = styles.backgroundColor
  const foreground = styles.color
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = foreground
  context.font = '32px sans-serif'
  context.fillText(t('Model fingerprint'), 80, 100)
  context.font = '52px sans-serif'
  context.fillText(
    result.results[0]?.display_name ?? t('Not enough evidence'),
    80,
    200,
    1440
  )
  context.font = '26px sans-serif'
  result.results.slice(0, 8).forEach((row, index) => {
    context.fillText(
      `${index + 1}. ${row.display_name}`,
      80,
      300 + index * 70,
      1050
    )
    context.fillText(
      row.probability === null
        ? t('Uncalibrated')
        : `${(row.probability * 100).toFixed(1)}%`,
      1260,
      300 + index * 70
    )
  })
  context.font = '22px sans-serif'
  context.fillText(
    t('A reference ranking, not proof of identity'),
    80,
    960,
    1440
  )
  context.fillText('LM Fingerpoint Detector · MIT · 50a364bc', 80, 1020)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  )
  if (!blob) throw new Error('Image export failed')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'model-fingerprint.png'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
