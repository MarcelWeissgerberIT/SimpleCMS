import { createServer } from 'node:http'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

/** Only the owner's personal configuration can select this file or authorization origin. */
export class MemoryOAuth implements OAuthClientProvider {
  private file: string
  private data: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirect?: string } = {}
  private verifier = ''
  private nonce = randomBytes(24).toString('base64url')
  authorize: (url: URL) => void = () => { throw new Error('Reconnect Atlas memory with --connect-atlas-memory.') }
  constructor(file: string) { this.file = file }
  async load() {
    let handle
    try {
      handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      const info = await handle.stat()
      if (!info.isFile() || info.nlink > 1 || info.size > 100000 || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('OAuth file must be private.')
      this.data = JSON.parse(await handle.readFile('utf8'))
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot load the private memory OAuth connection.') }
    finally { await handle?.close() }
  }
  setRedirect(url: string) { this.data.redirect = url }
  get redirectUrl() { return this.data.redirect || 'http://127.0.0.1/callback' }
  get clientMetadata() { return { client_name: 'One local coding memory', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' as const } }
  state() { return this.nonce }
  clientInformation() { return this.data.client }
  async saveClientInformation(client: OAuthClientInformationMixed) { this.data.client = client; await this.save() }
  tokens() { return this.data.tokens }
  async saveTokens(tokens: OAuthTokens) { this.data.tokens = tokens; await this.save() }
  redirectToAuthorization(url: URL) { this.authorize(url) }
  saveCodeVerifier(verifier: string) { this.verifier = verifier }
  codeVerifier() { if (!this.verifier) throw new Error('No active authorization attempt.'); return this.verifier }
  secrets() { return [this.data.tokens?.access_token, this.data.tokens?.refresh_token, this.data.client && 'client_secret' in this.data.client ? this.data.client.client_secret : undefined].filter((s): s is string => typeof s === 'string' && s.length >= 8) }
  async invalidateCredentials(scope: string) {
    if (scope === 'all' || scope === 'client') delete this.data.client
    if (scope === 'all' || scope === 'tokens') delete this.data.tokens
    if (scope === 'all' || scope === 'verifier') this.verifier = ''
    await this.save()
  }
  private async save() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = this.file + '.' + randomBytes(8).toString('hex') + '.tmp'
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { await handle.writeFile(JSON.stringify(this.data)); await handle.sync() } finally { await handle.close() }
    try { await rename(temp, this.file) } finally { await rm(temp, { force: true }) }
  }
}

export function memoryOAuthFetch(origin: string): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== origin || url.username || url.password) throw new Error('Cross-origin memory OAuth request refused.')
    return fetch(input, { ...init, redirect: 'error', credentials: 'omit', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) })
  }
}

/** Explicit owner-invoked setup. No browser is opened and no consent checkbox is preselected. */
export async function connectAtlasMemory() {
  const configFile = process.env.ONE_CODER_MCP_CONFIG || join(homedir(), '.claude.json')
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  const source = config.mcpServers?.['atlas-memory'] ?? config.mcpServers?.atlas
  const url = new URL(source?.url || '')
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Configure a personal HTTPS Atlas MCP URL first.')
  const fetchFn = memoryOAuthFetch(url.origin)
  const targetFile = join(homedir(), '.config', 'one', 'atlas-memory-oauth.json')
  const pendingFile = targetFile + '.' + randomBytes(8).toString('hex') + '.pending'
  const provider = new MemoryOAuth(pendingFile)
  let finish: (value: string) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const received = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject })
  void received.catch(() => {})
  const nonceHash = (s: string) => createHash('sha256').update(s).digest()
  let consumed = false
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const callback = new URL(req.url || '/', 'http://127.0.0.1')
    const valid = req.method === 'GET' && req.headers.host === new URL(provider.redirectUrl).host && callback.pathname === '/callback' && timingSafeEqual(nonceHash(callback.searchParams.get('state') || ''), nonceHash(provider.state()))
    if (!valid || consumed) { res.writeHead(400); res.end('Invalid or expired OAuth callback.'); return }
    consumed = true
    const code = callback.searchParams.get('code')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    if (!code || code.length > 4096 || callback.searchParams.has('error')) { res.end('Atlas memory authorization was declined.'); fail(new Error('Authorization declined.')); return }
    res.end('Atlas consent received. One is checking private shadow access; see the local terminal for the result.')
    finish(code)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  provider.setRedirect(`http://127.0.0.1:${(server.address() as { port: number }).port}/callback`)
  // Client registrations are bound to a redirect URI; register anew for this ephemeral loopback port.
  await provider.invalidateCredentials('client')
  provider.authorize = authorization => { process.stdout.write(`Authorize Atlas memory in your browser; explicitly choose private shadows:\n${authorization.href}\n`) }
  const timer = setTimeout(() => fail(new Error('Authorization timed out after 15 minutes. Run setup again.')), 15 * 60000)
  try {
    if (await auth(provider, { serverUrl: url, fetchFn }) !== 'REDIRECT') throw new Error('No explicit consent flow was offered.')
    const code = await received
    await auth(provider, { serverUrl: url, authorizationCode: code, fetchFn })
    // Save only an owner-configured connection, never anything in a repository. The existing project map survives.
    const latest = JSON.parse(await readFile(configFile, 'utf8'))
    latest.mcpServers['atlas-memory'] = { type: 'http', url: url.href, oneOAuthFile: targetFile, oneTaskMemoryOnly: true,
      oneAllowedTools: ['atlas_memory_save', 'atlas_context', 'atlas_get', 'atlas_search', 'atlas_whoami'],
      ...(typeof source.oneMemoryTenant === 'string' ? { oneMemoryTenant: source.oneMemoryTenant } : {}),
      oneReadOnlyTools: ['atlas_get', 'atlas_search', 'atlas_context', 'atlas_whoami'], oneMemoryProjects: source.oneMemoryProjects ?? {} }
    const temp = configFile + '.one-memory.tmp'
    await writeFile(temp, JSON.stringify(latest, null, 2), { mode: 0o600, flag: 'wx' })
    await rename(pendingFile, targetFile)
    await rename(temp, configFile)
    process.stdout.write('OAuth connection saved privately. The worker checks the shadow scope before syncing.\n')
  } finally { clearTimeout(timer); await rm(pendingFile, { force: true }); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
