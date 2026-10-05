---
id: 2026-10-05-mcp-codewords
date: 2026-10-05
order: 15
title: Codewords for MCP servers
summary: Start a request with “atlas:” and Claude asks that server first — in the AI menu, in ⌘K and in the terminal.
image: assets/shots/changelog/mcp-codewords.webp
alt: The AI menu with “atlas: …” typed and the chip “→ ATLAS” showing which server answers first
help: mcp-servers, ai-menu, agent
try: settings-ai
---
Each MCP server you added can have a **codeword** — a short word like `atlas` or `kb`. Start a request with it, *“atlas: what do we know about the launch?”*, and Claude answers with that server's tools first. The `atlas:` itself is not sent.

1. **Settings → Claude AI → MCP servers**, open a server's **Details**.
2. Under **Codeword**, take the suggestion with **Use** or type your own: a–z, 0–9, `-` and `_`.
3. Type the codeword with its colon in the AI menu, in `⌘K ?` or in the AI terminal — a chip shows the server: **→ ATLAS**.

Several codewords work at once (`atlas: wiki: …`). A server you switched off stays off; the chip and the answer say so.

> Tip: `one` is reserved — it is One's own codeword in Claude Desktop.
