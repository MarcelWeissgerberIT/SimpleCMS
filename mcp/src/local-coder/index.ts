import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { coderServer, DEFAULT_ORIGINS } from './server.ts'

const keyFile = process.env.ONE_CODER_KEY_FILE || join(homedir(), '.config', 'one-local-coder', 'api-key')
mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 })
try { writeFileSync(keyFile, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
chmodSync(keyFile, 0o600)
if (process.argv.includes('--rotate-key')) {
  writeFileSync(keyFile, randomBytes(32).toString('base64url') + '\n', { mode: 0o600 })
  console.error(`API key rotated. Copy it from ${keyFile} into One again.`)
  process.exit(0)
}
if (process.argv.includes('--print-key')) { process.stdout.write(readFileSync(keyFile, 'utf8')); process.exit(0) }
const port = Number(process.env.ONE_CODER_PORT || 11435)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
const origins = process.env.ONE_CODER_ORIGINS ? process.env.ONE_CODER_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS
const server = coderServer({ key: () => readFileSync(keyFile, 'utf8'), origins, port,
  mcpServers: (process.env.ONE_CODER_MCP_SERVERS ?? '').split(/[\s,]+/).filter(Boolean),
  model: process.env.ONE_CODER_MODEL || 'marcel-coder', ollama: process.env.ONE_CODER_OLLAMA || 'http://127.0.0.1:11434' })
server.listen(port, '127.0.0.1', () => console.error(`One Local Coder: http://127.0.0.1:${port}/mcp\nAPI key file: ${keyFile}`))
server.on('error', error => { console.error(error.message); process.exit(1) })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
