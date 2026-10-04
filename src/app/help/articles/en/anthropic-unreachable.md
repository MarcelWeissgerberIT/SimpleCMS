---
id: anthropic-unreachable
title: Claude can't be reached
section: trouble
order: 2
keywords: anthropic, claude, unreachable, offline, network, vpn, firewall, blocker, adblock, rate limit, overloaded, invalid key, error, nicht erreichbar, Netzwerk, Blocker
related: claude-key, reload, mcp-token-rejected
summary: “Cannot reach api.anthropic.com” — usually a network filter, a VPN or a content blocker.
---
One's AI talks from your browser straight to `api.anthropic.com`. **Cannot reach api.anthropic.com. Check your connection, VPN or content blocker.** means that request never arrived.

## Check, in this order
1. **Connection** — are you online? Other sites load?
2. **Content blockers** — uBlock Origin, Privacy Badger, Brave Shields, AdGuard or a DNS filter (Pi-hole) may block requests to other domains. Allow `api.anthropic.com` for this site.
3. **VPN, company network, firewall** — some block AI services. Try another network (e.g. your phone's hotspot).
4. **Anthropic status** — rarely, the API itself is down: status.anthropic.com.

## Other messages
- **Anthropic rejected this API key** — the key is wrong, revoked or out of credit: check it in the Anthropic console, then **Settings → Claude AI**.
- **Rate limit reached** / **Claude is very busy right now** — wait a moment and try again.
- **This API key is not allowed to use …** — pick another **Model** in Settings → Claude AI.
- **One was updated while this tab was open** — reload the tab.
- An MCP server error — see [MCP token rejected](help:mcp-token-rejected).
