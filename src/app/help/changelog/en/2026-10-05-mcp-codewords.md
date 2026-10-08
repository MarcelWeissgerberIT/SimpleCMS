---
id: 2026-10-05-mcp-codewords
date: 2026-10-05
order: 16
title: Codewords for MCP servers
summary: Start a request with “kb:” and Claude asks that server first — in the AI menu, in ⌘K and in the terminal.
image: assets/shots/changelog/mcp-codewords.webp
alt: The AI menu with “kb: …” typed and the chip “→ KB” showing which server answers first
help: mcp-servers, ai-menu, agent
try: settings-ai
---
Each MCP server you added can have a **codeword** — a short word like `kb` or `wiki`. Start a request with it, *“kb: what do we know about the launch?”*, and Claude answers with that server's tools first. The `kb:` itself is not sent.

1. **Settings → Claude AI → MCP servers**, open a server's **Details**.
2. Under **Codeword**, take the suggestion with **Use** or type your own: a–z, 0–9, `-` and `_`.
3. Type the codeword with its colon in the AI menu, in `⌘K ?` or in the AI terminal — a chip shows the server: **→ KB**.

Several codewords work at once (`kb: wiki: …`). A server you switched off stays off; the chip and the answer say so.

> Tip: `one` is reserved — it is One's own codeword in Claude Desktop.
