---
id: anthropic-unreachable
title: Claude nicht erreichbar
section: trouble
order: 2
keywords: anthropic, claude, nicht erreichbar, offline, netzwerk, vpn, firewall, blocker, adblock, rate limit, ausgelastet, schlüssel abgelehnt, fehler, unreachable
related: claude-key, reload, mcp-token-rejected
summary: „api.anthropic.com ist nicht erreichbar“ — meist ein Netzwerkfilter, ein VPN oder ein Content-Blocker.
---
Ones KI spricht aus deinem Browser direkt mit `api.anthropic.com`. **api.anthropic.com ist nicht erreichbar. Prüfe Verbindung, VPN oder Content-Blocker.** heißt: Diese Anfrage kam nie an.

## Prüfe, in dieser Reihenfolge
1. **Verbindung** — bist du online? Laden andere Seiten?
2. **Content-Blocker** — uBlock Origin, Privacy Badger, Brave Shields, AdGuard oder ein DNS-Filter (Pi-hole) blockieren womöglich Anfragen an andere Domains. Erlaube `api.anthropic.com` für diese Seite.
3. **VPN, Firmennetz, Firewall** — manche sperren KI-Dienste. Probier ein anderes Netz (z. B. den Hotspot deines Handys).
4. **Anthropic-Status** — selten ist die API selbst gestört: status.anthropic.com.

## Andere Meldungen
- **Anthropic hat diesen API-Schlüssel abgelehnt** — der Schlüssel ist falsch, widerrufen oder ohne Guthaben: prüf ihn in der Anthropic-Konsole, dann **Einstellungen → Claude KI**.
- **Rate-Limit erreicht** / **Claude ist gerade stark ausgelastet** — kurz warten und erneut versuchen.
- **Dieser API-Schlüssel darf … nicht verwenden** — wähle ein anderes **Modell** unter Einstellungen → Claude KI.
- **One wurde aktualisiert, während dieser Tab offen war** — Tab neu laden.
- Ein Fehler eines MCP-Servers — siehe [MCP-Token abgelehnt](help:mcp-token-rejected).
