import type { Sample } from '../components/sample-card'

export const idleSample = (): Sample => ({ text: '', state: 'idle' })
export const isBusy = (state: Sample['state']) =>
  ['pending', 'requesting', 'streaming'].includes(state)
