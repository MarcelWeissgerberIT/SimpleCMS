# SimpleCMS One — Claude Desktop extension {{version}}

Lets Claude search, read and write your One workspace — pages, databases, rows and properties — in the
One tab you have open in your browser (https://getonecms.com/app/ or your own build).

## Use it

1. Open this file (`one.mcpb`) — Claude Desktop asks to install it. Or drag it into *Settings → Extensions*.
2. Open One and switch on *Settings → Agents · MCP → Allow AI agents on this computer*.
3. Ask Claude: *"What is in my One workspace?"*

Claude Desktop runs the extension with the Node.js it ships — nothing else to install.

## Settings (Claude Desktop → Settings → Extensions → SimpleCMS One)

- **Port** (default 47321): the port the One tab connects to. Change it together with *Port* in One.
- **Extra allowed origins**: only for One served from your own domain, e.g. `https://one.example.com`.
  getonecms.com and localhost are always allowed.

## Update

Download the new `one.mcpb` from the same place and open it — Claude Desktop replaces the installed
version when the new one is higher.

## What it does

`server/one-mcp.mjs` is the One MCP bridge (MIT): Claude Desktop starts it over stdio; it listens on
`ws://127.0.0.1:<port>` for the One tab, which runs every tool against the workspace in your browser.
Loopback only, One's own origins only; changes wait for your approval in One unless you choose
otherwise there. Several workspaces can be connected at once (one tab each): every call is bound to
the workspace it is meant for and never runs in another. Nothing leaves your computer through One.

Guide and security model: https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/MCP.md
