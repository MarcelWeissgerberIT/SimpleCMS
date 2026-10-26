---
id: mcp-servers
title: MCP servers (knowledge bases & co)
section: ai
order: 6
keywords: mcp, mcp server, mcp connections, connections, what is connected, overview page, overview, table, where used, tools, connector, knowledge base, token, external tools, integration, codeword, kb:, oauth, sign in, sign-in code, device code, image, video, generate, media, save to one, MCP-Server, Werkzeuge, Wissensdatenbank, Codewort, Anmelden, Bild generieren, Verbindungen, Übersichtsseite
related: agent, ai-menu, mcp-token-rejected, mcp-bridge, claude-key
summary: Let One's Claude use the tools of other systems — a knowledge base, a tracker, a CRM.
---
**Settings → AI → MCP servers.** You need [your Claude key](help:claude-key) first.

## Add a server (a knowledge base as example)
1. In your knowledge base, copy its MCP server address (`https://…/mcp`) and create a token for One — read-only, limited to the projects you need, if it lets you choose.
2. In One: **Add server**, paste the **Server URL** and the **Token**, **Save**.
3. One names the server after its address, switches it on and checks it in the background: it tests the connection, lists the tools Claude sees and writes a **Usage prompt** that tells Claude which tool is for what. The LED turns to **Connected**.

## Overview: where each server may be used
The section opens with a table, one row per server: its **codeword**, **One's Claude** (which requests take it, or *Off*), the **custom agents** that attach it (with the number of tools a tool list allows; a switched-off agent struck through), the **integrations** it makes active, and **Claude Code (worker)** — the repos (and *tasks without a repo*) where Claude Code in the coding worker has a server of the same name or codeword. Claude Code's servers are its own (your `claude mcp` setup, ticked per repo on the worker's setup page): a name only Claude Code has gets a row of its own. Click a server's name to open its details.

## All connections at a glance
⌘K **MCP · Connections** (`#/mcp`) shows every MCP connection One knows of on one page — **All connections →** here and in **Settings → Agents · MCP** opens it too:
- **§ 01 One's Claude** — these servers, each with a lamp and a word: **OK** (when it was tested, how many tools), **Not tested**, **Test failed** (amber), **Token refused** or **Sign-in ran out** (red), **Off**. The lamps follow the [Preflight](help:preflight) Token lamp: the same servers are red or amber there. Each row offers **Test** (one short Claude request — only when you press it), **Sign in** on a red row, and **Settings ↗** to its card here.
- **§ 02 Claude Desktop · Code** — this tab's bridge ([Claude Desktop & local MCP](help:mcp-bridge)): connected or not, which client, what agents may change.
- **§ 03 Coding worker** — this browser's link to the worker and the MCP servers Claude Code has there, per repo.
- **§ 04 Team server** — in a team workspace: the workspace's `/mcp` address and the server agents' MCP servers.

Opening the page sends nothing and opens no token: it shows what One last saw — the last test, refusals in this tab, when a sign-in runs out. Each section says where its setting lives (this device, this tab, this browser, the team server). **This browser has no copy of the token** shows only here in Settings, on the server's card — the page never opens the sealed tokens. Requests then leave the server out without a word; only a request that names it by its codeword says so.

## Where it is used
**Details** → **Used in**:
- **Agent, own requests and ⌘K ask** (default) — the agent, your own requests in the AI menu, and `?` in ⌘K.
- **All AI calls** — also the one-click actions, database autofill and meeting summaries. Each of those requests gets longer and slower.

A server you switch off is not used by One on this device — custom agents that attach it leave it out of their runs too, and their editor says so.

**Details** also holds the name, the codeword (below), the token, the usage prompt (**Generate** / **Regenerate**, or write your own), **Test connection** and **Remove server**. While Claude works, MCP calls show as small chips, e.g. `KB · search`.

A server that rejects its token (expired, or not signed in yet) no longer stops your requests: Claude answers without it and a note says *“… rejected its token — Claude answers without it”*. It stays left out in this tab until you sign in again, replace the token or a test passes — or address it by its codeword, which shows the error instead.

## Codeword
**Details** → **Codeword**: a short word like `kb` — One suggests the server's name, **Use** takes it. Start a request with it — *“kb: what do we know about the launch?”* — in the AI menu, in <kbd>Mod+K</kbd> `?` or in the agent, and Claude answers with this server's tools first (the `kb:` itself is not sent). Several work at once: `kb: wiki: …`. In the AI terminal, `kb:` lists the server's tools (from **Test connection**): pick one with <kbd>Tab</kbd> and Claude is told to use it.
- While you type, a chip shows the server: `→ KB`. A switched-off server stays off — the answer says so.
- a–z, 0–9, `-` and `_`, up to 24 characters, one per server. `one` is reserved: it is One's own codeword in Claude Desktop ([Claude Desktop & local MCP](help:mcp-bridge)).

## Sign in instead of a token
Some servers have their own sign-in page (OAuth) instead of a token to paste. When a server turns the connection test down, its row says so and offers **Sign in**; you also find it under **Details** → **Sign-in**.
1. **Sign in** opens a small window at the server's sign-in page (One registers itself there when the server allows it).
2. Sign in and allow access — the window closes, the row shows **Signed in** and the connection is tested again.
3. **Sign out** removes the tokens from this browser.

One refreshes the access token shortly before it expires. If the browser blocks the window, the tab goes to the sign-in page and comes back. A server may name several sign-in services: One uses the first one a browser can talk to and registers itself there.

### Sign in with a code
Some sign-ins don't send the window back to One — they show an error there, or refuse One's page as the way back. Then sign in with a code: while the window waits, **Use a code instead** (or **Sign in with a code**, once One knows the server offers it). Settings shows a short code like `WDJB-MJHT`; the window goes to the server's page for it — enter the code there and allow access. One waits and finishes by itself; **Cancel** ends it.

A sign-in that a browser can't finish at all (the server's sign-in refuses browsers, CORS) says so — then paste a token as before.

### Connect from the AI terminal
In the [AI terminal](help:agent), `/connect` lists the servers and how they stand (signed in, token, sign-in needed, off). `/connect kb` — a name, a codeword or an address — signs in: the window opens right from your <kbd>Enter</kbd>, and the terminal shows the waiting, the code (with **Use a code instead**), the connection test and **Connected · 3 tools**. A server whose token works is only tested; no window opens. `/connect https://…` adds a server by its address first. When the browser blocks the window, the terminal says so and stays where it is — allow pop-ups for One, or press **Sign in again**. A server you add during a conversation joins after `/new`; a server you sign in to again is used with its new sign-in right away.

## Save media to One
Image and video services (and others) return pictures, clips or audio. One shows each as a **card** — file type, host, size when known — under the answer in the AI menu, in <kbd>Mod+K</kbd> `?`, in the [AI terminal](help:agent) and in [custom agents'](help:custom-agents) runs. Nothing is loaded until you click.
- **Save to One** (or **Save all**) fetches the file in this browser, checks that it really is an image, video or audio file (type and content), stores it in this browser and puts the block where you asked: below the selection in the AI menu, at the end of the current page in <kbd>Mod+K</kbd> `?`. In the terminal, saving stages **Insert media** for your review — on the page the task worked on, or on a new page "Generated media".
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

## Personal tokens for Claude Code

[My secrets](help:personal-secrets) stores Atlas and agent tokens per person with a separate passphrase. In a coding task, explicitly grant the connections needed to the current worker. This grant is separate from regular MCP connections for browser agents; existing connections are not automatically migrated.


## Model and permission beside the connection test
Open a server’s **Details**. Choose an available MCP-capable model in the connection-check and guide section; ONE remembers this choice for this purpose on your device. Copilot and local models have a separate personal MCP permission beside it. Choosing a model grants no data access. Workspace restrictions still apply. Your own worker and personal Atlas access remain necessary with shared Atlas Flow; the model host receives no access tokens.
