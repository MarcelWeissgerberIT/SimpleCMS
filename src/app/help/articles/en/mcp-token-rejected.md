---
id: mcp-token-rejected
title: MCP token rejected
section: trouble
order: 3
keywords: mcp, token, rejected, expired, unauthorized, 401, server error, token missing, abgelehnt, abgelaufen
related: mcp-servers, anthropic-unreachable, claude-key
summary: “The MCP server rejected the token” — replace the token, or switch the server off.
---
**The MCP server “kb” rejected the token — it may be wrong or expired.** Claude can't use that server until it gets a valid token.

1. In the service (e.g. your knowledge base), create a new token — read-only where possible — or check that the old one is still valid.
2. In One: **Settings → Claude AI → MCP servers**, open the server's **Details**.
3. **Token** → **Replace**, paste the new token and confirm. One tests the connection right away; the LED should turn to **Connected**.

A server with its own sign-in (OAuth): press **Sign in** in its row instead. In the [AI terminal](help:agent), a task that failed this way shows **Sign in to kb** — or press <kbd>Enter</kbd> on the empty prompt; the window opens, and once connected **Run the task again** (<kbd>Enter</kbd>) runs it with the new sign-in. `/connect kb` does the same at any time.

## Related messages
- **This browser has no copy of the token** — tokens are sealed per browser. On a new device or after clearing browser data, add the token again under **Details**.
- **Claude could not use the MCP server “…”** — check the **Server URL** (https, the server's MCP endpoint), and that the server is reachable from the internet: Anthropic connects to it, not your browser.
- **This server offers no sign-in** — it has no sign-in page One can use: paste a token instead (**Paste a token instead** in the terminal opens Settings).
- Need Claude now? Switch the server off with its switch — requests then run without it.
