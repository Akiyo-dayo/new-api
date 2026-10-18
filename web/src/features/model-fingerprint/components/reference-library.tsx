import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

import { downloadFile } from '../lib/connection'
import { referenceFile, type ReferenceVersion } from '../lib/reference-version'
import { parseReference, referenceSamples } from '../vendor/reference'
import type { Bank } from '../vendor/types'

export function ReferenceLibrary(props: { version?: ReferenceVersion }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const bank = useQuery({
    queryKey: ['fingerprint', 'bank', props.version?.commit],
    enabled: open && Boolean(props.version),
    queryFn: async () => {
      if (!props.version) throw new Error('Reference data is not ready')
      const response = await referenceFile(props.version, 'bank.json')
      if (!response.ok) throw new Error('Reference download failed')
      return response.json() as Promise<Bank>
    },
  })
  const references = useQuery({
    queryKey: ['fingerprint', 'references', props.version?.commit],
    enabled: open && Boolean(selected) && Boolean(props.version),
    queryFn: async () => {
      if (!props.version) throw new Error('Reference data is not ready')
      const response = await referenceFile(
        props.version,
        'unified_reference.jsonl'
      )
      if (!response.ok) throw new Error('Reference download failed')
      return parseReference(await response.text())
    },
  })
  const batches =
    references.data?.filter((batch) => batch.model.id === selected) ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Reference model library')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <Button
          variant='outline'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t(open ? 'Close library' : 'Browse reference models')}
        </Button>
        {open && (
          <>
            <Input
              aria-label={t('Search reference models')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {bank.isError && (
              <p role='alert'>
                {t('Reference download failed')}
                <Button variant='outline' onClick={() => void bank.refetch()}>
                  {t('Retry')}
                </Button>
              </p>
            )}
            <div className='grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3'>
              {bank.data?.models
                .filter((model) =>
                  `${model.display_name} ${model.family_name}`
                    .toLowerCase()
                    .includes(search.toLowerCase())
                )
                .map((model) => (
                  <Button
                    key={model.id}
                    variant={selected === model.id ? 'secondary' : 'outline'}
                    className='h-auto justify-start text-left whitespace-normal'
                    onClick={() => setSelected(model.id)}
                  >
                    {model.display_name} · {model.response_count}
                  </Button>
                ))}
            </div>
            {bank.data && (
              <Button
                variant='outline'
                onClick={() => downloadFile('fingerprint-bank.json', bank.data)}
              >
                {t('Export reference bank')}
              </Button>
            )}
            {selected && (
              <section className='space-y-3'>
                <h3>{selected}</h3>
                {references.isPending && (
                  <p role='status'>{t('Loading reference samples…')}</p>
                )}
                {references.isError && (
                  <Button
                    variant='outline'
                    onClick={() => void references.refetch()}
                  >
                    {t('Retry reference download')}
                  </Button>
                )}
                {[...referenceSamples(batches)].map(
                  ({ batch, sample }, index) => (
                    <details key={`${batch.id}-${sample.id}`}>
                      <summary>
                        {t('Reference sample {{count}}', { count: index + 1 })}
                      </summary>
                      <pre className='max-h-56 overflow-auto text-xs wrap-anywhere whitespace-pre-wrap'>
                        {JSON.stringify(sample, null, 2)}
                      </pre>
                    </details>
                  )
                )}
                {batches.length > 0 && (
                  <Button
                    variant='outline'
                    onClick={() =>
                      downloadFile(
                        'fingerprint-reference-samples.json',
                        batches
                      )
                    }
                  >
                    {t('Export model reference samples')}
                  </Button>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
