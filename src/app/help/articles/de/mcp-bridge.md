---
id: mcp-bridge
title: Claude Desktop & lokales MCP
section: ai
order: 7
keywords: mcp, mcp verbindungen, skript, probelauf, beidseitig, unterelemente, abhängigkeiten, verbunden, claude desktop, claude code, cursor, brücke, mcpb, erweiterung, agent, lokal, one-mcp, codewort, one:, aufräumen, papierkorb, wiederherstellen, verschieben, aufgaben, one_list_work_items, one_update_work_item, unterseiten, board, zeilen, stapel, upsert, one_list_pages, blöcke, kommentare, bridge, extension, sub-page
related: mcp-servers, agent, team-cloud
summary: Lass Claude Desktop, Claude Code oder jeden MCP-Client in deinem offenen One-Tab arbeiten.
---
**Einstellungen → Agenten · MCP.** Eine kleine Brücke auf deinem Computer verbindet den MCP-Client mit diesem Tab — dein Workspace bleibt im Browser.

Ist sie verbunden? ⌘K **MCP · Verbindungen** zeigt die Brücke dieses Tabs neben jeder anderen MCP-Verbindung — den MCP-Servern von Claude in One, dem Coding-Worker, dem Team-Server.

## Claude Desktop — ein Klick
1. **Zu Claude Desktop hinzufügen** lädt `one.mcpb` herunter (macOS, Windows). Datei öffnen — Claude Desktop fragt, ob es die Erweiterung installieren soll. Kein Terminal, kein Node.js.
2. Zurück in One: **KI-Agenten auf diesem Computer erlauben** einschalten.
3. Frag Claude Desktop: *„Was steht in meinem One-Workspace?“*

**Codewort:** Beginne eine Nachricht mit `one:` — *„one: räum meine Projects-Datenbank auf“* — und Claude nutzt dafür One, nicht das Web oder andere Connectoren. Claude Desktop führt es auch im Prompt-Menü (**+** → *One*), Claude Code als `/mcp__one__one`.

Fragt der Browser, ob One Apps auf diesem Gerät erreichen darf („Zugriff auf lokales Netzwerk“), wähle **Zulassen**. Meldet der Tab, dass der Browser einer sicheren Seite den Kontakt zur Brücke verbietet (Safari kann das), nimm Chrome, Edge oder Firefox.

## Claude Code, Cursor, VS Code …
**Andere Clients · manuelle Einrichtung** (braucht Node.js 20 oder neuer): die Brückendatei `one-mcp.mjs` im Benutzerordner speichern, dann für Claude Code:
```
curl -fsSL https://getonecms.com/mcp/one-mcp.mjs -o ~/one-mcp.mjs
claude mcp add one -- node ~/one-mcp.mjs
```
Andere MCP-Clients starten sie als stdio-Server: Befehl `node`, Argument der Pfad zu `one-mcp.mjs`.

## Was Agenten dürfen
- **Erst fragen** — jede Änderung wartet auf dein OK auf einer Karte in diesem Tab (2 Minuten, dann wird sie abgelehnt). Lesen braucht kein OK.
- **Direkt anwenden** — Änderungen werden sofort geschrieben und im **Agenten-Protokoll** gelistet, wo sich jede rückgängig machen lässt.
- **Nur lesen** — jede Änderung wird abgelehnt.

Auch bei **Direkt anwenden** wird eine Änderung auf einer Karte erfragt, wenn sie jemanden zuweist, eine Erinnerung setzt, eine zugewiesene Aufgabe ändert, einer Aufgabe einen Blocker hinzufügt oder Aufgaben entfernt oder wenn 5 oder mehr Zeilen auf einmal bezahlte KI-Arbeit starten oder etwas aus One hinausschicken würden — die Karte sagt warum (**Wird immer gefragt: …**).

## Unterseiten, Boards und Zeilen in einem Zug
Eine Anfrage, eine Karte: Ein Agent kann einen **Baum aus bis zu 50 Unterseiten** anlegen (auch unter einer Datenbankzeile), ein **Board** mit seinen Spalten und Karten als Unterseite oder im Text einer Seite, oder **bis zu 50 Zeilen** auf einmal ändern — *„Lege unter Projekt Nordlicht eine Unterseite mit einem Board Todo / Doing / Done an und trage diese fünf Aufgaben ein“* ist eine Suche und eine Karte. Die Karte nennt jede Seite und jede Zeile mit jedem Wert, den sie schreibt, und den ersten Zeilen ihres Texts (und was ein Stapel auslösen würde: Autofill, Automationen, Agenten); **Rückgängig** im **Agenten-Protokoll** legt in den Papierkorb, was der Aufruf angelegt hat — außer jemand hat es seitdem geändert. Beim Spiegeln von Einträgen aus anderen Quellen über einen Schlüssel ändert sich nur, was abweicht.

Agenten lesen eine Seite außerdem **vollständig**: jeden Block mit seinen Daten (Datenbanken, Dateien, Tabellen, Diagramme, Besprechungsnotizen), lange Seiten in Teilen. Ein Aufruf, der innerhalb von 2 Minuten wiederholt wird, legt nichts doppelt an — der Agent erfährt, dass es schon da ist.

## Kommentare
Aus, bis du sie einschaltest: **Kommentare** unter **Einstellungen → Agenten · MCP** — **Aus**, **Lesen** oder **Lesen + schreiben**, für dieses Gerät. Mit **Lesen** sehen Agenten die Kommentar-Threads einer Seite, wenn sie danach fragen. Kommentare über MCP schreiben kommt später.

## Was Agenten nicht ändern
Die eigenen Datenbanken von One — Gedächtnis, Mails und die Mail-Verzeichnisse, die Coding-, Analyse- und QA-Pipelines — lassen sich über MCP lesen, aber nicht ändern. Vorlagen sind für Agenten unsichtbar. Eine Coding-Aufgabe, die eine von einem Agenten geänderte Seite mitnimmt, läuft erst, wenn du sie mit **Auf diesem Gerät bestätigen** freigibst.

Beidseitige Relationen — auch Unterelemente und Abhängigkeiten — setzt du in One: Agenten setzen einseitige Relationen, einen Wert einer beidseitigen (oder eine Relation beidseitig machen) lehnt One ab. Deine gespeicherten Skripte bekommen über MCP nur einen Probelauf: Der Agent sieht, was ein Skript ändern und senden würde, es passiert nichts, und ausführen tust du es in One (**Skripte**). Das Agenten-Protokoll markiert so einen Aufruf mit *Nur Probelauf*.

## Aufgaben
Agenten lesen [Aufgaben](help:tasks) einer Seite als `> [!TODO] Titel {#wi_…}` mit Feldzeile und Erwähnungen als `[@Alex](one:person/…)` — schreiben sie den Text zurück, bleibt beides erhalten. Neue `[!TODO]`-Zitate werden nach denselben Regeln wie in One zu Aufgaben (Verantwortliche nur vorhandene Personen, IDs von One). **one_list_work_items** findet Aufgaben (offen, meine, blockiert, überfällig …); **one_update_work_item** ändert Status, Termin, Erinnerung, Verantwortliche oder Verknüpfungen — jede Aufgabe steht mit ihren Feldern vorher → nachher auf der Freigabekarte. Eine Seite, die sich geändert hat, während ihr Ersetzen auf dein OK wartete, wird nicht ersetzt: Der Agent soll sie neu lesen. Die Aufgaben-Werkzeuge brauchen Brücke 1.8.0 (`one.mcpb` neu herunterladen) und gibt es nur an der lokalen Brücke; der Team-Server bekommt sie später.

## Aufräumen
Agenten können auch umorganisieren: Seiten und Datenbanken im Baum verschieben, eine Zeile in eine andere Datenbank mit passenden Eigenschaften verschieben, Datenbanken umbenennen, Eigenschaften (Optionen, sichere Typwechsel) und Ansichten ändern, Eigenschaften und Ansichten löschen, Seiten, Zeilen und ganze Datenbanken in den Papierkorb legen — bis zu 50 auf einmal — und wiederherstellen. Endgültig gelöscht wird nichts. Eine gesperrte Datenbank lehnt Strukturänderungen ab; das Sperren bleibt deine Entscheidung. Jede Änderung zeigt, was geht (*Datenbank „Projects“ mit 8 Zeilen → Papierkorb*), und lässt sich im **Agenten-Protokoll** rückgängig machen. Brücken vor 1.2.0 kennen diese Tools nicht: `one.mcpb` neu herunterladen.

Unterseiten, Boards, Zeilen in einem Zug und das vollständige Lesen brauchen Brücke **1.12.0**: Ist deine älter, sagt es **Einstellungen → Agenten · MCP** — `one.mcpb` (oder `one-mcp.mjs`) neu herunterladen. Bis dahin liest ein Agent von einer langen Seite nur die ersten 60.000 Zeichen (er erfährt, wo sie abgeschnitten ist) und sieht von einer Seite nur die ersten 100 Unterseiten. Nach einem Update von One den Tab einmal neu laden, sonst lehnt die Brücke die neuen Werkzeuge ab („One neu laden“).

Der neueste Tab eines Workspace bekommt die Brücke. Standard-Port ist 47321 (`ONE_MCP_PORT` ändert ihn). Details: `docs/MCP.md` im Repository.
