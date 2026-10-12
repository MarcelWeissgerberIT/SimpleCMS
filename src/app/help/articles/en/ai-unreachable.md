---
id: ai-unreachable
title: The AI can't be reached or says no
section: trouble
order: 2
keywords: ai, unreachable, offline, network, vpn, firewall, blocker, rate limit, overloaded, invalid key, rejected, 401, 402, no credit, credits, no operator, no endpoint, data rule, reload, openrouter, claude, anthropic, nicht erreichbar, abgelehnt, Guthaben, Betreiber
related: ai-providers, ai-data-rules, anthropic-unreachable, claude-key
summary: “Cannot reach …”, a rejected key, no credit, no operator — what each message means and the key that fixes it.
---
Each AI request goes from your browser straight to the provider of its route: `api.anthropic.com` for Claude, `openrouter.ai` for OpenRouter. The message names the one that failed.

## Cannot reach …
The request never arrived. Check, in this order: your **connection**; **content blockers** and DNS filters (allow the provider's address for this site); **VPN, company network or firewall** (try another network); the provider's status page.

## The key was rejected (401)
The key is wrong, revoked or belongs to another account. **Check key** opens step 02 of the assistant; paste a new key with <kbd>N</kbd> (*Paste again*). Your old key stays until a new one passes the free check.

## No credit (402) — OpenRouter
The key is valid, but the account has no credit left. One keeps the key; top up at OpenRouter (**Credits**), then try again.

## Busy, rate limit
Wait a moment and try again; One retries a few times by itself and says so.

## No operator / no model can do this
Your data rules or the operators you allowed leave no operator for that model, or no model in your list can do what the request needs (pictures, PDFs, tools). **Choose models** opens step 03; **Change rule** opens step 04 at that kind of data.

## A data rule keeps this from …
The request would carry a kind of data the rules keep from that provider — nothing was sent. **Change rule** opens the switch; in a team only owners and admins change shared columns.

## AI rules from a newer version
This tab is older than the rules saved in the workspace: **Reload**.

> For MCP servers see [MCP token rejected](help:mcp-token-rejected).
