---
id: privacy
title: Wohin deine Daten gehen
section: privacy
order: 1
keywords: datenschutz, daten, sicherheit, dsgvo, gdpr, lokal, browser, anthropic, google, tresor, verschlüsselung, tracking, privacy, security
related: claude-key, gmail-sync, self-hosting, export
summary: Was in deinem Browser bleibt, was zu Anthropic oder Google geht — und wann.
---
## Bleibt in deinem Browser
Seiten, Datenbanken, Dateien, Verläufe, Kommentare und Einstellungen des lokalen Workspace liegen in der IndexedDB dieses Browsers. One hat kein Konto, keine Analyse und kein Tracking. getonecms.com liefert nur die Dateien der App aus.

## Verlässt ihn nur, wenn du es nutzt
- **Claude** (KI-Menü, Agent, ⌘K-Fragen, Autofill, Besprechungsnotizen, Frag die Hilfe): Der Text, den die Anfrage braucht, geht mit deinem Schlüssel an Anthropic (`api.anthropic.com`) — die Auswahl oder Seite, die Auszüge, die Claude liest, ein Transkript.
- **MCP-Server**: Anthropic verbindet sich mit ihnen, mit dem Token, das du angegeben hast, während Claude antwortet.
- **Gmail-Sync**: Dein Browser spricht direkt mit Google. Mail-Inhalte gehen nur an Anthropic, solange **Mit Claude ordnen** an ist.
- **Besprechungsnotizen**: Die Spracherkennung macht dein Browser — Chrome schickt das Audio an Google, Edge an Microsoft, Safari ggf. an Apple.
- **Webhooks und Automationen** gehen an die URLs, die du eingetragen hast; **GitHub-Sync** an `api.github.com`.
- **Freigabe-Links** tragen die Seite im Link — nichts wird auf einem Server gespeichert.
- **Team-Workspaces** liegen auf dem Server deines Teams, auf der Platte verschlüsselt.

## Deine Schlüssel — der Tresor
Claude-Schlüssel, MCP-Tokens und das GitHub-Token sind mit einem Schlüssel versiegelt, den dieser Browser erzeugt hat und nicht exportieren kann. Die Einstellungen enthalten nur eine Markierung („•••• 1a2B“). Schlüssel stehen nie in Backups, Exporten, Freigabe-Links, Sync oder Team-Dokumenten. Ohne https (oder localhost) gilt ein Schlüssel nur für die Sitzung.

> **Workspace zurücksetzen** (Workspace-Einstellungen → Gefahrenzone) löscht alles auf diesem Gerät — den Tresor eingeschlossen.
