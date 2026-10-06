---
id: mcp-servers
title: MCP servers (knowledge bases & co)
section: ai
order: 6
keywords: mcp, mcp server, tools, connector, knowledge base, token, external tools, integration, codeword, kb:, oauth, sign in, image, video, generate, media, save to one, MCP-Server, Werkzeuge, Wissensdatenbank, Codewort, Anmelden, Bild generieren
related: agent, ai-menu, mcp-token-rejected, mcp-bridge, claude-key
summary: Let One's Claude use the tools of other systems — a knowledge base, a tracker, a CRM.
---
**Settings → Claude AI → MCP servers.** You need [your Claude key](help:claude-key) first.

## Add a server (a knowledge base as example)
1. In your knowledge base, copy its MCP server address (`https://…/mcp`) and create a token for One — read-only, limited to the projects you need, if it lets you choose.
2. In One: **Add server**, paste the **Server URL** and the **Token**, **Save**.
3. One names the server after its address, switches it on and checks it in the background: it tests the connection, lists the tools Claude sees and writes a **Usage prompt** that tells Claude which tool is for what. The LED turns to **Connected**.

## Where it is used
**Details** → **Used in**:
- **Agent, own requests and ⌘K ask** (default) — the agent, your own requests in the AI menu, and `?` in ⌘K.
- **All AI calls** — also the one-click actions, database autofill and meeting summaries. Each of those requests gets longer and slower.

**Details** also holds the name, the codeword (below), the token, the usage prompt (**Generate** / **Regenerate**, or write your own), **Test connection** and **Remove server**. While Claude works, MCP calls show as small chips, e.g. `KB · search`.

## Codeword
**Details** → **Codeword**: a short word like `kb` — One suggests the server's name, **Use** takes it. Start a request with it — *“kb: what do we know about the launch?”* — in the AI menu, in `⌘K ?` or in the agent, and Claude answers with this server's tools first (the `kb:` itself is not sent). Several work at once: `kb: wiki: …`.
- While you type, a chip shows the server: `→ ATLAS`. A switched-off server stays off — the answer says so.
- a–z, 0–9, `-` and `_`, up to 24 characters, one per server. `one` is reserved: it is One's own codeword in Claude Desktop ([Claude Desktop & local MCP](help:mcp-bridge)).

## Sign in instead of a token
Some servers have their own sign-in page (OAuth) instead of a token to paste. When a server turns the connection test down, its row says so and offers **Sign in**; you also find it under **Details** → **Sign-in**.
1. **Sign in** opens a small window at the server's sign-in page (One registers itself there when the server allows it).
2. Sign in and allow access — the window closes, the row shows **Signed in** and the connection is tested again.
3. **Sign out** removes the tokens from this browser.

One refreshes the access token shortly before it expires. If the browser blocks the window, the tab goes to the sign-in page and comes back. A sign-in that a browser can't finish (the server's sign-in refuses it, CORS) says so — then paste a token as before.

## Save media to One
Image and video services (and others) return pictures, clips or audio. One shows each as a **card** — file type, host, size when known — under the answer in the AI menu, in `⌘K ?`, in the [AI terminal](help:agent) and in [custom agents'](help:custom-agents) runs. Nothing is loaded until you click.
- **Save to One** (or **Save all**) fetches the file in this browser, checks that it really is an image, video or audio file (type and content), stores it in this browser and puts the block where you asked: below the selection in the AI menu, at the end of the current page in `⌘K ?`. In the terminal, saving stages **Insert media** for your review — on the page the task worked on, or on a new page "Generated media".
- A host that does not let browsers load its files: the card offers **Open** (a new tab) and **Upload a copy**. In a team workspace, **Fetch through the team server** downloads it there (https only, never private addresses).
- SVG files are kept for download only — they can contain script.

## Generate images and videos
Type `/generate image` (or `/generate video`) on a line, or click **Generate…** in an empty image block.
1. Pick the **Service** — servers whose tools make images (or videos). One remembers your choice on this device.
2. Write the **Prompt**, choose the aspect ratio and how many results, and tick **Use this page as context** only if the page should go along. Nothing from your One memory is sent.
3. **Generate**. Claude calls only that server and waits for the job. Closing the panel does not stop it — the page shows when the results are ready.
4. **Preview** shows a result first (it is loaded only then, and not kept). Pick one or more results and **Insert selected** — they are saved to One, go into the page and the panel closes.

> Generating may use credits on that service.

## How it works — and the token
Requests go to `api.anthropic.com`; Anthropic connects to the server while Claude answers. So only remote servers reachable over HTTPS work (Streamable HTTP or SSE) — no local ones.

> The token is sent to Anthropic with every request that uses the server, and stored sealed in this browser — never in backups, exports or sync (a sign-in's tokens too). Use a dedicated token for One, read-only where possible. On another device, add the token again or sign in there.
