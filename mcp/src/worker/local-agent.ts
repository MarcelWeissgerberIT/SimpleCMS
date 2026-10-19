import { realpath, readdir, readFile, mkdir, lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CodexRun, CodexResult } from './codex.ts'

const plain = (name: string, description: string, properties: object, required: string[]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } })
const pathField = { path: { type: 'string', description: 'Path relative to the task worktree' } }
const allowedMcp = new Set(['one_task_read', 'one_task_note', 'one_task_ask'])

/** A filesystem boundary, also checked through symlinks and for new files' existing ancestors. */
export async function localPath(root: string, input: unknown): Promise<string> {
  if (typeof input !== 'string' || !input || input.includes('\0') || isAbsolute(input) || input.split(/[/\\]/).some(p => p === '..' || p.toLowerCase() === '.git')) throw new Error('Use a relative path inside the worktree, outside .git.')
  const dest = resolve(root, input)
  const inside = (p: string) => { const r = relative(root, p); return !r.startsWith('..') && !isAbsolute(r) }
  if (!inside(dest)) throw new Error('Path leaves the worktree.')
  let existing = dest
  while (true) {
    try {
      const actual = await realpath(existing)
      if (!inside(actual) || relative(root, actual).split(/[/\\]/).some(p => p.toLowerCase() === '.git')) throw new Error('Symlink leaves the permitted worktree.')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      if (existing === root) throw e
      existing = dirname(existing)
    }
  }
  return dest
}

/** Local inference with flat function tools: no cloud provider, CLI or arbitrary shell execution. */
export async function runLocal(opts: CodexRun): Promise<CodexResult> {
  const result: CodexResult = { ok: false, stopped: false, limited: false, text: '', steps: 0 }
  const root = await realpath(opts.cwd)
  const base = new URL(opts.env?.ONE_CODER_OLLAMA || process.env.ONE_CODER_OLLAMA || 'http://127.0.0.1:11434')
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) return { ...result, error: 'Ollama must run at a loopback URL.' }
  const model = opts.env?.ONE_CODER_MODEL || process.env.ONE_CODER_MODEL || 'marcel-coder:latest'
  const tools: any[] = [
    plain('list_files', 'List files in a directory of this worktree, up to 200 entries. Start with path dot.', pathField, ['path']),
    plain('read_file', 'Read a UTF-8 source file (up to 20,000 characters).', pathField, ['path']),
    ...(!opts.readOnly ? [plain('write_file', 'Write the complete UTF-8 content of one source file. Read existing files before replacing them. No git metadata.', { ...pathField, content: { type: 'string' } }, ['path', 'content'])] : []),
  ]
  let client: Client | null = null
  let transport: StdioClientTransport | null = null
  const noArgumentTools = new Set<string>()
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(30 * 60000)])
  const completeReads = new Set<string>()
  try {
    if (opts.taskMcp) {
      client = new Client({ name: 'one-local-agent', version: '1.14.0' })
      const env = Object.fromEntries(Object.entries({ ...(opts.env ?? process.env), ...opts.taskMcp.env }).filter((e): e is [string, string] => typeof e[1] === 'string'))
      transport = new StdioClientTransport({ command: opts.taskMcp.command, args: opts.taskMcp.args, env, stderr: 'ignore' })
      await client.connect(transport, { timeout: 15000 })
      const list = await client.listTools()
      for (const tool of list.tools.filter(t => allowedMcp.has(t.name))) {
        // Qwen's Ollama parser needs a parameter to recognize its XML-shaped function output reliably.
        // The marker belongs only to the model adapter; the actual MCP call remains argument-free.
        const empty = !Object.keys(tool.inputSchema.properties ?? {}).length
        if (empty) noArgumentTools.add(tool.name)
        tools.push({ type: 'function', function: { name: tool.name, description: `${tool.description ?? ''}${empty ? ' Call with request="read".' : ''}`, parameters: empty ? { type: 'object', properties: { request: { type: 'string', enum: ['read'] } }, required: ['request'], additionalProperties: false } : tool.inputSchema } })
      }
    }
    const messages: any[] = [{ role: 'system', content: 'You are a local coding agent. Use the provided function tools as actual tool calls. Read source files before editing. Never claim a command or test ran unless a tool result proves it. The worker runs tests and git stages separately. Stay inside the worktree; no shell tool is available. one_task_read, one_task_note and one_task_ask are the task-scoped MCP tools when listed. In a read-only stage write_file is unavailable. Finish with your plan or a concise change summary.' }, { role: 'user', content: opts.prompt }]
    while (!signal.aborted) {
      // Stop before Ollama can truncate the task and its instructions silently.
      if (JSON.stringify({ messages, tools }).length > 60000) return { ...result, limited: true, error: 'The local model context is full. Split the task into smaller steps.' }
      const response = await fetch(new URL('/api/chat', base), { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, tools, stream: false, keep_alive: '30m', options: { num_ctx: 32768, num_predict: 4096, temperature: 0.2 } }) })
      if (!response.ok) return { ...result, error: `Ollama could not run the local coding task (HTTP ${response.status}).` }
      const data = await response.json() as { message?: any }
      if (!data.message) return { ...result, error: 'Ollama returned no message.' }
      const message = data.message
      messages.push(message)
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      if (!calls.length) {
        const text = String(message.content ?? '').slice(0, 60000)
        if (/<(?:function=|tool_call>)/.test(text)) return { ...result, error: 'The local model returned an invalid tool call. Retry or split the task into smaller steps.' }
        return { ...result, ok: true, text }
      }
      for (const call of calls) {
        if (result.steps >= opts.maxSteps) return { ...result, limited: true, error: 'The local coding agent reached its step limit.' }
        signal.throwIfAborted()
        result.steps++
        const name = call.function?.name
        const args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function?.arguments ?? {}
        let output: unknown
        try {
          if (name === 'read_file') {
            const path = await localPath(root, args.path)
            if ((await lstat(path)).size > 200000) throw new Error('File is too large; use a smaller source file.')
            const text = await readFile(path, 'utf8')
            if (text.length <= 20000) completeReads.add(path)
            output = text.length > 20000 ? `${text.slice(0, 20000)}\n[File clipped; do not replace this file from incomplete context.]` : text
          } else if (name === 'list_files') {
            output = (await readdir(await localPath(root, args.path), { withFileTypes: true })).filter(e => !['.git', 'node_modules', '.env'].includes(e.name)).slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory() }))
          } else if (name === 'write_file' && !opts.readOnly) {
            if (typeof args.content !== 'string' || args.content.length > 60000) throw new Error('File content must be text with at most 60,000 characters.')
            const path = await localPath(root, args.path)
            try {
              const existing = await lstat(path)
              if (!existing.isFile() || !completeReads.has(path)) throw new Error('Read the complete existing file before replacing it.')
            } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
            await mkdir(dirname(path), { recursive: true })
            await localPath(root, args.path)
            const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o644)
            try { await file.writeFile(args.content) } finally { await file.close() }
            completeReads.add(path)
            output = 'File written.'
          } else if (client && allowedMcp.has(name)) {
            const value = await client.callTool({ name, arguments: noArgumentTools.has(name) ? {} : args }, undefined, { timeout: 120000, signal })
            output = value
          } else throw new Error('This tool is unavailable in this stage.')
        } catch (e) { output = { error: e instanceof Error ? e.message : 'Tool failed' } }
        opts.log({ t: Date.now(), k: 'info', s: `${name}: ${typeof args.path === 'string' ? args.path.slice(0, 300) : 'task tool'}` })
        opts.progress?.({ turns: result.steps, maxTurns: opts.maxSteps, cost: 0, model })
        const text = typeof output === 'string' ? output : JSON.stringify(output)
        messages.push({ role: 'tool', tool_name: name, content: text.slice(0, 21000) })
      }
    }
    return { ...result, stopped: true }
  } catch (e) {
    if (signal.aborted) return { ...result, stopped: true, error: 'Stopped in One.' }
    return { ...result, error: e instanceof Error ? e.message : 'Local coding task failed.' }
  } finally { await client?.close().catch(() => {}); await transport?.close().catch(() => {}) }
}
