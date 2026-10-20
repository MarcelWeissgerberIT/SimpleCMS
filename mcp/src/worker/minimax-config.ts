/** Worker-owned API credentials. Neither One's workspace nor MCP children receive this file. */
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const MINIMAX_MODEL = 'MiniMax-M3.1-Flash'
export const MINIMAX_CONTEXTS = [65536, 131072, 262144, 1000000] as const
export const MINIMAX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export interface MiniMaxConfig { apiKey: string; contextTokens: number; effort: typeof MINIMAX_EFFORTS[number] }
export const minimaxFile = (workerFile: string) => join(dirname(workerFile), 'minimax.json')
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[!-~]{16,4096}$/.test(value)

export function readMiniMax(workerFile: string, env: NodeJS.ProcessEnv = process.env): MiniMaxConfig {
  let raw: any = {}
  const file = minimaxFile(workerFile)
  if (existsSync(file)) {
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 8192 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('MiniMax settings must be a private file (chmod 600).')
      try { raw = JSON.parse(readFileSync(fd, 'utf8')) } catch { throw new Error('Invalid MiniMax settings file. Replace it on the setup page.') }
    } finally { closeSync(fd) }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid MiniMax settings.')
  const apiKey = env.MINIMAX_API_KEY?.trim() || raw.apiKey || ''
  if (apiKey && !validKey(apiKey)) throw new Error('Invalid MiniMax API key. Replace it on the worker setup page.')
  return { apiKey, contextTokens: MINIMAX_CONTEXTS.includes(raw.contextTokens) ? raw.contextTokens : 131072, effort: MINIMAX_EFFORTS.includes(raw.effort) ? raw.effort : 'high' }
}

export function miniMaxStatus(workerFile: string) {
  try {
    const c = readMiniMax(workerFile)
    return { configured: !!c.apiKey, model: MINIMAX_MODEL, contextTokens: c.contextTokens, effort: c.effort, environment: !!process.env.MINIMAX_API_KEY?.trim() }
  } catch { return { configured: false, model: MINIMAX_MODEL, contextTokens: 131072, effort: 'high', error: 'MiniMax settings could not be read. Replace them on this page.' } }
}

export function saveMiniMax(workerFile: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid MiniMax settings.')
  const body = raw as Record<string, unknown>
  if (Object.keys(body).some(k => !['apiKey', 'contextTokens', 'effort', 'remove'].includes(k))) throw new Error('Unknown MiniMax setting.')
  const file = minimaxFile(workerFile)
  if (body.remove === true) { if (existsSync(file)) unlinkSync(file); return }
  if (!MINIMAX_CONTEXTS.includes(body.contextTokens as any) || !MINIMAX_EFFORTS.includes(body.effort as any)) throw new Error('Choose a supported MiniMax context and thinking effort.')
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new Error('Invalid MiniMax API key.')
  const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const apiKey = key || readMiniMax(workerFile, {}).apiKey
  if (key && !validKey(key)) throw new Error('Invalid MiniMax API key.')
  if (!apiKey && !process.env.MINIMAX_API_KEY?.trim()) throw new Error('Enter your MiniMax API key.')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify({ apiKey, contextTokens: body.contextTokens, effort: body.effort }) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  } finally { if (existsSync(temp)) unlinkSync(temp) }
}
