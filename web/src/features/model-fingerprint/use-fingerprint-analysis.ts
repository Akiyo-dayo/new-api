import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReferenceVersion } from './lib/reference-version'
import type { Analysis, Output } from './vendor/types'

type Reference = { models: number; builtAt: string; version: ReferenceVersion }
type WorkerResult = {
  id: number
  result?: Analysis
  error?: string
  reference: Reference
}

export function useFingerprintAnalysis() {
  const worker = useRef<Worker | null>(null)
  const counter = useRef(0)
  const pending = useRef(
    new Map<
      number,
      { resolve: (value: Analysis) => void; reject: (error: Error) => void }
    >()
  )
  const [reference, setReference] = useState<Reference | null>(null)
  const [error, setError] = useState('')
  const prepare = useCallback(() => {
    setError('')
    if (!worker.current) {
      const instance = new Worker(
        new URL('./analysis.worker.ts', import.meta.url),
        { type: 'module' }
      )
      instance.onmessage = (event: MessageEvent<WorkerResult>) => {
        const data = event.data
        if (data.error) setError(data.error)
        else setReference(data.reference)
        const request = pending.current.get(data.id)
        if (request) {
          if (data.error) request.reject(new Error(data.error))
          else if (data.result) request.resolve(data.result)
          pending.current.delete(data.id)
        }
      }
      instance.onerror = () => {
        const failure = new Error(
          'Fingerprint analysis worker failed. Please retry.'
        )
        setError(failure.message)
        setReference(null)
        for (const request of pending.current.values()) request.reject(failure)
        pending.current.clear()
        instance.terminate()
        worker.current = null
      }
      worker.current = instance
    }
    worker.current.postMessage({ id: ++counter.current, reload: true })
  }, [])
  useEffect(() => {
    prepare()
    const requests = pending.current
    return () => {
      worker.current?.terminate()
      worker.current = null
      for (const request of requests.values()) {
        request.reject(new Error('Analysis cancelled'))
      }
      requests.clear()
    }
  }, [prepare])
  const analyze = useCallback(
    (outputs: Output[]) =>
      new Promise<Analysis>((resolve, reject) => {
        if (!worker.current) {
          reject(new Error('Reference data is not ready'))
          return
        }
        const id = ++counter.current
        pending.current.set(id, { resolve, reject })
        worker.current.postMessage({ id, outputs })
      }),
    []
  )
  return { reference, error, prepare, analyze }
}
