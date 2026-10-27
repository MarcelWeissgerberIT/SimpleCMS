/** Local TLS trust only. Never accepts a CA from a repository, workspace, MCP or cloud response. */
import { X509Certificate, randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as tls from 'node:tls'
import { spawn } from 'node:child_process'

type TlsApi = { getCACertificates?: (kind?: string) => string[]; setDefaultCACertificates?: (certs: string[]) => void }
const api = tls as unknown as TlsApi
const MAX = 128 * 1024
const failures = new Set<string>()
export const noteCertificateFailure = (name: string, failed: boolean) => { if (failed) failures.add(name); else failures.delete(name) }
export const certificateFile = (config: string) => join(dirname(config), 'certificates', 'trusted-ca.pem')
export function parseCertificates(pem: string) {
  if (!pem || Buffer.byteLength(pem) > MAX || /PRIVATE KEY/.test(pem)) throw Error('Choose a PEM CA certificate, never a private key (maximum 128 KiB).')
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []
  if (!blocks.length || blocks.length > 20 || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) throw Error('Choose a PEM .crt/.pem CA certificate or CA bundle (maximum 20 certificates).')
  const unique = new Map<string, { pem: string; subject: string; issuer: string; fingerprint: string; validTo: string }>()
  for (const block of blocks) {
    const c = new X509Certificate(block), now = Date.now()
    if (!c.ca || Date.parse(c.validFrom) > now || Date.parse(c.validTo) <= now) throw Error('Only currently valid CA certificates can be trusted.')
    unique.set(c.fingerprint256, { pem: c.toString(), subject: c.subject, issuer: c.issuer, fingerprint: c.fingerprint256, validTo: c.validTo })
  }
  return [...unique.values()]
}
function readSaved(config: string) {
  const file = certificateFile(config)
  if (!existsSync(file)) return []
  if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || lstatSync(file).size > MAX) throw Error('Invalid local CA file.')
  return parseCertificates(readFileSync(file, 'utf8'))
}
export function certificateStatus(config: string) {
  let certificates: ReturnType<typeof readSaved> = [], invalid = false
  try { certificates = readSaved(config) } catch { invalid = true }
  return { system: process.allowedNodeEnvironmentFlags.has('--use-system-ca') && !/(?:^|\s)--no-use-system-ca(?:\s|$)/.test(process.env.NODE_OPTIONS ?? '') && !process.execArgv.includes('--no-use-system-ca'), runtime: !!api.setDefaultCACertificates, invalid, needsAttention: failures.size > 0 || invalid, certificates: certificates.map(({ pem: _, ...c }) => c) }
}
/** Authenticated local setup UI only. Replaces this profile's explicit extra bundle; OS trust is untouched. */
export function saveCertificates(config: string, pem: string, fingerprints: unknown) {
  const certs = parseCertificates(pem)
  if (!Array.isArray(fingerprints) || JSON.stringify(fingerprints) !== JSON.stringify(certs.map(c => c.fingerprint))) throw Error('Preview and confirm the certificate fingerprints first.')
  const dir = dirname(certificateFile(config))
  if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw Error('Invalid local certificate folder.')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = join(dir, randomBytes(12).toString('hex') + '.tmp')
  writeFileSync(temp, certs.map(c => c.pem).join('\n'), { mode: 0o600, flag: 'wx' })
  try { renameSync(temp, certificateFile(config)) } finally { rmSync(temp, { force: true }) }
  return certificateStatus(config)
}
export function removeCertificates(config: string) {
  rmSync(certificateFile(config), { force: true })
  rmSync(join(dirname(certificateFile(config)), 'child-ca.pem'), { force: true })
  return certificateStatus(config)
}

/** Before network connections or managed children. Node 24/22 use OS trust, keeping Mozilla and explicit extras. */
export async function configureCertificates(config: string, self: string, args: string[]): Promise<boolean> {
  let saved: ReturnType<typeof readSaved> = []
  try { saved = readSaved(config) } catch {
    // Keep setup reachable so an expired or damaged local CA can be replaced, without trusting it.
    console.warn('[one] Local CA unavailable or expired. Open the worker certificate setup to replace or remove it.')
  }
  const originalExtra = process.env.NODE_EXTRA_CA_CERTS
  const options = process.env.NODE_OPTIONS ?? ''
  const system = process.allowedNodeEnvironmentFlags.has('--use-system-ca') && !/(?:^|\s)--no-use-system-ca(?:\s|$)/.test(options) && !process.execArgv.includes('--no-use-system-ca')
  const systemActive = /(?:^|\s)--use-system-ca(?:\s|$)/.test(options) || process.execArgv.includes('--use-system-ca')
  if (system && !systemActive) process.env.NODE_OPTIONS = (options + ' --use-system-ca').trim()
  if (saved.length) {
    let extra = ''
    const file = certificateFile(config), combined = join(dirname(file), 'child-ca.pem')
    if (originalExtra && originalExtra !== file && originalExtra !== combined) {
      if (lstatSync(originalExtra).size > MAX) throw Error('Existing NODE_EXTRA_CA_CERTS bundle is too large to combine.')
      extra = readFileSync(originalExtra, 'utf8')
      parseCertificates(extra)
    } else if (originalExtra === combined && existsSync(combined)) {
      extra = readFileSync(combined, 'utf8')
      parseCertificates(extra)
    }
    // Child CLIs inherit the approved extra CAs. Never write a system-wide or user-wide environment variable.
    const contents = parseCertificates(extra + '\n' + saved.map(c => c.pem).join('\n')).map(c => c.pem).join('\n')
    if (existsSync(combined) && (lstatSync(combined).isSymbolicLink() || !lstatSync(combined).isFile())) throw Error('Invalid child CA file.')
    const temp = combined + '.' + randomBytes(8).toString('hex')
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' })
    try { renameSync(temp, combined) } finally { rmSync(temp, { force: true }) }
    process.env.NODE_EXTRA_CA_CERTS = combined
  }
  if (api.getCACertificates && api.setDefaultCACertificates) {
    api.setDefaultCACertificates([...api.getCACertificates('default'), ...(system ? api.getCACertificates('system') : []), ...saved.map(c => c.pem)])
    return false
  }
  // Earlier Node 24/22: the flags and extra CA environment are read at process startup only.
  if ((!system || systemActive) && process.env.NODE_EXTRA_CA_CERTS === originalExtra) return false
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, ...args], { stdio: process.send ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit', env: process.env })
    // Preserve the managed supervisor's ready/update/shutdown channel on earlier Node versions too.
    const forward = (message: unknown) => { if (child.connected) child.send(message as object, () => {}) }
    if (process.send) {
      process.on('message', forward)
      child.on('message', message => { if (process.connected) process.send?.(message, () => {}) })
    }
    const stop = (signal: NodeJS.Signals) => { if (child.exitCode === null) child.kill(signal) }
    const int = () => stop('SIGINT'), term = () => stop('SIGTERM')
    process.on('SIGINT', int); process.on('SIGTERM', term)
    const clean = () => { process.off('SIGINT', int); process.off('SIGTERM', term); process.off('message', forward) }
    child.once('error', e => { clean(); reject(e) }); child.once('exit', code => { clean(); resolve(code ?? 1) })
  })
  process.exitCode = code
  return true
}
