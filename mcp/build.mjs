// Bundles the bridge into ONE file the site serves: public/mcp/one-mcp.mjs (committed, so the
// Pages build needs nothing extra). Dependencies (MCP SDK, ws) are inlined; Node ≥ 20 runs it.
// Then packs the Claude Desktop extension around that file: public/mcp/one.mcpb (also committed;
// src/mcpb.ts — manifest, icon, README; deterministic, so an unchanged rebuild gives the same bytes).
//   node build.mjs            (npm run build:mcp at the repo root)
import { build } from 'esbuild'
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const outfile = new URL('../public/mcp/one-mcp.mjs', import.meta.url).pathname
const mcpbFile = new URL('../public/mcp/one.mcpb', import.meta.url).pathname

await build({
  entryPoints: ['src/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  // node_modules may be a symlink (worktrees): keep the bundle's module paths the same as in a plain checkout
  preserveSymlinks: true,
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
  legalComments: 'eof',
  // ws' optional native speed-ups: absent → it falls back to plain JS
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      `// SimpleCMS One — local MCP bridge ${pkg.version} (MIT). Source: https://github.com/MarcelWeissgerberIT/SimpleCMS/tree/main/mcp`,
      '// Lets an MCP client (Claude Desktop, Claude Code …) work in the One tab open in your browser.',
      '// Setup and security model: https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/MCP.md',
      // CommonJS dependencies (ws) call require() for Node built-ins; ESM output needs a real require
      "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    ].join('\n'),
  },
  define: { __VERSION__: JSON.stringify(pkg.version) },
})
chmodSync(outfile, 0o755)
console.log(`built ${outfile} (${Math.round(statSync(outfile).size / 1024)} KB)`)

/** Load a TypeScript module of src/ (bundled in memory: works on any Node ≥ 20). */
async function importTs(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', preserveSymlinks: true, format: 'esm', target: 'node20', logLevel: 'warning' })
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
}

// The coding worker (docs/CODING.md): one more file next to the bridge, public/mcp/one-worker.mjs
const workerFile = new URL('../public/mcp/one-worker.mjs', import.meta.url).pathname
await build({
  entryPoints: ['src/worker/index.ts'],
  outfile: workerFile,
  bundle: true,
  platform: 'node',
  // node_modules may be a symlink (worktrees): keep the bundle's module paths the same as in a plain checkout
  preserveSymlinks: true,
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
  legalComments: 'eof',
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      `// SimpleCMS One — coding worker ${pkg.version} (MIT). Source: https://github.com/MarcelWeissgerberIT/SimpleCMS/tree/main/mcp/src/worker`,
      '// Runs coding tasks from One with Claude Code on this computer. Setup: node one-worker.mjs --help',
      '// Docs and security model: https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/CODING.md',
      "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    ].join('\n'),
  },
  define: { __VERSION__: JSON.stringify(pkg.version) },
})
chmodSync(workerFile, 0o755)
console.log(`built ${workerFile} (${Math.round(statSync(workerFile).size / 1024)} KB)`)

const { packMcpb } = await importTs('src/mcpb.ts')
const mcpb = packMcpb({
  version: pkg.version,
  server: readFileSync(outfile),
  icon: readFileSync(new URL('../public/assets/icons/app-icon.png', import.meta.url)),
  readme: readFileSync(new URL('./mcpb/README.md', import.meta.url), 'utf8'),
})
writeFileSync(mcpbFile, mcpb)
console.log(`packed ${mcpbFile} (${Math.round(mcpb.length / 1024)} KB)`)
