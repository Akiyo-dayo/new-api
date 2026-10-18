import { useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api'

import type { Sample } from './components/sample-card'
import {
  safeError,
  transportFor,
  type Connection,
  type Mode,
} from './lib/connection'
import { referenceFile } from './lib/reference-version'
import { inspectionResponse } from './lib/response'
import { isBusy, idleSample } from './lib/sample'
import { useFingerprintAnalysis } from './use-fingerprint-analysis'
import { generateChallenges } from './vendor/challenge-browser'
import {
  complete,
  endpoint,
  type CompletionTransport,
} from './vendor/detection'
import { parseNumbers } from './vendor/fingerprint-core'
import {
  assertTokenizerBank,
  type TokenizerBank,
} from './vendor/tokenizer-bank'
import { probeTokenizer, type TokenizerRun } from './vendor/tokenizer-probe'
import type { Analysis, ApiConfig } from './vendor/types'

interface Settings {
  mode: Mode
  group: string
  config: ApiConfig
  connection: Connection
  proxy: string
  autoVerify: boolean
  tokenizer: boolean
}
export function useInspection(settings: Settings) {
  const analysis = useFingerprintAnalysis()
  const [challenges, setChallenges] = useState(() => generateChallenges())
  const [samples, setSamples] = useState<Sample[]>(() => [
    idleSample(),
    idleSample(),
    idleSample(),
  ])
  const [result, setResult] = useState<Analysis | null>(null)
  const [testedModel, setTestedModel] = useState<string | null>(null)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState('')
  const [probe, setProbe] = useState<TokenizerRun | null>(null)
  const [probing, setProbing] = useState(false)
  const runs = useRef(new Map<number, AbortController>())
  const probeController = useRef<AbortController | null>(null)
  const currentSamples = useRef(samples)
  const generation = useRef(0)
  const mounted = useRef(true)
  const patch = (index: number, value: Partial<Sample>) => {
    const next = currentSamples.current.map((sample, i) =>
      i === index ? { ...sample, ...value } : sample
    )
    currentSamples.current = next
    setSamples(next)
  }
  const stopProbe = () => {
    probeController.current?.abort()
    probeController.current = null
    setProbing(false)
  }
  const stop = (index?: number) => {
    for (const [i, controller] of runs.current) {
      if (index !== undefined && i !== index) continue
      controller.abort()
      runs.current.delete(i)
      patch(i, { state: 'stopped', draft: undefined })
    }
    if (index === undefined) {
      generation.current++
      stopProbe()
    }
  }
  useEffect(() => {
    mounted.current = true
    const active = runs.current
    const epoch = generation
    return () => {
      mounted.current = false
      epoch.current++
      for (const controller of active.values()) controller.abort()
      active.clear()
      probeController.current?.abort()
    }
  }, [])
  const reset = () => {
    stop()
    setChallenges(generateChallenges())
    currentSamples.current = [idleSample(), idleSample(), idleSample()]
    setSamples(currentSamples.current)
    setResult(null)
    setError('')
    setComputing(false)
    setProbe(null)
  }
  const edit = (index: number, text: string) => {
    if (runs.current.has(index) || computing) return
    patch(index, {
      text,
      draft: undefined,
      state: 'idle',
      error: undefined,
      elapsed: undefined,
      throughput: undefined,
    })
    setResult(null)
  }
  const verify = async () => {
    if (
      runs.current.size ||
      computing ||
      !currentSamples.current.some((s) => s.text.trim())
    ) {
      return
    }
    const token = ++generation.current
    setComputing(true)
    setError('')
    try {
      const value = await analysis.analyze(
        currentSamples.current.map((sample, i) => ({
          text: sample.text,
          expected_count: challenges[i].expected_count,
        }))
      )
      if (mounted.current && token === generation.current) {
        setResult(value)
        setTestedModel(
          settings.mode === 'manual' ? null : settings.config.model
        )
      }
    } catch (failure) {
      if (mounted.current && token === generation.current) {
        setError(safeError(failure, settings.config.apiKey))
      }
    } finally {
      if (mounted.current && token === generation.current) setComputing(false)
    }
  }
  const transport: CompletionTransport =
    settings.mode === 'site'
      ? async (_url, _config, body, signal) => {
          const response = await api.post(
            '/pg/chat/completions',
            { ...body, group: settings.group },
            {
              signal,
              responseType: 'stream',
              validateStatus: () => true,
              adapter: 'fetch',
              skipErrorHandler: true,
            } as Record<string, unknown>
          )
          return inspectionResponse(response)
        }
      : transportFor(settings.connection, settings.proxy)
  const probeStart = async () => {
    if (probeController.current) return
    const controller = new AbortController()
    probeController.current = controller
    setProbing(true)
    const config = { ...settings.config }
    try {
      if (!analysis.reference?.version) {
        throw new Error('Reference data is not ready')
      }
      const response = await referenceFile(
        analysis.reference.version,
        'tokenizer_bank.json'
      )
      if (!response.ok) throw new Error('Tokenizer reference download failed')
      const bank: unknown = await response.json()
      assertTokenizerBank(bank)
      await probeTokenizer(config, bank as TokenizerBank, {
        url: endpoint(config),
        transport,
        signal: controller.signal,
        concurrency: config.parallel ? 4 : 1,
        onUpdate: (value) => {
          if (mounted.current && probeController.current === controller) {
            setProbe(value)
          }
        },
      })
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        setError(safeError(failure, config.apiKey))
      }
    } finally {
      if (probeController.current === controller) {
        probeController.current = null
        if (mounted.current) setProbing(false)
      }
    }
  }
  const sample = async (requested: number[]) => {
    if (computing || settings.mode === 'manual') return
    const indexes = requested.filter((i) => !runs.current.has(i))
    if (!indexes.length) return
    const config = { ...settings.config }
    const token = generation.current
    const controllers = new Map(indexes.map((i) => [i, new AbortController()]))
    for (const [i, controller] of controllers) {
      runs.current.set(i, controller)
      patch(i, { state: 'pending', draft: '', error: undefined })
    }
    setResult(null)
    setError('')
    if (settings.tokenizer && !probe && !probing) void probeStart()
    const run = async (index: number) => {
      const controller = controllers.get(index)
      if (
        !controller ||
        controller.signal.aborted ||
        token !== generation.current
      ) {
        return false
      }
      const valid = () =>
        mounted.current &&
        runs.current.get(index) === controller &&
        !controller.signal.aborted &&
        token === generation.current
      const started = performance.now()
      patch(index, { state: 'requesting' })
      try {
        const answer = await complete(
          config,
          challenges[index].prompt,
          '',
          controller.signal,
          (text) => {
            if (valid()) patch(index, { draft: text, state: 'streaming' })
          },
          transport,
          config.relaxed ? challenges[index].expected_count : undefined
        )
        if (!valid()) return false
        if (
          parseNumbers(answer.text).length <
          Math.max(80, Math.ceil(challenges[index].expected_count * 0.55))
        ) {
          throw new Error('Insufficient numbers')
        }
        patch(index, {
          text: answer.text,
          draft: undefined,
          state: answer.capped ? 'capped' : 'done',
          elapsed: performance.now() - started,
          throughput: answer.throughput,
        })
        return true
      } catch (failure) {
        if (valid()) {
          patch(index, {
            state: 'rejected',
            draft: undefined,
            error: safeError(failure, config.apiKey),
          })
        }
        return false
      } finally {
        if (runs.current.get(index) === controller) runs.current.delete(index)
      }
    }
    const accepted: boolean[] = []
    if (config.parallel) accepted.push(...(await Promise.all(indexes.map(run))))
    else for (const index of indexes) accepted.push(await run(index))
    if (
      mounted.current &&
      token === generation.current &&
      settings.autoVerify &&
      accepted.every(Boolean) &&
      currentSamples.current.every((s) => s.text.trim())
    ) {
      void verify()
    }
  }
  const replacePrompts = (indexes: number[]) => {
    if (computing || indexes.some((i) => runs.current.has(i))) return
    const fresh = generateChallenges()
    setChallenges((current) =>
      current.map((challenge, i) =>
        indexes.includes(i) ? fresh[i] : challenge
      )
    )
    for (const index of indexes) patch(index, idleSample())
    setResult(null)
  }
  return {
    replacePrompts,
    analysis,
    challenges,
    samples,
    result,
    testedModel,
    computing,
    error,
    probe,
    probing,
    busy: samples.some((s) => isBusy(s.state)),
    sample,
    stop,
    edit,
    reset,
    verify,
    probeStart,
    stopProbe,
  }
}
