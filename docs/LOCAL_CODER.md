# Local coding assistant via MCP

One can call a coding model on this computer directly, without Anthropic or another cloud provider in the path.
Open **Settings → AI → Local coding assistant · MCP**. This is a dedicated task panel, separate from the Claude
AI terminal and the Claude Code coding worker. It returns code and reviews; it does not edit project files,
execute shell commands or run the coding pipeline. Source code is sent only when you paste it and press **Run locally**.

## Start the service

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
