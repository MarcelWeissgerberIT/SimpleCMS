---
id: ai-unreachable
title: Die KI ist nicht erreichbar oder sagt nein
section: trouble
order: 2
keywords: ki, nicht erreichbar, offline, netzwerk, vpn, firewall, blocker, ratenlimit, überlastet, schlüssel abgelehnt, 401, 402, kein guthaben, guthaben, kein betreiber, datenregel, neu laden, openrouter, claude, anthropic, unreachable, rejected, credits
related: ai-providers, ai-data-rules, anthropic-unreachable, claude-key
summary: „… nicht erreichbar“, ein abgelehnter Schlüssel, kein Guthaben, kein Betreiber — was jede Meldung heißt und welche Taste hilft.
---
Jede KI-Anfrage geht aus deinem Browser direkt an den Anbieter ihrer Route: `api.anthropic.com` für Claude, `openrouter.ai` für OpenRouter. Die Meldung nennt den, der nicht ging.

## … nicht erreichbar
Die Anfrage kam nie an. Prüfe in dieser Reihenfolge: deine **Verbindung**; **Inhaltsblocker** und DNS-Filter (erlaube die Adresse des Anbieters für diese Seite); **VPN, Firmennetz oder Firewall** (anderes Netz probieren); die Statusseite des Anbieters.

## Der Schlüssel wurde abgelehnt (401)
Der Schlüssel ist falsch, widerrufen oder gehört zu einem anderen Konto. **Schlüssel prüfen** öffnet Schritt 02 des Assistenten; mit <kbd>N</kbd> (*Neu einfügen*) fügst du einen neuen ein. Dein alter Schlüssel bleibt, bis ein neuer die kostenlose Prüfung besteht.

## Kein Guthaben (402) — OpenRouter
Der Schlüssel ist gültig, aber das Konto hat kein Guthaben mehr. One behält den Schlüssel; lade bei OpenRouter auf (**Credits**) und versuch es noch einmal.

## Überlastet, Ratenlimit
Kurz warten und noch einmal; One versucht es selbst ein paar Mal und sagt es dir.

## Kein Betreiber / kein Modell kann das
Deine Datenregeln oder die erlaubten Betreiber lassen für dieses Modell keinen Betreiber übrig, oder kein Modell deiner Liste kann, was die Anfrage braucht (Bilder, PDFs, Werkzeuge). **Modelle wählen** öffnet Schritt 03; **Regel ändern** öffnet Schritt 04 bei dieser Art von Daten.

## Eine Datenregel hält das von … fern
Die Anfrage nähme eine Art von Daten mit, die die Regeln von diesem Anbieter fernhalten — es wurde nichts gesendet. **Regel ändern** öffnet den Schalter; im Team ändern nur Inhaber und Admins geteilte Spalten.

## KI-Regeln aus einer neueren Version
Dieser Tab ist älter als die im Arbeitsbereich gespeicherten Regeln: **Neu laden**.

> Für MCP-Server siehe [MCP-Token abgelehnt](help:mcp-token-rejected).
