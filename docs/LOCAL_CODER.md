# Local coding assistant via MCP

One can call a coding model on this computer directly, without Anthropic or another cloud provider in the path.
Open **Settings → AI → Local model → Test coding** (or **Set up local model** first). This is a dedicated task panel, separate from the Claude
AI terminal and the Claude Code coding worker. It returns code and reviews; it does not edit project files,
execute shell commands or run the coding pipeline. Selected source and document excerpts are sent only when you press **Run locally**.

## Start the service

### Choose the coding agent for a pipeline task (worker 1.15.0)

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
- Input: 512 KiB per request, task 20,000 characters, context 60,000 characters, output 8,192 tokens at most;
  120 authenticated requests/minute; one model task at a time. The larger byte envelope accommodates multibyte text; schema character limits still apply.
- The key authorizes this local service, not every program on the Mac. It is separate from Ollama's unauthenticated
  loopback API. A process already running as your user may read your key file or call Ollama directly. This does
  not protect against a compromised user account or same-origin script access to One's device vault.
- Rotate with `node public/mcp/one-local-coder.mjs --rotate-key`; existing clients lose access immediately.
  Copy the new key into One. The running service reads the key file on every request.

Environment: `ONE_CODER_PORT` (11435), `ONE_CODER_MODEL` (marcel-coder), `ONE_CODER_OLLAMA`
(`http://127.0.0.1:11434`, loopback only), `ONE_CODER_KEY_FILE`, `ONE_CODER_ORIGINS`,
`ONE_CODER_MCP_SERVERS` (comma-separated names), `ONE_CODER_MCP_CONFIG` (personal JSON connections).
The adapter is stateless MCP Streamable HTTP at `/mcp` with JSON responses, no persistent server events.
Tools: `coding_status`, `coding_task { task, context?, max_tokens? }`.

## Files and folders in the local panel

**Add files** accepts text/source, CSV/JSON, ZIP, text-layer PDF, Word DOCX and Excel XLSX. **Choose folder** reads the files you explicitly select through the browser's folder picker. It grants no continuing access to your disk. Files and extracted text stay in memory for this settings session; they are not added to workspace sync or a cloud provider. Closing/reopening the subdialog retains selected text until Settings closes; reload clears it. Remove individual files or use **Clear selection**.

Each entry has a checkbox and an extracted-text preview. **Context preview** shows the exact context sent with the task. Large selections use keyword-ranked passages with file names and source line numbers. The UI reports omitted passages; extraction limits are marked separately. This is bounded local retrieval, not model training or a complete reading of every selected document.

Limits: 100 entries, 10 MiB per file, 50 MiB per selection, ZIP at most 12 MiB actually decompressed and 3,000 entries inspected; no recursive archives. Document XML is preflighted against 12 MiB before Word/Excel conversion. At most 80,000 extracted characters per file and 500,000 retained across the selection; the request carries at most 60,000 context characters including pasted text. PDF reads at most 100 pages. Mozilla PDF.js and its worker are bundled locally (lazy-loaded); no document is sent to a PDF service. Scanned PDFs need OCR, which the current text model does not provide. Images/audio/video and legacy binary Office formats are reported as unsupported. Hidden files, credential/key files, generated folders and invalid archive paths are excluded; review your selected documents for other sensitive content before sending.

## Stronger local worker (1.15.0)

The coding pipeline's local adapter now provides:

- `search_files`: bounded literal source search, paths and line numbers; generated/hidden/credential files excluded.
- `read_file`: source ranges, at most 400 lines/20,000 characters per call, total file size at most 200 KB.
- `edit_file`: unique exact replacement, only in passages read from the current file; stale reads, ambiguous matches, symlinks and hard links are refused.
- `write_file`: new files or complete replacements after reading the complete current file; no `.git` access.
- `update_plan`: a task-local working plan kept when earlier tool history is compacted. It is not persistent training or cross-task memory.
- `run_checks`: only this repository's configured analysis/test commands. No model-supplied shell commands. Available only in implementation stages with configured checks.

Root AGENTS.md, CLAUDE.md, README.md and package.json excerpts are loaded as project guidance. Nested guidance can be found/read with the source tools. Before returning a successful implementation, the worker runs configured checks. Failed output is returned to the model for repair, bounded by the shared step budget and at most three verification runs. Failed checks cannot be reported as a successful stage. The pipeline's later Test stage remains available. Check commands execute project code with the same permissions as the existing worker Test stage; file-tool boundaries are not an operating-system sandbox.

## MCP cooperation: Atlas and other servers

The worker uses the named MCP servers already selected on its setup page: **Own MCP servers for Claude Code and local Ollama** per repository; an empty repository list falls back to the worker's default MCP list for local mode. The names are read from your personal `~/.claude.json` → `mcpServers` (user scope), or the JSON file named by `ONE_CODER_MCP_CONFIG`. It never loads a project's executable `.mcp.json`. Supported transports: stdio, Streamable HTTP, explicit SSE. HTTP uses HTTPS (or loopback), refuses redirects/cross-origin requests and keeps authentication in the connector. `${ENV_VAR}` and `${ENV_VAR:-default}` references are expanded in the connection, not in model context. Remote connections requiring an interactive OAuth sign-in must be authenticated separately; the worker cannot manufacture an account token.

Tools are discovered lazily using `mcp_search_tools`, then called with `mcp_call_tool {server,name,arguments}`. The catalog includes schemas; model-supplied server names cannot introduce a new URL or command. Multiple servers and local tools share the same task context and step budget. A task can read an Atlas record, inspect code, make a patch, run checks, and use those verified results in subsequent tools. External writes are available during implementation only and must follow the user's task. One's own connection is task-scoped through `one_task_read/note/ask`; a separate unrestricted personal `one` server is not attached.

Read-only plan/document stages filter tools by `readOnlyHint: true`. A small explicit Atlas read profile supports older Atlas servers without annotations (search/get/query/context/briefing/constraints/children/report/setup-read/code-resolve/tenant-search). Other personal server entries may declare `oneReadOnlyTools: ["exact_tool_name"]` when the owner has checked which operations only read. No name-based guessing grants arbitrary tools read access. The external server enforces its account's permissions; annotations and profiles do not make an operating-system sandbox. Configured stdio programs are trusted installed programs; the worker resolves them outside task worktrees with cleaned PATH/shim handling.

For the standalone local panel, set `ONE_CODER_MCP_SERVERS=atlas,hypnotiq` on the local service and restart it. This panel uses read-only tools and a disposable empty folder; selected document excerpts remain its source context. It cannot edit project files or run shell commands. `coding_status` reports configured names; each request checks their availability. The model is told which servers are unavailable. Credentials are never listed in tool discovery or model prompts; known connector credentials are removed from returned text.

### Repeatable local model benchmark

With Node 24 and Ollama running:

```sh
cd mcp
node src/worker/local-benchmark.ts --run
# optional: --limit=3 for a short smoke test
# ONE_CODER_MODEL selects another installed model for the same tasks
```

Ten small CMS-related programming tasks run in disposable folders, with fixed checks and a JSON report (pass/fail, time, steps). They never alter your project. This is a smoke benchmark, not an Opus/Sol comparison or proof of large-project autonomy. Keep reports to compare future model/harness changes. The existing model remains the default until a candidate performs better on your workloads; no larger model is downloaded automatically.

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
