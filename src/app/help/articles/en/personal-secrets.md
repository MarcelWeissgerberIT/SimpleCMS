---
id: personal-secrets
title: My secrets · Personal vault
section: ai
order: 19
keywords: secrets, vault, passphrase, atlas token, agent token, claude code, security, personal storage
related: mcp-servers, custom-agents, coding-harness
summary: Store Atlas and agent tokens encrypted per person and explicitly grant them to a coding task.
---
## Set up your vault

Open **Settings → My secrets**. When signed in to a team server, the vault belongs to your One account across workspaces. The server stores a vault encrypted in your browser. On a local device without a team server, it stays in this browser profile.

Choose and confirm a separate passphrase of at least 14 characters. It is not stored and cannot be recovered. The vault locks after ten minutes without a vault action or grant and on sign-out. **Lock now** locks immediately. Locking does not stop runs already started.

## Add Atlas and agent tokens

Each entry has a unique name, an exact public HTTPS MCP URL, a token and an explicit list of allowed tools. For example, use `atlas-me` for your own access and `atlas-ba` for your BA agent. Use the MCP URL supplied by your Atlas installation.

Saving does not contact Atlas or test the token. Begin with available reading tools such as `atlas_whoami`, `atlas_search`, `atlas_get` and `atlas_context`. The tool list does not expand the token's permissions. Set its project, tenant and lifetime restrictions in Atlas as well.

**Edit** replaces a token; a blank token field keeps the saved one. **Remove from vault** removes the entry only; revoke the token in Atlas. Existing MCP connections and provider keys are not automatically migrated or changed.

## Use with a coding agent

Open a coding task with a connected, current worker. Under **My secrets · connections for this task**, explicitly select the connections for that task and displayed worker. The grant lasts only in this browser session and workspace; it is not exported or shared. Unlock before starting. An older worker or another coding engine does not silently take the grant: worker 1.28.0 supports all coding agents. Older workers refuse newly supported engines.

The worker receives only the selected connections, keeps tokens in memory and exposes `one_task_mcp_search` and `one_task_mcp_call` to the selected coding agent. The agent discovers schemas and calls allowed tools there. Token values do not enter its prompt or a project file. The temporary MCP launcher contains only the existing run-scoped One task credential. The coding agent does not load additional MCP connections from the regular worker configuration when a personal grant is in use. Connections close when the run ends. A changed worker connection requires a fresh grant.

Plan and document stages expose only known or explicitly annotated read-only tools. Implementation stages can use explicitly granted external write tools immediately. One's proposal mode does not hold these writes for review. Start with a restricted Atlas token and a short reading allow-list.

## Protection and limits

The personal vault encrypts tokens and connection metadata with AES-256-GCM, a random salt and PBKDF2-SHA-256 at 600,000 iterations. Its browser key is non-extractable and kept in memory while unlocked. Server access is restricted to the signed-in person; workspace admins cannot fetch other people's vaults. Concurrent edits conflict instead of silently overwriting another device: reload and unlock again.

Workspace content, imports, exports and shared agent definitions do not carry vault tokens. Selected token values are removed from worker output. Never paste tokens into pages or prompts. A compromised One application, browser or untrusted worker can use unlocked credentials. Use trusted devices and limited, revocable Atlas tokens.
