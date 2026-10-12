---
id: claude-key
title: Dein Claude-Schlüssel
section: ai
order: 2
keywords: claude, api-schlüssel, anthropic, sk-ant, schlüssel, modell, opus, sonnet, haiku, byok, tresor, kosten, ki einrichten, api key, key, model
related: ai-providers, ai-menu, privacy, ai-unreachable
summary: Claude läuft mit deinem eigenen Schlüssel aus der Anthropic-Konsole — eingerichtet im Assistenten, versiegelt in diesem Browser.
---
One hat kein KI-Abo: Du bringst deinen eigenen Schlüssel mit, und Anthropic rechnet die Nutzung über dein Konto ab. Claude ist einer der [KI-Anbieter](help:ai-providers), die One nutzen kann — der, der alles kann, MCP-Server eingeschlossen.

1. Erstelle einen Schlüssel in der Anthropic-Konsole (**console.anthropic.com → Settings → API keys**). Er beginnt mit `sk-ant-`.
2. In One: **Einstellungen → KI → Claude einrichten** (oder ⌘K **KI einrichten**, oder die Karte, die jede KI-Funktion ohne Schlüssel zeigt). Füge den Schlüssel in Schritt 02 ein — die kostenlose Prüfung fragt nur die Modellliste ab, es wird kein Text gesendet — und er wird versiegelt.
3. Schritt 03 zeigt Claudes Rollen. **Standard** ist das Modell, an das dieses Gerät jede Claude-Anfrage schickt — ändere es dort (später öffnest du den Assistenten wieder über **Einstellungen → KI**). **Schnell** und **Gründlich** sind für das Routing einer späteren Version vorgemerkt; bis dahin wählt der Modell-Chip im KI-Menü ein anderes Claude-Modell für eine Anfrage.

## Wo der Schlüssel liegt
Der Schlüssel liegt versiegelt im Tresor dieses Browsers, mit einem Schlüssel, den der Browser erzeugt hat und nicht herausgibt. Er geht nur an `api.anthropic.com` — nie in Sicherungen, Exporte, Freigabelinks, Sync oder Team-Dokumente. Auf einem anderen Gerät (oder in einem anderen Browser) fügst du ihn neu ein.

## Noch kein Schlüssel?
Das KI-Menü bietet **Demo-Antwort ohne Schlüssel**: vorgefertigte Antworten, offline geschrieben, es wird nichts gesendet.

> Widerrufen oder erneuern kannst du Schlüssel in der Anthropic-Konsole. **Einstellungen → KI → Entfernen …** löscht die versiegelte Kopie aus diesem Browser.
