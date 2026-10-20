/** Worker-owned API credentials. Neither One's workspace nor MCP children receive this file. */
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const OLLAMA_CLOUD_MODEL = 'minimax-m3.1-flash'
export const OLLAMA_CLOUD_CONTEXTS = [65536, 131072, 262144, 1000000] as const
const validModel = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)
export interface OllamaCloudConfig { apiKey: string; contextTokens: number; model: string }
export const ollamaCloudFile = (workerFile: string) => join(dirname(workerFile), 'ollama-cloud.json')
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[!-~]{16,4096}$/.test(value)

export function readOllamaCloud(workerFile: string, env: NodeJS.ProcessEnv = process.env): OllamaCloudConfig {
  let raw: any = {}
  const file = ollamaCloudFile(workerFile)
  if (existsSync(file)) {
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 8192 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Ollama Cloud settings must be a private file (chmod 600).')
      try { raw = JSON.parse(readFileSync(fd, 'utf8')) } catch { throw new Error('Invalid Ollama Cloud settings file. Replace it on the setup page.') }
    } finally { closeSync(fd) }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Ollama Cloud settings.')
  const apiKey = env.OLLAMA_API_KEY?.trim() || raw.apiKey || ''
  if (apiKey && !validKey(apiKey)) throw new Error('Invalid Ollama Cloud API key. Replace it on the worker setup page.')
  return { apiKey, contextTokens: OLLAMA_CLOUD_CONTEXTS.includes(raw.contextTokens) ? raw.contextTokens : 131072, model: validModel(raw.model) ? raw.model : OLLAMA_CLOUD_MODEL }
}

export function ollamaCloudStatus(workerFile: string) {
  try {
    const c = readOllamaCloud(workerFile)
    return { configured: !!c.apiKey, model: c.model, contextTokens: c.contextTokens, environment: !!process.env.OLLAMA_API_KEY?.trim() }
  } catch { return { configured: false, model: OLLAMA_CLOUD_MODEL, contextTokens: 131072, error: 'Ollama Cloud settings could not be read. Replace them on this page.' } }
}

export function saveOllamaCloud(workerFile: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Ollama Cloud settings.')
  const body = raw as Record<string, unknown>
  if (Object.keys(body).some(k => !['apiKey', 'contextTokens', 'model', 'remove'].includes(k))) throw new Error('Unknown Ollama Cloud setting.')
  const file = ollamaCloudFile(workerFile)
  if (body.remove === true) { if (existsSync(file)) unlinkSync(file); return }
  if (!OLLAMA_CLOUD_CONTEXTS.includes(body.contextTokens as any) || !validModel(body.model)) throw new Error('Choose a supported Ollama Cloud context and model.')
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new Error('Invalid Ollama Cloud API key.')
  const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const apiKey = key || readOllamaCloud(workerFile, {}).apiKey
  if (key && !validKey(key)) throw new Error('Invalid Ollama Cloud API key.')
  if (!apiKey && !process.env.OLLAMA_API_KEY?.trim()) throw new Error('Enter your Ollama Cloud API key.')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify({ apiKey, contextTokens: body.contextTokens, model: body.model }) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  } finally { if (existsSync(temp)) unlinkSync(temp) }
}
