---
id: custom-agents
title: Eigene Agenten
section: ai
order: 4
keywords: eigene agenten, agenten, zeitplan, wiederkehrend, automatisieren, auslöser, rezept, bericht, server-agent, webhook, budget, mcp-werkzeuge, nur lesende werkzeuge, zustand, posteingang, notiz, spiegeln, abgleichen, schlüssel, nur von hand, custom agents, mirror
related: agent, automations, mcp-servers, properties, mentions-dates, gmail-sync
summary: Gespeicherte KI-Helfer für wiederkehrende Arbeit — jeder mit Auftrag, Auslöser und Grenzen. Sie laufen selbstständig und berichten.
---
**Agenten** in der Seitenleiste listet deine eigenen Agenten. **Neuer Agent** startet mit einem Rezept — *Tägliche Mail-Sortierung*, *Wochenbericht aus Projekten*, *Neue Formularantworten zusammenfassen*, *Liste in eine Datenbank spiegeln*, *Seiten mit der Wissensdatenbank abgleichen* — oder **Leer**. Nichts läuft, bevor du speicherst.

## Was ein Agent hat
- **Auftrag** — einen **Namen** und **Anweisungen** in klaren Worten (**Mit Claude verbessern** schleift sie).
- **Auslöser** — **Manuell**, **Zeitplan** (stündlich, täglich, werktags, wöchentlich, monatlich, zu Uhrzeit und Zeitzone), **Neue Zeile** in einer Datenbank (auch Formularantworten und synchronisierte Mails), **Zeile geändert** oder **Webhook** (nur Server-Agenten).
- **Zugriff** — **Darf nutzen**: alles oder ausgewählte Seiten und Datenbanken. **Änderungen**: **Nur lesen**, **Vorschläge zur Prüfung** oder **Direkt anwenden** (als „Agent · Name“, rückgängig über den Versionsverlauf). **MCP-Server**, die er aufrufen darf, z. B. deine Wissensdatenbank.
- **Bericht** — eine optionale **Berichtsseite**, auf die jeder Lauf schreibt (unten anfügen oder ersetzen).
- **Antrieb** — **Läuft wo**, **Modell**, **Aufwand** und ein **Budget pro Lauf**: Der Lauf stoppt, wenn seine geschätzten Kosten darüber gehen.

## Werkzeuge, Zustand und Notizen
- **MCP-Werkzeuge** — unter jedem angekreuzten MCP-Server stehen die Werkzeuge aus seinem letzten Verbindungstest: Nimm weg, was der Agent nicht nutzen soll. **Nur lesende Werkzeuge** behält nur die, die nach Lesen aussehen (get, list, search, query, read, fetch, find …); **Alle** erlaubt jedes Werkzeug, auch solche, die der Server später hinzufügt. Ein nie getesteter Server sagt **Teste zuerst die Verbindung** (**Einstellungen → Claude KI → MCP-Server**).
- **Letzter Lauf** — jeder Lauf weiß, wann der letzte erfolgreiche Lauf des Agenten war; ein wiederkehrender Auftrag kann also schauen, was sich seitdem geändert hat.
- **Gespeicherter Zustand** — ein Agent kann sich zwischen den Läufen eine kleine eigene Notiz merken (wo er aufgehört hat, was er schon gesehen hat). Gespeichert wird sie nur, wenn ein Lauf ohne Fehler endet. Browser-Agenten behalten sie auf diesem Gerät — die Agentenseite zeigt sie, **Leeren** lässt den nächsten Lauf von vorn beginnen; Server-Agenten verschlüsselt auf dem Team-Server.
- **Notizen für dich** — ein Browser-Agent kann dir eine kurze Notiz in den **Posteingang** legen („Neuer Kommentar zu #8215“, „3 Einträge sind bereit“), verknüpft mit der Seite, um die es geht. Notizen kommen erst an, wenn der Lauf fertig ist, höchstens zehn pro Lauf; Browser-Benachrichtigungen nur, wenn du sie im Posteingang eingeschaltet hast. Server-Agenten schreiben ihre Neuigkeiten in den Bericht.
- Ein geplanter Agent, der Änderungen **direkt anwendet**, meldet sich kurz („Agent · Name: 3 Änderungen“) mit **Öffnen**.

## Läufe
**Jetzt ausführen** startet sofort einen Lauf. Jeder Lauf steht unter **Läufe** mit Bericht, Schritten und Kosten; Vorschläge warten dort auf **Prüfen**, und die Seitenleiste zeigt, wie viele warten.

## Browser oder Server
- **Browser**-Agenten laufen in One, solange ein Tab offen ist — mit deinem Claude-Schlüssel und deinen MCP-Servern. Ein geplanter Lauf, der verpasst wurde, weil One geschlossen war, findet einmal beim nächsten Öffnen statt.
- **Server**-Agenten (Team-Workspaces) laufen rund um die Uhr auf dem Team-Server, mit einem Claude-Schlüssel und MCP-Servern, die ein Admin unter **Einstellungen → Agenten · MCP** einrichtet.

## Eine Datenbank abgleichen
Ein Agent kann Einträge aus einem anderen System (über einen MCP-Server) in eine Datenbank spiegeln. Drei Dinge machen das sicher:
- **Schlüssel** — eine Eigenschaft, die eine Zeile kennzeichnet, etwa eine Ticketnummer (im Eigenschaftsmenü, siehe [Schlüssel und Nur von Hand](help:properties)). Ihre Werte sind eindeutig: Einen Wert, den schon eine andere Zeile hat, lehnt One ab — beim Agenten wie bei dir.
- **Abgleich** — der Agent findet jeden Eintrag über den Schlüssel und legt eine neue Zeile an oder ändert nur die Werte, die abweichen: bis zu 50 Zeilen in einem Schritt, jede als eigener Vorschlag (*angelegt*, *geändert*, *unverändert* oder *abgelehnt* mit Grund).
- **Nur von Hand** — solche Eigenschaften schreibt nie ein Agent; deine eigenen Notizen neben den gespiegelten Daten bleiben also deine.

## Liste in eine Datenbank spiegeln
Das Rezept richtet alles ein. Wähle **Liste in eine Datenbank spiegeln**, dann:
1. **Quelle** — der MCP-Server deines Werkzeugs. Teste ihn einmal unter **Einstellungen → Claude KI → MCP-Server**: Dann startet der Agent nur mit dessen lesenden Werkzeugen.
2. **Name** und **Wo** — der Name der Datenbank und die Seite, unter die sie kommt (im Team-Workspace: dein privater Bereich).
3. **Datenbank und Agent anlegen** legt eine Datenbank mit den Feldern des Eintrags an (Schlüssel, Link, Status (Quelle), Prio (Quelle), Zuständig, Tags, Geändert am, Kommentare, Letzter Kommentar, **Neuer Kommentar**, **Wartet auf mich**, **Klarheit**, Warum, Nicht mehr in der Quelle) und mit deinen, auf *Nur von Hand* gestellt: **Mein Status**, **Meine Prio**, **Nächster Schritt**, **Fällig**. Sechs Ansichten: **Board nach Klarheit** (wartet auf dich in Rot, neue Kommentare in Orange), **Neue Kommentare**, **Bereit zum Arbeiten**, **Meine Woche**, **Wie in der Quelle** und **Alle** — dazu eine Berichtsseite daneben. **Rückgängig** in der Meldung entfernt alles wieder.

Der Agent öffnet sich im Editor: jeden Werktag um 07:30, **Vorschläge zur Prüfung**, ein Budget von 1,00 $ pro Lauf. Ersetze in seinen Anweisungen die vier Teile in **[ECKIGEN KLAMMERN]** — wie er die Einträge auflistet, wie er einen mit seinen Kommentaren liest, wer du im Werkzeug bist und was *Klar* für dich heißt; **Zu ersetzen** über dem Text wählt jeden Teil aus. Ein eingeschalteter Agent lässt sich nicht speichern, solange einer übrig ist.

Jeder Lauf liest nur, was sich seit dem letzten geändert hat (sein gespeicherter Zustand merkt sich die Zahl der Kommentare je Eintrag), aktualisiert die Zeilen über den Schlüssel, setzt **Neuer Kommentar** und **Wartet auf mich**, beurteilt die **Klarheit**, hakt **Nicht mehr in der Quelle** bei Einträgen an, die das Werkzeug nicht mehr auflistet, und legt dir Notizen in den [Posteingang](help:mentions-dates) — *„Neuer Kommentar zu #8215“*, *„3 Einträge sind bereit“*. Wenn die ersten Läufe stimmen, stell **Änderungen** auf **Direkt anwenden**.
