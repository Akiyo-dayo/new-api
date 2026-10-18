import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChisaAmbient } from '@/components/chisa-ambient'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getUserGroups, getUserModels } from '@/features/playground/api'
import { cn } from '@/lib/utils'

import { ApiPanel } from './components/api-panel'
import { ReferenceLibrary } from './components/reference-library'
import { ReferenceStatus } from './components/reference-status'
import { SampleCard } from './components/sample-card'
import { useModelMatchCelebration } from './lib/celebration'
import {
  downloadFile,
  readProfiles,
  type Connection,
  type Mode,
  type Profile,
} from './lib/connection'
import { exportResultImage } from './lib/export-image'
import { privacyNotice, storageNotice } from './lib/privacy'
import { useInspection } from './use-inspection'
import { anomalousSamples } from './vendor/sample-distribution'
import { TOKENIZER_MODEL } from './vendor/tokenizer-posterior'

const PRIMARY_CTA =
  'h-11 rounded-lg border-none bg-gradient-to-r from-[#e8234a] to-[#ff6b4a] px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(232,35,74,0.6)] transition-shadow hover:shadow-[0_10px_36px_-6px_rgba(232,35,74,0.75)]'

function StepHeader(props: { step: string; label: string }) {
  return (
    <div className='flex items-center gap-3'>
      <span className='border-primary/30 from-primary/15 text-primary inline-flex size-8 shrink-0 items-center justify-center rounded-lg border bg-gradient-to-br to-amber-500/15 text-xs font-bold tracking-wider'>
        {props.step}
      </span>
      <h2 className='text-sm font-semibold tracking-[0.18em] uppercase'>
        {props.label}
      </h2>
      <Separator className='flex-1' />
    </div>
  )
}

export function ModelFingerprint() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('site')
  const [group, setGroup] = useState('')
  const [model, setModel] = useState('')
  const [consent, setConsent] = useState(false)
  const [profiles, setProfiles] = useState(readProfiles)
  const [selected, setSelected] = useState(profiles[0].id)
  const profile = profiles.find((p) => p.id === selected) ?? profiles[0]
  const [connection, setConnection] = useState<Connection>('direct')
  const [proxy, setProxy] = useState('')
  const [parallel, setParallel] = useState(true)
  const [stream, setStream] = useState(true)
  const [relaxed, setRelaxed] = useState(false)
  const [autoVerify, setAutoVerify] = useState(true)
  const [tokenizer, setTokenizer] = useState(false)
  const [all, setAll] = useState(false)
  const config =
    mode === 'site'
      ? {
          ...profile,
          baseUrl: 'https://local.invalid/v1',
          model,
          apiKey: '',
          format: 'openai' as const,
          parallel,
          stream,
          relaxed,
        }
      : { ...profile, parallel, stream, relaxed }
  const inspection = useInspection({
    mode,
    group,
    config,
    connection,
    proxy,
    autoVerify,
    tokenizer,
  })
  useModelMatchCelebration(inspection.result, inspection.testedModel)
  const locked = inspection.busy || inspection.computing
  const configurationLocked = locked || inspection.probing
  const groups = useQuery({
    queryKey: ['fingerprint', 'groups'],
    queryFn: getUserGroups,
    enabled: mode === 'site',
  })
  const models = useQuery({
    queryKey: ['fingerprint', 'models', group],
    queryFn: () => getUserModels(group),
    enabled: mode === 'site' && Boolean(group),
  })
  const configured =
    mode === 'site'
      ? Boolean(model && group)
      : Boolean(profile.baseUrl && profile.model && profile.apiKey)
  const canSample =
    configured && consent && Boolean(inspection.analysis.reference)
  const anomalies = inspection.result
    ? anomalousSamples(
        inspection.samples.map((s, i) =>
          inspection.result?.diagnostics[i]?.accepted ? s.text : ''
        )
      )
    : []
  const update = (patch: Partial<Profile>) => {
    inspection.reset()
    if (patch.parallel !== undefined) setParallel(patch.parallel)
    if (patch.stream !== undefined) setStream(patch.stream)
    if (patch.relaxed !== undefined) setRelaxed(patch.relaxed)
    setConsent(false)
    setProfiles((current) =>
      current.map((p) => (p.id === selected ? { ...p, ...patch } : p))
    )
  }
  const checkboxes = [
    ['parallel', 'Three parallel requests', parallel, setParallel],
    ['stream', 'Stream responses', stream, setStream],
    [
      'relaxed',
      'Accept complete numeric samples before the stream ends',
      relaxed,
      setRelaxed,
    ],
    ['auto', 'Analyze automatically after sampling', autoVerify, setAutoVerify],
    ['tokenizer', 'Optional tokenizer probe', tokenizer, setTokenizer],
  ] as const
  const hasAnalysis = Boolean(inspection.probe) || Boolean(inspection.result)
  const noticeSection = (
    <section
      aria-label={t('API key transmission and storage')}
      className='border-border bg-muted/40 space-y-2 rounded-lg border p-4 text-sm'
    >
      <h2 className='font-medium'>
        {t('Before you send: where your data goes')}
      </h2>
      <p>{t(privacyNotice(mode, connection))}</p>
      <p className='text-muted-foreground'>{t(storageNotice)}</p>
    </section>
  )
  const optionsCard =
    mode !== 'manual' ? (
      <Card className='border-primary/20'>
        <CardContent className='space-y-4 pt-5'>
          <div className='grid gap-3'>
            {checkboxes.map(([id, label, value, setter]) => (
              <div key={id} className='flex items-center gap-2'>
                <Checkbox
                  id={`fp-option-${id}`}
                  checked={value}
                  disabled={
                    locked || (id === 'tokenizer' && inspection.probing)
                  }
                  onCheckedChange={(checked) => {
                    setter(checked === true)
                    setConsent(false)
                  }}
                />
                <Label htmlFor={`fp-option-${id}`}>{t(label)}</Label>
              </div>
            ))}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t('Three requests, regular usage charges')}
            {tokenizer &&
              ` · ${t('Tokenizer probing adds up to {{count}} paid requests.', { count: TOKENIZER_MODEL.maximumProbes + 2 })}`}
          </p>
          <div className='border-border flex items-center gap-2 border-t pt-4'>
            <Checkbox
              id='fp-consent'
              checked={consent}
              disabled={configurationLocked}
              onCheckedChange={(value) => setConsent(value === true)}
            />
            <Label htmlFor='fp-consent'>
              {t('I understand that this inspection uses my balance.')}
            </Label>
          </div>
        </CardContent>
      </Card>
    ) : null
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Model fingerprint')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='relative mx-auto w-full max-w-7xl space-y-8 pb-10'>
          <ChisaAmbient />
          <div className='relative space-y-8'>
            <header className='space-y-4 pt-2 text-center'>
              <div
                className='landing-animate-fade-up inline-flex items-center gap-2.5 rounded-full border border-rose-500/20 bg-rose-500/5 py-1.5 pr-4 pl-1.5 opacity-0'
                style={{ animationDelay: '0ms' }}
              >
                <img
                  src='/chisa/chisa-icon.webp'
                  alt=''
                  aria-hidden
                  className='size-6 rounded-full ring-1 ring-rose-500/25'
                />
                <span className='text-[11px] font-semibold tracking-[0.24em] text-rose-500 uppercase dark:text-rose-400'>
                  {t('Star Torch Academy · Model laboratory')}
                </span>
              </div>
              <h1
                className='landing-animate-fade-up bg-gradient-to-r from-[#ff4d6d] via-[#ff7a59] to-[#e8a54b] bg-clip-text text-[clamp(1.9rem,4.5vw,2.75rem)] leading-[1.15] font-bold tracking-tight text-transparent opacity-0'
                style={{ animationDelay: '60ms' }}
              >
                {t('A model name is a claim. Compare its fingerprint.')}
              </h1>
              <p
                className='landing-animate-fade-up text-muted-foreground/80 mx-auto max-w-2xl text-sm opacity-0 sm:text-base'
                style={{ animationDelay: '120ms' }}
              >
                {t(
                  'Collect three numerical responses and compare their statistical patterns with a public reference bank. No identity claims, just inspectable evidence.'
                )}
              </p>
            </header>

            <section className='space-y-5'>
              <StepHeader step='01' label={t('Configuration')} />
              <div className='grid gap-5 lg:grid-cols-5'>
                <div className='space-y-4 lg:col-span-2'>
                  <Tabs
                    value={mode}
                    onValueChange={(value) => {
                      inspection.reset()
                      setMode(value as Mode)
                      setConsent(false)
                    }}
                  >
                    <TabsList
                      className='grid w-full grid-cols-3'
                      aria-label={t('Inspection mode')}
                    >
                      <TabsTrigger value='site' disabled={configurationLocked}>
                        {t('This site models')}
                      </TabsTrigger>
                      <TabsTrigger value='api' disabled={configurationLocked}>
                        {t('Custom API')}
                      </TabsTrigger>
                      <TabsTrigger
                        value='manual'
                        disabled={configurationLocked}
                      >
                        {t('Manual numeric input')}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {mode !== 'site' && noticeSection}
                  {optionsCard}
                </div>
                <div className='flex flex-col gap-4 lg:col-span-3'>
                  {mode === 'site' && (
                    <>
                      <Card className='border-primary/20'>
                        <CardHeader>
                          <CardTitle>{t('Set up an inspection')}</CardTitle>
                        </CardHeader>
                        <CardContent className='grid gap-4 sm:grid-cols-2'>
                          <div className='space-y-2'>
                            <Label htmlFor='fingerprint-group'>
                              {t('Group')}
                            </Label>
                            <Select
                              value={group || null}
                              disabled={locked || groups.isLoading}
                              items={groups.data ?? []}
                              onValueChange={(value) => {
                                inspection.reset()
                                setGroup(value ?? '')
                                setModel('')
                                setConsent(false)
                              }}
                            >
                              <SelectTrigger
                                id='fingerprint-group'
                                aria-label={t('Group')}
                                className='w-full'
                              >
                                <SelectValue
                                  placeholder={t('Select a group')}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {groups.data?.map((g) => (
                                  <SelectItem key={g.value} value={g.value}>
                                    {g.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className='space-y-2'>
                            <Label htmlFor='fingerprint-model'>
                              {t('Model')}
                            </Label>
                            <Select
                              value={model || null}
                              disabled={locked || !group || models.isLoading}
                              items={models.data ?? []}
                              onValueChange={(value) => {
                                inspection.reset()
                                setModel(value ?? '')
                                setConsent(false)
                              }}
                            >
                              <SelectTrigger
                                id='fingerprint-model'
                                aria-label={t('Model')}
                                className='w-full'
                              >
                                <SelectValue
                                  placeholder={t('Select a model')}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {models.data?.map((m) => (
                                  <SelectItem key={m.value} value={m.value}>
                                    {m.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {(groups.isError || models.isError) && (
                            <p role='alert'>
                              {t('Could not load available groups or models.')}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                      {noticeSection}
                    </>
                  )}
                  {mode === 'api' && (
                    <ApiPanel
                      profiles={profiles}
                      profile={{
                        ...profile,
                        parallel,
                        stream,
                        relaxed,
                        autoVerify,
                        tokenizerProbe: tokenizer,
                      }}
                      disabled={configurationLocked}
                      connection={connection}
                      proxy={proxy}
                      onProfiles={(next, id) => {
                        inspection.reset()
                        setProfiles(next)
                        setSelected(id)
                        const chosen = next.find((p) => p.id === id)
                        setParallel(chosen?.parallel ?? true)
                        setStream(chosen?.stream ?? true)
                        setRelaxed(chosen?.relaxed ?? false)
                        setAutoVerify(chosen?.autoVerify ?? true)
                        setTokenizer(chosen?.tokenizerProbe ?? false)
                        setConsent(false)
                      }}
                      onUpdate={update}
                      onConnection={(value) => {
                        inspection.reset()
                        setConnection(value)
                        setConsent(false)
                      }}
                      onProxy={(value) => {
                        inspection.reset()
                        setProxy(value)
                        setConsent(false)
                      }}
                    />
                  )}
                  {mode === 'manual' && (
                    <Card className='border-border bg-muted/40 flex-1'>
                      <CardHeader>
                        <CardTitle className='text-base'>
                          {t('Manual numeric input')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className='text-muted-foreground text-sm'>
                          {t(
                            'Manual mode: pasted responses are analyzed in this browser. No model request or API key is sent. Reference files may be downloaded from this site.'
                          )}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </section>

            <section className='space-y-5'>
              <StepHeader step='02' label={t('Sampling rounds')} />
              <div className='border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm'>
                {inspection.analysis.reference ? (
                  <Badge
                    variant='outline'
                    className='border-primary/30 text-primary'
                  >
                    {t('Enabled')}
                  </Badge>
                ) : (
                  <Badge variant='secondary'>{t('Loading')}</Badge>
                )}
                <p
                  role='status'
                  className='text-muted-foreground min-w-0 flex-1'
                >
                  {inspection.analysis.reference
                    ? t('Reference bank ready: {{count}} model candidates', {
                        count: inspection.analysis.reference.models,
                      })
                    : t('Loading local reference bank…')}
                </p>
                {inspection.analysis.error && (
                  <div role='alert' className='flex items-center gap-2'>
                    <span className='text-destructive'>
                      {inspection.analysis.error}
                    </span>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={inspection.analysis.prepare}
                    >
                      {t('Retry reference download')}
                    </Button>
                  </div>
                )}
              </div>
              <div className='@container'>
                <div className='grid items-start gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3'>
                  {inspection.challenges.map((challenge, i) => (
                    <SampleCard
                      key={challenge.id}
                      index={i}
                      challenge={challenge}
                      sample={inspection.samples[i]}
                      manual={mode === 'manual'}
                      locked={inspection.computing}
                      canSample={canSample}
                      anomalous={anomalies.includes(i)}
                      onEdit={(text) => inspection.edit(i, text)}
                      onSample={() => void inspection.sample([i])}
                      onStop={() => inspection.stop(i)}
                    />
                  ))}
                </div>
              </div>
              <div className='space-y-3'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button variant='outline' onClick={inspection.reset}>
                      {t('New prompts / start over')}
                    </Button>
                    {(inspection.busy || inspection.probing) && (
                      <Button
                        variant='outline'
                        onClick={() => inspection.stop()}
                      >
                        {t('Stop inspection')}
                      </Button>
                    )}
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button
                      variant='secondary'
                      disabled={
                        locked ||
                        !inspection.samples.some((s) => s.text.trim()) ||
                        !inspection.analysis.reference
                      }
                      onClick={() => void inspection.verify()}
                    >
                      {t(
                        inspection.computing
                          ? 'Analyzing fingerprint…'
                          : 'Analyze numeric responses'
                      )}
                    </Button>
                    {mode !== 'manual' && (
                      <Button
                        className={cn(PRIMARY_CTA)}
                        disabled={!canSample || locked}
                        onClick={() =>
                          void inspection.sample(
                            inspection.samples.map((_, i) => i)
                          )
                        }
                      >
                        {t('Start inspection')}
                      </Button>
                    )}
                  </div>
                </div>
                {inspection.error && (
                  <p role='alert' className='text-destructive wrap-anywhere'>
                    {t(inspection.error)}
                  </p>
                )}
              </div>
            </section>

            {hasAnalysis && (
              <section className='space-y-5'>
                <StepHeader step='03' label={t('Analysis')} />
                <div className='grid gap-5 xl:grid-cols-2'>
                  {inspection.probe && (
                    <Card
                      className={cn(
                        'border-primary/20',
                        !inspection.result && 'xl:col-span-2'
                      )}
                    >
                      <CardHeader>
                        <CardTitle>{t('Tokenizer probe')}</CardTitle>
                      </CardHeader>
                      <CardContent className='space-y-3'>
                        <p>
                          {t(
                            'Tokenizer evidence is separate and never changes numeric fingerprint ranking.'
                          )}
                        </p>
                        {inspection.probe.verdict ? (
                          <div className='space-y-2'>
                            <p>
                              {t('Closest tokenizer class')}:{' '}
                              {inspection.probe.verdict.top.id} ·{' '}
                              {(
                                inspection.probe.verdict.confidence * 100
                              ).toFixed(1)}
                              %
                            </p>
                            <p>
                              {t('Tokenizer category')}:{' '}
                              {inspection.probe.verdict.kind}
                            </p>
                            {inspection.probe.verdict.claim && (
                              <p>
                                {t('Claim consistency')}:{' '}
                                {inspection.probe.verdict.claim.status} ·{' '}
                                {(
                                  inspection.probe.verdict.claim.probability *
                                  100
                                ).toFixed(1)}
                                %
                              </p>
                            )}
                          </div>
                        ) : (
                          <p>{t('Collecting tokenizer evidence…')}</p>
                        )}
                        <details>
                          <summary>{t('Tokenizer evidence details')}</summary>
                          <pre className='max-h-64 overflow-auto text-xs wrap-anywhere whitespace-pre-wrap'>
                            {JSON.stringify(
                              inspection.probe.posterior,
                              null,
                              2
                            )}
                          </pre>
                        </details>
                        <p>
                          {inspection.probe.baselineDrift &&
                            t('Hidden input changed between baselines.')}
                        </p>
                        {inspection.probe.steps.map((step, i) => (
                          <p
                            key={`${step.probe ?? 'baseline'}-${i === 0 ? 'initial' : 'repeat'}`}
                            className='text-xs wrap-anywhere'
                          >
                            {step.probe ?? t('Baseline')} · {step.state} ·{' '}
                            {step.tokens ?? '—'} {step.error}
                          </p>
                        ))}
                        <Button
                          variant='outline'
                          disabled={inspection.probing || !consent}
                          onClick={() => void inspection.probeStart()}
                        >
                          {t('Retry tokenizer probe')}
                        </Button>
                        {inspection.probing && (
                          <Button
                            variant='outline'
                            onClick={inspection.stopProbe}
                          >
                            {t('Stop tokenizer probe')}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  {inspection.result && (
                    <Card
                      className={cn(
                        'border-primary/30',
                        !inspection.probe && 'xl:col-span-2'
                      )}
                    >
                      <CardHeader>
                        <CardTitle>
                          {t('Closest reference candidates')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className='space-y-4'>
                        <p className='bg-gradient-to-r from-[#ff4d6d] via-[#ff7a59] to-[#e8a54b] bg-clip-text font-serif text-2xl font-bold tracking-tight text-transparent'>
                          {inspection.result.results[0]?.display_name ??
                            t('Not enough evidence')}
                        </p>
                        <p>
                          {t('Based on {{count}} valid responses', {
                            count: inspection.result.used_outputs,
                          })}
                        </p>
                        {inspection.result.used_outputs < 3 && (
                          <p>
                            {t(
                              'Partial samples provide a ranking only. Three valid responses are required for calibrated confidence.'
                            )}
                          </p>
                        )}
                        {anomalies.length > 0 && (
                          <p role='status'>
                            {t(
                              'Abnormal distribution: replace this prompt and sample again.'
                            )}
                          </p>
                        )}
                        {(inspection.result.results[0]?.probability ?? 1) <
                          0.75 && (
                          <p role='status'>
                            {t(
                              'Low confidence: compare more evidence before drawing conclusions.'
                            )}
                          </p>
                        )}
                        {inspection.result.results[0]?.model ===
                          'gpt-6-astra' && (
                          <p>
                            {t(
                              'This reference identity also covers gpt-6.1-sol; numeric fingerprints cannot distinguish these model names.'
                            )}
                          </p>
                        )}
                        {anomalies.length > 0 && (
                          <Button
                            variant='outline'
                            onClick={() => inspection.replacePrompts(anomalies)}
                          >
                            {t('Replace abnormal prompts')}
                          </Button>
                        )}
                        <ol className='space-y-2'>
                          {inspection.result.results
                            .slice(0, all ? undefined : 8)
                            .map((row, i) => (
                              <li
                                key={row.model}
                                className='border-border flex min-w-0 items-center justify-between gap-3 border-b py-2 text-sm'
                              >
                                <span className='wrap-anywhere'>
                                  {i + 1}. {row.display_name}{' '}
                                  <span className='text-muted-foreground'>
                                    {row.family_name}
                                  </span>
                                </span>
                                <span>
                                  {row.probability === null
                                    ? t('Uncalibrated')
                                    : `${(row.probability * 100).toFixed(1)}%`}
                                </span>
                              </li>
                            ))}
                        </ol>
                        <div className='flex flex-wrap gap-2'>
                          <Button
                            variant='ghost'
                            aria-expanded={all}
                            onClick={() => setAll(!all)}
                          >
                            {t(
                              all
                                ? 'Show fewer candidates'
                                : 'Show all candidates'
                            )}
                          </Button>
                          <Button
                            variant='outline'
                            onClick={() =>
                              downloadFile('model-fingerprint.json', {
                                source: 'Ikaleio/lm-detector',
                                commit:
                                  inspection.analysis.reference?.version
                                    ?.commit,
                                reference: inspection.analysis.reference,
                                model: inspection.testedModel,
                                challenges: inspection.challenges,
                                samples: inspection.samples,
                                result: inspection.result,
                                tokenizer: inspection.probe,
                              })
                            }
                          >
                            {t('Download inspection record')}
                          </Button>
                          <Button
                            variant='outline'
                            onClick={() => {
                              if (inspection.result) {
                                void exportResultImage(inspection.result, t)
                              }
                            }}
                          >
                            {t('Save result image')}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </section>
            )}

            <section className='space-y-5'>
              <StepHeader step='04' label={t('Reference data')} />
              <div className='grid gap-5 xl:grid-cols-3'>
                <div className='xl:col-span-1'>
                  <ReferenceStatus
                    loaded={inspection.analysis.reference?.version}
                    busy={configurationLocked}
                    onReload={() => {
                      inspection.reset()
                      inspection.analysis.prepare()
                    }}
                  />
                </div>
                <div className='xl:col-span-2'>
                  <ReferenceLibrary
                    version={inspection.analysis.reference?.version}
                  />
                </div>
              </div>
            </section>

            <footer className='border-border text-muted-foreground space-y-2 border-t pt-6 text-center text-sm'>
              <h2 className='font-medium'>
                {t('A reference ranking, not proof of identity')}
              </h2>
              <p className='mx-auto max-w-3xl'>
                {t(
                  'An unknown model can still resemble a model in the reference bank. Prompts, parameters and routing can change the result. Use repeated inspections and other evidence; never treat the top candidate as a verified identity.'
                )}
              </p>
              <p className='mx-auto max-w-3xl'>
                {t(
                  'Sampling goes only to this site or your selected API/proxy. Analysis stays in your browser; nothing is sent to the detector website.'
                )}
              </p>
              <p className='text-muted-foreground/70 pt-1 text-xs'>
                LM Fingerpoint Detector · MIT · 50a364bc
              </p>
            </footer>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
