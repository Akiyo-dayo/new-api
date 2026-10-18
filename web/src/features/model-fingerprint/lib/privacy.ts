import type { Connection, Mode } from './connection'

export function privacyNotice(mode: Mode, connection: Connection): string {
  if (mode === 'manual') {
    return 'Manual mode: pasted responses are analyzed in this browser. No model request or API key is sent. Reference files may be downloaded from this site.'
  }
  if (mode === 'site') {
    return 'Site model mode: prompts and responses pass through this site gateway and its configured provider. You do not enter an API key; the gateway uses its configured channel credentials. Normal site usage logs apply.'
  }
  if (connection === 'direct') {
    return 'Browser direct: your API key and prompts are sent directly to the API address you enter, not to this site backend or the detector website. That API receives the key and controls its own logs.'
  }
  if (connection === 'worker') {
    return 'Worker proxy: your selected proxy receives your API key, prompts and responses before forwarding to the API. Only use a proxy you trust; its logging policy is outside this site control.'
  }
  if (connection === 'auto') {
    return 'Auto route: a dummy key checks browser CORS first. If direct access fails, your real API key, prompts and responses pass through this site proxy. The selected API always receives them.'
  }
  return 'Site proxy: your API key, prompts and responses pass through this site backend memory to the API you select. This inspection handler does not store your key in its database. The API and infrastructure operators may have their own logging policies.'
}
export const storageNotice =
  'Your API key stays in browser memory by default. Remember API key writes it in plain text to localStorage on this device; exporting with a key puts it in the downloaded file. Neither action uploads a saved profile to this site. Clear saved keys on shared devices. Analysis never sends samples or keys to lm.ikale.io.'
