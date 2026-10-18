import { referenceVersion, referenceFile } from './lib/reference-version'
import { decodeDetector } from './vendor/detector-codec'
import {
  analyzeSharedOutputs,
  supportsSharedDetector,
} from './vendor/shared-detector'
import type { Bank, Output } from './vendor/types'

let reference:
  | Promise<{
      bank: Bank
      detector: ReturnType<typeof decodeDetector>
      version: Awaited<ReturnType<typeof referenceVersion>>
    }>
  | undefined

async function loadReference() {
  if (!reference) {
    reference = referenceVersion()
      .then(async (version) => {
        const [bankResponse, detectorResponse] = await Promise.all([
          referenceFile(version, 'bank.json'),
          referenceFile(version, 'detector.bin'),
        ])
        if (!bankResponse.ok || !detectorResponse.ok) {
          throw new Error('Reference data could not be loaded. Please retry.')
        }
        const bank = (await bankResponse.json()) as Bank
        const detector = decodeDetector(
          new Uint8Array(await detectorResponse.arrayBuffer())
        )
        if (!supportsSharedDetector(bank, detector)) {
          throw new Error('Reference bank and detector versions do not match')
        }
        return { bank, detector, version }
      })
      .catch((error: unknown) => {
        reference = undefined
        throw error
      })
  }
  return reference
}

self.onmessage = async (
  event: MessageEvent<{ id: number; outputs?: Output[]; reload?: boolean }>
) => {
  const { id, outputs } = event.data
  if (event.data.reload) reference = undefined
  try {
    const { bank, detector, version } = await loadReference()
    const result = outputs
      ? analyzeSharedOutputs(outputs, bank, detector, { allowPartial: true })
      : undefined
    self.postMessage({
      id,
      result,
      reference: {
        models: bank.models.length,
        builtAt: bank.built_at,
        version,
      },
    })
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : 'Fingerprint analysis failed',
    })
  }
}
