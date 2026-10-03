/**
 * The Claude Desktop extension (public/mcp/one.mcpb, packed by build.mjs — `npm test` builds first):
 * contents, the manifest against the published MCPB JSON schema (mcp/mcpb/, copied from
 * github.com/modelcontextprotocol/mcpb schemas/), the tool list against the contract, determinism,
 * and the bridge started the way Claude Desktop starts an installed extension.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { after, describe, test } from 'node:test'
// ajv + ajv-formats come with the MCP SDK (it validates tool schemas with them)
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { MCP_DEFAULT_PORT, MCP_TOOLS } from '../../src/app/features/mcp/contract.ts'
import { MCPB_ENTRY, MCPB_MANIFEST_VERSION, packMcpb, type McpbManifest } from '../src/mcpb.ts'
import { unzip, zip } from '../src/zip.ts'
import { BUNDLE, waitFor } from './helpers.ts'

const file = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const MCPB = file('../../public/mcp/one.mcpb')
const pkg = JSON.parse(readFileSync(file('../package.json'), 'utf8')) as { version: string }
const schema = JSON.parse(readFileSync(file(`../mcpb/mcpb-manifest-v${MCPB_MANIFEST_VERSION}.schema.json`), 'utf8')) as object
/** not the port of the other bridge tests */
const PORT = 47398

const bytes = readFileSync(MCPB)
const entries = unzip(bytes)
const manifest = JSON.parse(entries.get('manifest.json')!.data.toString('utf8')) as McpbManifest

const tmp = mkdtempSync(join(tmpdir(), 'one-mcpb-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

/**
 * What Claude Desktop runs for an installed extension (@anthropic-ai/mcpb getMcpConfigForManifest):
 * user_config defaults, overridden by the person's settings, then ${…} substituted in mcp_config.
 */
function desktopConfig(m: McpbManifest, dir: string, userConfig: Record<string, string | number> = {}) {
  const vars: Record<string, string> = { __dirname: dir }
  for (const [k, o] of Object.entries(m.user_config)) vars[`user_config.${k}`] = String(userConfig[k] ?? o.default)
  const sub = (s: string) => s.replace(/\$\{([^}]+)\}/g, (all, k: string) => vars[k] ?? all)
  const c = m.server.mcp_config
  return { command: c.command, args: c.args.map(sub), env: Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, sub(v)])) }
}

/** Unpack into a fresh folder, like Claude Desktop does on install (modes kept). */
function install(): string {
  const dir = mkdtempSync(join(tmp, 'ext-'))
  for (const [name, e] of entries) {
    const out = join(dir, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, e.data)
    if (e.mode) chmodSync(out, e.mode)
  }
  return dir
}

describe('one.mcpb', () => {
  test('a zip with the manifest, the bridge, the icon and a README', () => {
    assert.equal(bytes.readUInt32LE(0), 0x04034b50)
    assert.deepEqual([...entries.keys()], ['manifest.json', 'README.md', 'icon.png', MCPB_ENTRY])
    // the very file the site serves
    assert.ok(entries.get(MCPB_ENTRY)!.data.equals(readFileSync(BUNDLE)), 'server/one-mcp.mjs = public/mcp/one-mcp.mjs')
    assert.equal(entries.get(MCPB_ENTRY)!.mode, 0o755)
    assert.equal(entries.get('manifest.json')!.mode, 0o644)
    // icon: a 512×512 PNG
    const icon = entries.get('icon.png')!.data
    assert.equal(icon.subarray(1, 4).toString('latin1'), 'PNG')
    assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [512, 512])
    const readme = entries.get('README.md')!.data.toString('utf8')
    assert.match(readme, new RegExp(`Claude Desktop extension ${pkg.version.replaceAll('.', '\\.')}`))
    assert.doesNotMatch(readme, /\{\{/)
  })

  test('the manifest is valid against the published MCPB schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    assert.ok(validate(manifest), JSON.stringify(validate.errors, null, 2))
    // the schema checks shapes; these are the rules of the spec around it
    assert.equal(manifest.manifest_version, MCPB_MANIFEST_VERSION)
    assert.equal(manifest.version, pkg.version)
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
    assert.equal(manifest.server.type, 'node')
    assert.ok(entries.has(manifest.server.entry_point), 'entry_point is in the bundle')
    assert.ok(entries.has(manifest.icon), 'icon is in the bundle')
    assert.deepEqual(manifest.server.mcp_config.args, [`\${__dirname}/${manifest.server.entry_point}`])
    // every ${user_config.x} has a matching option with a default (never left unsubstituted)
    for (const v of Object.values(manifest.server.mcp_config.env)) {
      const key = /^\$\{user_config\.([^}]+)\}$/.exec(v)?.[1]
      assert.ok(key && manifest.user_config[key]?.default !== undefined, v)
    }
    // also invalid input is caught: the schema is strict (no unknown fields)
    assert.equal(validate({ ...manifest, server: { ...manifest.server, kind: 'node' } }), false)
  })

  test('declares the contract tools, in order; the port setting maps to ONE_MCP_PORT', () => {
    assert.deepEqual(
      manifest.tools.map((t) => t.name),
      MCP_TOOLS.map((t) => t.name),
    )
    for (const t of manifest.tools) assert.ok(t.description.length > 10 && t.description.length < 100, t.name)
    assert.equal(manifest.user_config.port!.default, MCP_DEFAULT_PORT)
    assert.equal(manifest.server.mcp_config.env.ONE_MCP_PORT, '${user_config.port}')
    assert.equal(manifest.server.mcp_config.env.ONE_ORIGINS, '${user_config.origins}')
  })

  test('deterministic: packing the same files again gives the same bytes', () => {
    const again = packMcpb({
      version: pkg.version,
      server: readFileSync(BUNDLE),
      icon: readFileSync(file('../../public/assets/icons/app-icon.png')),
      readme: readFileSync(file('../mcpb/README.md'), 'utf8'),
    })
    assert.ok(again.equals(bytes), 'rebuilt bundle differs from public/mcp/one.mcpb (run npm run build:mcp)')
    // the zip round-trips (stored and deflated entries)
    const z = zip([
      { name: 'a.txt', data: Buffer.from('a'.repeat(1000)) },
      { name: 'b/c.bin', data: Buffer.from([1, 2, 3]), mode: 0o755 },
    ])
    const back = unzip(z)
    assert.equal(back.get('a.txt')!.data.toString(), 'a'.repeat(1000))
    assert.deepEqual([...back.get('b/c.bin')!.data], [1, 2, 3])
    assert.equal(back.get('b/c.bin')!.mode, 0o755)
    assert.throws(() => zip([{ name: '../evil', data: Buffer.alloc(1) }]))
  })

  test('installed like Claude Desktop does: the defaults, --version', () => {
    const dir = install()
    const cfg = desktopConfig(manifest, dir)
    assert.deepEqual(cfg.env, { ONE_MCP_PORT: String(MCP_DEFAULT_PORT), ONE_ORIGINS: '' })
    assert.equal(cfg.args[0], join(dir, MCPB_ENTRY))
    assert.equal(execFileSync(process.execPath, [cfg.args[0]!, '--version'], { encoding: 'utf8' }).trim(), pkg.version)
  })

  test('installed like Claude Desktop does: starts over stdio with the person’s settings and lists the tools', async () => {
    const dir = install()
    const cfg = desktopConfig(manifest, dir, { port: PORT, origins: 'https://one.example.com' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: cfg.args,
      env: { PATH: process.env.PATH ?? '', ONE_MCP_WAIT_MS: '0', ...cfg.env },
      stderr: 'pipe',
    })
    let err = ''
    transport.stderr?.on('data', (d: Buffer) => {
      err += d.toString()
    })
    const client = new Client({ name: 'claude-ai', version: '1.0.0' })
    try {
      await client.connect(transport)
      await waitFor(() => err.includes(`waiting for One on ws://127.0.0.1:${PORT}`), 5000, () => err)
      assert.doesNotMatch(err, /ignoring ONE_ORIGINS/)
      const { tools } = await client.listTools()
      assert.deepEqual(
        tools.map((t) => t.name),
        manifest.tools.map((t) => t.name),
      )
    } finally {
      await client.close()
    }
  })

  test('a host that leaves the placeholders as they are gets the defaults', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUNDLE],
      // port via the real variable (not the default 47321, which a running Claude may hold)
      env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '${user_config.wait}', ONE_ORIGINS: '${user_config.origins}' },
      stderr: 'pipe',
    })
    let err = ''
    transport.stderr?.on('data', (d: Buffer) => {
      err += d.toString()
    })
    const client = new Client({ name: 'claude-ai', version: '1.0.0' })
    try {
      await client.connect(transport)
      await waitFor(() => err.includes(`waiting for One on ws://127.0.0.1:${PORT}`), 5000, () => err)
      assert.doesNotMatch(err, /ignoring ONE_ORIGINS/)
    } finally {
      await client.close()
    }
  })
})
