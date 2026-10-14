#!/usr/bin/env node
/**
 * CI on Windows, before the suite: the fixed ports of the mcp tests against the TCP ranges Windows keeps for itself
 * (Hyper-V, WSL, Docker — `netsh int ipv4 show excludedportrange protocol=tcp`). A test port inside such a range fails
 * at listen with EACCES; this prints the ranges and names the port and its test files before anything runs — move
 * that test's port. Elsewhere nothing is excluded: it says so and passes.
 *   node mcp/test/ports.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
/** every 47xxx number in the test files (their fixed ports, and the defaults they start workers and bridges on) */
const used = new Map()
for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
  for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\b47\d{3}\b/g)) {
    const port = Number(m[0])
    used.set(port, [...new Set([...(used.get(port) ?? []), f])])
  }
}

if (process.platform !== 'win32') {
  process.stdout.write(`not Windows: no excluded port ranges · ${used.size} fixed test ports\n`)
  process.exit(0)
}

const netsh = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'netsh.exe')
const text = execFileSync(netsh, ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], { encoding: 'utf8' })
process.stdout.write(text)
const ranges = [...text.matchAll(/^\s*(\d+)\s+(\d+)\s*\*?\s*$/gm)].map((m) => [Number(m[1]), Number(m[2])])
const hits = [...used].filter(([port]) => ranges.some(([a, b]) => port >= a && port <= b))
for (const [port, files] of hits) process.stdout.write(`EXCLUDED: test port ${port} (${files.join(', ')}) lies in a range Windows keeps — move it\n`)
process.stdout.write(`${ranges.length} excluded range(s) · ${used.size} fixed test ports · ${hits.length ? `${hits.length} inside a range` : 'none inside a range'}\n`)
process.exit(hits.length ? 1 : 0)
