/**
 * Coding pipeline — "Download the worker for this workspace". Built in the browser: this site's own
 * mcp/one-worker.mjs (same origin) with ONE line written right after its shebang —
 *   globalThis.ONE_WORKER_PRESET = {"workspace":"local:…","origin":"https://getonecms.com","port":47322,"pair":"…","name":"…"}
 * (protocol.ts WorkerPreset) — saved as one-worker.mjs. The pairing secret (32 random bytes, base64url) is
 * made per download and kept in this device's settings (state.ts `pairs`, localStorage, never synced, never in
 * a backup); a new download replaces it, so an older file stops pairing. Afterwards the link is switched on
 * (it was a manual switch) and looks for the worker every second or two for a while.
 */
import { resolveAssetUrl } from '../../lib/files'
import { workspaceInfo } from '../mcp/identity'
import { PAIR_SECRET, PRESET_GLOBAL, WORKER_CLOUD_PORT, type WorkerPreset } from './protocol'
import { cloudDownloaded, pairDownloaded } from './service'
import { useCoding } from './state'
import { createCloudWorker, serverWorkspaceId } from './cloudWorkers'

export const WORKER_FILE = 'one-worker.mjs'
/** The cloud download's name (it may sit next to a local one-worker.mjs). */
export const CLOUD_WORKER_FILE = 'one-worker-cloud.mjs'

/** 32 random bytes, base64url without padding (43 characters). */
export function newPairSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g')

/** The preset as one line of JavaScript (JSON is an expression; line separators escaped so it stays one line). */
export function presetLine(p: WorkerPreset): string {
  const json = JSON.stringify(p).replace(SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
  return `globalThis.${PRESET_GLOBAL} = ${json}`
}

/** The worker's source with the preset line after its shebang (an older preset line is replaced). */
export function withPreset(source: string, p: WorkerPreset): string {
  if (!source.startsWith('#!')) throw new Error('not the worker')
  const nl = source.indexOf('\n')
  const head = source.slice(0, nl + 1)
  let rest = source.slice(nl + 1)
  if (rest.startsWith(`globalThis.${PRESET_GLOBAL} =`)) rest = rest.slice(rest.indexOf('\n') + 1)
  return `${head}${presetLine(p)}\n${rest}`
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The preset for this tab's workspace (a fresh secret). */
export function presetFor(secret: string): WorkerPreset {
  if (!PAIR_SECRET.test(secret)) throw new Error('bad secret')
  const ws = workspaceInfo()
  return {
    workspace: ws.id,
    origin: window.location.origin,
    port: useCoding.getState().port,
    pair: secret,
    name: ws.name,
    ...(LOOPBACK.has(window.location.hostname) ? { dev: true } : {}),
  }
}

/** This site's worker (same origin), not yet preset. */
async function workerSource(): Promise<string> {
  const res = await fetch(resolveAssetUrl(`mcp/${WORKER_FILE}`), { cache: 'no-store', credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function save(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** Fetch the worker, write the preset in, save the file, keep the secret, switch the link on. */
export async function downloadWorker(): Promise<void> {
  const source = await workerSource()
  const secret = newPairSecret()
  const preset = presetFor(secret)
  save(withPreset(source, preset), WORKER_FILE)
  pairDownloaded(preset.workspace, secret)
}

/**
 * Cloud (docs/CODING.md § Cloud worker): the worker for another computer that dials this team server. The file
 * comes first (a failed fetch creates no token), then a NEW token from the server — pending: the member's working
 * cloud worker keeps working until this file connects. The token goes into the file only (never into this
 * browser's storage); the fresh pairing secret stays on this device and keys the end-to-end encryption.
 */
export async function downloadCloudWorker(): Promise<void> {
  const serverId = serverWorkspaceId()
  if (!serverId) throw new Error('not a team workspace')
  const source = await workerSource()
  const { worker, token } = await createCloudWorker(serverId)
  const secret = newPairSecret()
  const preset: WorkerPreset = { ...presetFor(secret), port: WORKER_CLOUD_PORT, cloud: { token } }
  save(withPreset(source, preset), CLOUD_WORKER_FILE)
  cloudDownloaded(preset.workspace, secret, worker.id)
}

/** The command that starts the downloaded file (Windows PowerShell spells the home folder differently). */
export function startCommand(file: string = WORKER_FILE): string {
  const win = /Windows/i.test(navigator.userAgent)
  return win ? `node $HOME\\Downloads\\${file}` : `node ~/Downloads/${file}`
}
