---
id: custom-agents
title: Eigene Agenten
section: ai
order: 4
keywords: eigene agenten, agenten, zeitplan, wiederkehrend, automatisieren, auslöser, rezept, bericht, server-agent, webhook, budget, custom agents
related: agent, automations, mcp-servers, gmail-sync
summary: Gespeicherte KI-Helfer für wiederkehrende Arbeit — jeder mit Auftrag, Auslöser und Grenzen. Sie laufen selbstständig und berichten.
---
**Agenten** in der Seitenleiste listet deine eigenen Agenten. **Neuer Agent** startet mit einem Rezept — *Tägliche Mail-Sortierung*, *Wochenbericht aus Projekten*, *Neue Formularantworten zusammenfassen*, *Seiten mit der Wissensdatenbank abgleichen* — oder **Leer**. Nichts läuft, bevor du speicherst.

## Was ein Agent hat
- **Auftrag** — einen **Namen** und **Anweisungen** in klaren Worten (**Mit Claude verbessern** schleift sie). Das Feld nummeriert die Zeilen und unterstreicht die Werkzeuge, die der Agent nutzen kann (die von One und die seiner MCP-Server); Platzhalter in Großbuchstaben wie `[WIE DIE EINTRÄGE AUFGELISTET WERDEN]` sind markiert und gezählt — **Nächster Platzhalter** springt hin, und **Jetzt ausführen** fragt nach, solange einer offen ist.
- **Auslöser** — **Manuell**, **Zeitplan** (stündlich, täglich, werktags, wöchentlich, monatlich, zu Uhrzeit und Zeitzone), **Neue Zeile** in einer Datenbank (auch Formularantworten und synchronisierte Mails), **Zeile geändert** oder **Webhook** (nur Server-Agenten).
- **Zugriff** — **Darf nutzen**: alles oder ausgewählte Seiten und Datenbanken. **Änderungen**: **Nur lesen**, **Vorschläge zur Prüfung** oder **Direkt anwenden** (als „Agent · Name“, rückgängig über den Versionsverlauf). **MCP-Server**, die er aufrufen darf, z. B. deine Wissensdatenbank.
- **Bericht** — eine optionale **Berichtsseite**, auf die jeder Lauf schreibt (unten anfügen oder ersetzen).
- **Antrieb** — **Läuft wo**, **Modell**, **Aufwand** und ein **Budget pro Lauf**: Der Lauf stoppt, wenn seine geschätzten Kosten darüber gehen.

## Läufe
**Jetzt ausführen** startet sofort einen Lauf. Jeder Lauf steht unter **Läufe** mit Bericht, Schritten und Kosten; Vorschläge warten dort auf **Prüfen**, und die Seitenleiste zeigt, wie viele warten.

## Browser oder Server
- **Browser**-Agenten laufen in One, solange ein Tab offen ist — mit deinem Claude-Schlüssel und deinen MCP-Servern. Ein geplanter Lauf, der verpasst wurde, weil One geschlossen war, findet einmal beim nächsten Öffnen statt.
- **Server**-Agenten (Team-Workspaces) laufen rund um die Uhr auf dem Team-Server, mit einem Claude-Schlüssel und MCP-Servern, die ein Admin unter **Einstellungen → Agenten · MCP** einrichtet.
