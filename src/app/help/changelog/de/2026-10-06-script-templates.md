---
id: 2026-10-06-script-templates
date: 2026-10-06
order: 1
title: One Script — Autovervollständigung, die deine Datenbanken kennt, und 20 Vorlagen
summary: Der Skript-Editor schlägt jetzt vor wie eine IDE — Eigenschaften, Optionen, Mitglieder nach Typ, Bausteine — und eine Galerie fertiger Vorlagen passt sich deinem Workspace an.
image: assets/shots/changelog/script-templates.webp
alt: Die Vorlagen-Galerie mit Kategorien und Karten, daneben der Skript-Editor, der nach „Status =“ die Optionen einer Status-Eigenschaft vorschlägt
help: one-script
---
**Vorlagen** — *Aus Vorlage* auf der Skripte-Seite (oder ⌘K → *Neues Skript aus Vorlage …*) öffnet eine Galerie mit 20 Skripten: Überfälliges → eine Berichtsseite, diese Woche fällig nach Tagen, Projektfortschritt als Tabelle und Diagramm, Mails mit Antwortbedarf → Aufgaben, Kontakte zum Nachfassen, ein Wochenrückblick, doppelte Titel, eine Wochen-Update-Mail von Claude und mehr. Jede wählt eine passende Datenbank deines Workspaces und schreibt deren echte Namen; die Karte sagt, was sie nutzt — oder was sie braucht.

**Autovervollständigung** — Vorschläge beim Tippen, nach `.` und `@` oder mit <kbd>Strg+Leertaste</kbd>:

- Mitglieder, die zum Wert passen: die Methoden einer Abfrage, zuerst die Eigenschaften eines Eintrags, die Teile eines Datums — jedes mit Signatur und einer Zeile dazu;
- in `.where(` oder `.set(` die Eigenschaften der Datenbank, nach `Status = ` ihre Optionen;
- Bausteine wie `for`, `if` oder `query` mit Stellen zum Ausfüllen — <kbd>Tab</kbd> springt von einer zur nächsten.

<kbd>F1</kbd> erklärt den Namen an der Schreibmarke. Neu in der Bibliothek: `md_table` und `md_chart` schreiben Tabellen und echte Diagramm-Blöcke in Seiten. Siehe [One Script](help:one-script).
