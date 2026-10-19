# Local coding assistant via MCP

One can call a coding model on this computer directly, without Anthropic or another cloud provider in the path.
Open **Settings → AI → Local coding assistant · MCP**. This is a dedicated task panel, separate from the Claude
AI terminal and the Claude Code coding worker. It returns code and reviews; it does not edit project files,
execute shell commands or run the coding pipeline. Source code is sent only when you paste it and press **Run locally**.

## Start the service

### Choose the coding agent for a pipeline task (worker 1.14.0)

On a **Coding** task, the **Type** line selects **Claude Code**, **Codex**, or **Local · Ollama**. The selection
is a regular select property of that task, so it survives reloads and sync. Existing tasks default to Claude Code.
Other databases keep their record-type picker. The selection cannot change through this picker while the task runs.
An unknown explicit choice is refused; a worker that lacks `agent:codex` / `agent:local` never runs it as Claude.

Download and start the updated worker under **Settings → Coding worker**. Claude uses the existing Claude Code
installation and permissions. Codex uses a recent **Codex CLI** (`codex exec` must support
`--ignore-user-config`); `CODEX_BIN` may point to it. Cloud Codex uses its own login (`codex login`). On a Mac the worker
also finds the CLI shipped with ChatGPT/Codex when it is not on PATH. Local calls this computer's Ollama directly with `marcel-coder:latest`. Flat function tools read and write
source files inside the worktree and call the task-scoped MCP tools. It needs no Codex CLI and exposes no arbitrary
shell command tool; One's configured test and git stages still run through the worker. Local mode does not send the task to OpenAI.

The worker makes the worktree as before. Codex plans and documents use its read-only sandbox; implementation uses workspace-write. Local plans and
documents get only read tools; implementation adds a file-writing tool confined to the worktree. It passes no sandbox-bypass flag. Denied operations do not trigger an unattended approval.
Task context, notes and questions are available via the worker's scoped MCP tools (read/note/ask only). Codex
explicitly approves these three tools for this task; local inference uses the MCP client directly. User-configured Codex MCP servers are not attached. Local tool calling depends on the
model's capabilities; source-code tasks should include clear goals and acceptance criteria.

Stop terminates the process tree, output and steps are bounded, and One still owns tests and git actions. Claude model
overrides apply only to Claude; the task panel hides them for the other agents. The worker owner may set
`ONE_CODEX_MODEL` for Codex or `ONE_CODER_MODEL` for Ollama. Codex CLI does not report dollar cost, so One reports no
new dollar amount for those runs; its dollar limit cannot cap Codex spending. Local inference has no provider token fee.
The separate API-key-protected MCP task panel below remains available for code proposals without repository access.

References: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Standalone MCP task panel

1. Install/start Ollama and load a coding model. The default model name is `marcel-coder` (an Ollama profile).
   For an uncustomized installation use `ollama pull qwen3-coder:30b` and set `ONE_CODER_MODEL=qwen3-coder:30b`.
2. Download `mcp/one-local-coder.mjs` from the same One build, or build it in this repository with
   `npm --prefix mcp ci && npm run build:mcp`. Run it using Node 22 or newer:

   ```sh
   node public/mcp/one-local-coder.mjs
   ```

3. The first start generates 32 random bytes as a base64url API key in
   `~/.config/one-local-coder/api-key` (file mode `0600`, directory created with `0700`). Print it explicitly:

   ```sh
   node public/mcp/one-local-coder.mjs --print-key
   ```

4. In One enter `http://127.0.0.1:11435/mcp`, paste that key and choose **Check & save connection**.
   This checks the MCP handshake, required tools and Ollama reachability before saving the key in One's existing
   encrypted device vault. Only the address is stored in localStorage; the key is not in workspace data, sync,
   backup or export. A saved key is used again when the input is blank. **Forget connection** deletes it.
5. Enter a task and optional source code, then **Run locally**. Results are rendered as text, never executed or
   rendered as HTML. **Stop waiting** cancels the browser request; Ollama may take time to release ongoing inference.

## Security and configuration

- The service binds **only `127.0.0.1`**. Requests require `Authorization: Bearer <key>`; no or wrong key gives `401`.
  Authentication applies to tool discovery and task execution. The key is compared using fixed-size SHA-256
  digests and a constant-time comparison. It is never logged or sent to Ollama.
- Browser origins must be explicitly allowed. Defaults: `https://getonecms.com`,
  `https://marcelweissgerberit.github.io`, `http://localhost:5173`, `http://127.0.0.1:5173`,
  `tauri://localhost`, `https://tauri.localhost`. `ONE_CODER_ORIGINS` replaces this comma-separated list. Keep
  only the origins you use. There is no wildcard CORS. A browser may also ask permission for local-network access.
- CLI MCP clients without an Origin header still need the key. One refuses non-loopback URLs and redirects,
  and sends no cookies. Preflight requests contain no key and are permitted only for allowed origins.
- Input: 128 KiB per request, task 20,000 characters, context 60,000 characters, output 8,192 tokens at most;
  120 authenticated requests/minute; one model task at a time. Multibyte text can reach the byte limit earlier.
- The key authorizes this local service, not every program on the Mac. It is separate from Ollama's unauthenticated
  loopback API. A process already running as your user may read your key file or call Ollama directly. This does
  not protect against a compromised user account or same-origin script access to One's device vault.
- Rotate with `node public/mcp/one-local-coder.mjs --rotate-key`; existing clients lose access immediately.
  Copy the new key into One. The running service reads the key file on every request.

Environment: `ONE_CODER_PORT` (11435), `ONE_CODER_MODEL` (marcel-coder), `ONE_CODER_OLLAMA`
(`http://127.0.0.1:11434`, loopback only), `ONE_CODER_KEY_FILE`, `ONE_CODER_ORIGINS`.
The adapter is stateless MCP Streamable HTTP at `/mcp` with JSON responses, no persistent server events.
Tools: `coding_status`, `coding_task { task, context?, max_tokens? }`.

## Test

```sh
cd mcp
node --test test/local-coder.test.ts
cd ..
npx playwright test tests/e2e/local-coder.spec.ts
```

Use Node 22.18+ (or Node 24) for TypeScript tests. Tests cover authentication, origin checks, key rotation,
MCP handshake/discovery, schema validation, limits, the browser connection and encrypted key storage.
The upstream model is mocked in these repeatable tests. A real Ollama run is a separate local smoke test.
