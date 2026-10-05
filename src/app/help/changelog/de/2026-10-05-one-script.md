---
id: 2026-10-05-one-script
date: 2026-10-05
order: 1
title: One Script — kleine Skripte und Live-Abfragen
summary: Eine kleine, sichere Skriptsprache, die nur deinen Workspace erreicht — mit Probelauf, Live-Abfragetester und Abfrage-Baukasten.
image: assets/shots/changelog/one-script.webp
alt: Eine Abfrage im Skript-Editor mit der Datenbank Projekte als Chip, rechts der Abfrage-Baukasten mit seinen Bedingungen, darunter die Live-Ergebnistabelle
help: one-script, databases
---
**Skripte** in der Seitenleiste enthält kleine Programme in Ones eigener Sprache — `let`, `if`, `for`, `fn`, Texte mit `{…}`, Datum und Dauern wie `today() + 3d`. Sie erreichen nur deine Seiten, Datenbanken und Personen; Mail, Claude und das Web nur, wenn du es erlaubst.

- Tippe `@`, um eine Seite oder Datenbank zu wählen: sie wird zum Chip und übersteht Umbenennungen.
- <kbd>Mod+Shift+Enter</kbd> ist ein **Probelauf**: Er liest wirklich, ändert nichts und listet, was das Skript tun würde. <kbd>Mod+Enter</kbd> führt es aus — alles, was One verlässt, wird vorher einmal aufgelistet, jede geänderte Seite behält eine Version, und **Lauf rückgängig** stellt alles wieder her.
- Eine **Abfrage** zeigt ihr Ergebnis live beim Tippen — Anzahl, Zeit und ein klares „0 Ergebnisse“. Der **Abfrage-Baukasten** daneben schreibt den Code per Klick (Bedingungen, Sortierung, Höchstzahl, Felder) und folgt, wenn du den Code änderst.

`mail.send` öffnet einen fertigen Entwurf in deinem Mailprogramm; `claude()` nutzt deinen eigenen Schlüssel. Siehe [One Script](help:one-script).
