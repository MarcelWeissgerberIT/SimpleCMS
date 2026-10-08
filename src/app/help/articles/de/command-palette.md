---
id: command-palette
title: Suche, Filter & Befehle (⌘K)
section: start
order: 3
keywords: palette, suche, finden, befehl, befehlspalette, cmd k, strg k, fragen, filter, status, eigenschaft, zuletzt, häufig, search, command, ask, property
related: keyboard-shortcuts, ai-menu, sidebar
summary: Ein Feld für alles — jede Seite finden, nach Status oder Person filtern, jeden Befehl ausführen, Claude fragen.
---
Drücke <kbd>Mod+K</kbd> (oder <kbd>Mod+P</kbd>, oder **Suchen** in der Seitenleiste). Die Palette hat drei Modi:

- **Finden** — tippen durchsucht Seitentitel und Seiteninhalte. Zu jeder Seite steht ihr Pfad, Treffer sind markiert. Auch Hilfeartikel erscheinen, in der Gruppe **Hilfe**. Filter (unten) grenzen das ein.
- **Befehle** — beginnt mit `>` und zeigt nur Befehle: neue Seite, neue Datenbank, Vorlagen, Import, Export, Design, Fokusmodus, Einstellungen …
- **Fragen** — beginnt mit `?` und fragt Claude zur geöffneten Seite (braucht deinen Claude-Schlüssel).

## Filter
Tipp einen Filter und ein Leerzeichen: Er wird zum Chip im Feld, und die Treffer folgen allen Chips.

- `status:erledigt` — jede Eigenschaft über ihren Namen, in jeder Datenbank, die sie hat. Ein Status trifft auch seine Gruppe: `erledigt`, `in-arbeit`, `offen` (`status:erledigt` findet „Erledigt“, „Gelesen“ und „Veröffentlicht“ gleichermaßen).
- `tags:web`, `verantwortlich:alex`, `verantwortlich:ich`, `budget:>5.000`, `fortschritt:>50%`, `"tage übrig":<3` — ein Name mit Leerzeichen in Anführungszeichen oder mit Bindestrichen: `tage-übrig:<3`. Zahlen kennen `>`, `<`, `>=`, `<=`.
- `@alex` / `@ich` — jemand in einer Personen-Eigenschaft (Verantwortlich, Zuständig …).
- `von:sam` — Seiten, die Sam erstellt oder zuletzt geändert hat (Team-Workspaces; `von:<Agent>` findet die Änderungen eines eigenen Agenten). Hat eine Datenbank eine Eigenschaft „Von“, gilt `von:` dieser Eigenschaft.
- `in:projekte` — die Einträge einer Datenbank oder die Seiten unter einer Seite.
- `ist:favorit`, `ist:seite`, `ist:datenbank`, `ist:zeile` — und `ist:privat` in Team-Workspaces.
- `geändert:7t`, `erstellt:heute`, `geändert:>30t` (seit 30 Tagen unverändert), `geändert:2026-09`, `erstellt:>2026-09-01`, `geändert:woche`.
- `hat:verantwortlich` — die Eigenschaft ist ausgefüllt.
- `-` davor verneint: `-status:erledigt`. Derselbe Filter zweimal heißt „eins von beiden“: `status:review status:erledigt`.
- Englische Schreibweisen gehen auch: `is:favorite`, `has:owner`, `edited:7d`, `created:today`, `by:sam`, `status:done`.

Wörter und Filter lassen sich mischen: `brand status:erledigt` sucht „brand“ unter den erledigten Einträgen. Eine Eigenschaft, die wie ein Schlüsselwort heißt, erreichst du mit Anführungszeichen: `"Erstellt":2026`. Text, der nur wie ein Filter aussieht (`Re: Budget`, `10:30`, ein Link), bleibt Text.

Beim Tippen eines Filters zeigen Vorschläge, was passt — die Optionen einer Eigenschaft mit der Zahl ihrer Einträge, Personen, Seiten, Daten. Ein Hinweis sagt, was ein Wert sein kann oder warum er nichts trifft.

## Tasten
- <kbd>↑</kbd> <kbd>↓</kbd> wählen, <kbd>Enter</kbd> öffnet.
- <kbd>Tab</kbd> oder <kbd>Enter</kbd> auf einem Vorschlag übernimmt ihn; <kbd>Rücktaste</kbd> im leeren Feld entfernt den letzten Filter. Ein fokussierter Chip geht mit <kbd>Enter</kbd>, <kbd>Entf</kbd> oder einem Klick.
- <kbd>Alt+Enter</kbd> öffnet eine Seite stattdessen im Seitenbereich daneben.
- <kbd>Esc</kbd> schließt die Palette.

## Das leere Feld
Ohne Suchbegriff zeigt die Palette **Zuletzt** (die zuletzt geöffneten Seiten) und **Häufig** (die Seiten, die dieses Gerät am meisten öffnet), dann die Befehle. Beide Listen bleiben auf diesem Gerät — siehe [Seitenleiste & Seitenbaum](help:sidebar).

Passt nichts, legt die letzte Zeile eine Seite mit deinem Suchbegriff an.
