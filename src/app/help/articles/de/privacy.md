---
id: privacy
title: Wohin deine Daten gehen
section: privacy
order: 1
keywords: datenschutz, daten, sicherheit, dsgvo, gdpr, lokal, browser, anthropic, openrouter, jev, typesafe, betreiber, google, tresor, verschlüsselung, tracking, privacy, security
related: ai-data-rules, ai-providers, claude-key, gmail-sync, self-hosting, export
summary: Was in deinem Browser bleibt, was zu deinem KI-Anbieter oder Google geht — und wann.
---
## Bleibt in deinem Browser
Seiten, Datenbanken, Dateien, Verläufe, Kommentare und Einstellungen des lokalen Workspace liegen in der IndexedDB dieses Browsers. One hat kein Konto, keine Analyse und kein Tracking. getonecms.com liefert nur die Dateien der App aus. Welche Seiten du wie oft geöffnet hast (Zuletzt, Häufig), bleibt pro Gerät und Workspace — nie synchronisiert, exportiert oder verschickt. Auch das Band des [Flugschreibers](help:flight-recorder) (IndexedDB `one-recorder`) bleibt auf diesem Gerät: IDs, Zeiten und Zahlen jedes Schreibvorgangs, nie Seitentext oder Werte — nie synchronisiert, gesichert oder verschickt; **Workspace zurücksetzen** löscht es.

## Verlässt ihn nur, wenn du es nutzt
- **KI** (KI-Menü, Terminal, ⌘K-Fragen, Autofill, Besprechungsnotizen, Frag die Hilfe …): Der Text, den eine Anfrage braucht — die Auswahl oder Seite, die Auszüge, die die KI liest, ein Transkript —, geht mit deinem Schlüssel an den Anbieter ihrer Route, und nur die Arten von Daten, die deine [Datenregeln](help:ai-data-rules) dort erlauben.
  - **Claude**: Anfragen gehen aus diesem Browser direkt an Anthropic (api.anthropic.com), mit deinem Schlüssel. Anthropic trainiert nicht mit API-Daten. Mit MCP-Servern verbindet sich Anthropic, während Claude antwortet — ihre Tokens gehen an Anthropic.
  - **OpenRouter**: Anfragen gehen aus diesem Browser an OpenRouter (openrouter.ai), das sie an den Betreiber des gewählten Modells weitergibt. One legt die Betreiber fest, die du erlaubst, schaltet Ausweichmodelle und Konto-Plugins von OpenRouter ab und verlangt, solange du es nicht abschaltest, Betreiber ohne Datensammlung. OpenRouter speichert Metadaten der Anfragen; deine Kontoeinstellungen bei OpenRouter gelten zusätzlich. Keine MCP-Server.
  - **Jev Router**: Mit dem Jev Router gibt OpenRouter deine Anfrage an Jev (TypeSafe), das eines der Modelle deiner Liste wählt; dessen Betreiber antwortet. Beide erhalten die Anfrage.
  - **Jev als Vorprüfer** (nur wenn du ihn wählst): Als Vorprüfer erhält Jev (TypeSafe) über OpenRouter die Vorschläge deiner Agenten mit ihrer Anweisung und der Zeile, die sie ändern — und, wenn du es einschaltest, Antworten mit ihren Quellen. Siehe [Jev als Vorprüfer](help:ai-jev).
- **MCP-Server** (nur Claude): Anthropic verbindet sich mit ihnen, mit dem Token, das du angegeben hast, während Claude antwortet.
- **Gmail-Sync**: Dein Browser spricht direkt mit Google. Mail-Inhalte gehen nur an deinen KI-Anbieter, solange **Mit KI ordnen** an ist — und nur an einen Anbieter, für den du deine Mails eingeschaltet hast.
- **Besprechungsnotizen**: Die Spracherkennung macht dein Browser — Chrome schickt das Audio an Google, Edge an Microsoft, Safari ggf. an Apple.
- **Webhooks und Automationen** gehen an die URLs, die du eingetragen hast; **GitHub-Sync** an `api.github.com`.
- **Freigabe-Links** tragen die Seite im Link — nichts wird auf einem Server gespeichert.
- **Team-Workspaces** liegen auf dem Server deines Teams, auf der Platte verschlüsselt.

## Deine Schlüssel — der Tresor
Deine KI-Schlüssel (einer je Anbieter), MCP-Tokens und das GitHub-Token sind mit einem Schlüssel versiegelt, den dieser Browser erzeugt hat und nicht exportieren kann. Die Einstellungen enthalten nur eine Markierung („•••• 1a2B“). Schlüssel stehen nie in Backups, Exporten, Freigabe-Links, Sync oder Team-Dokumenten. Ohne https (oder localhost) gilt ein Schlüssel nur für die Sitzung.

> **Workspace zurücksetzen** (Workspace-Einstellungen → Gefahrenzone) löscht alles auf diesem Gerät — den Tresor eingeschlossen.
