---
id: one-script
title: One Script
section: calculate
order: 4
keywords: skript, skripte, code, abfrage, abfragen, automatisieren, probelauf, abfrage-baukasten, mail.send, claude, script, query, dry run
related: databases, custom-agents, formulas
summary: Kleine Skripte und Abfragen in Ones eigener, sicherer Sprache — erst als Probelauf, Abfragen per Klick gebaut.
---
**Skripte** in der Seitenleiste (oder ⌘K → *Neues Skript*) enthält kleine Programme in Ones eigener Sprache. Ein Skript erreicht nur deinen Workspace — Seiten, Datenbanken, Personen — und Mail, Claude und das Web nur, wenn du es erlaubst. Sonst ist vom Browser nichts erreichbar.

```
let fällig = db(@Aufgaben).where(Status = "Offen", Fällig < today() + 3d)
for t in fällig {
  t.set(Priorität: "Hoch")
}
notify("{fällig.count} Aufgaben hochgestuft")
```

Tippe `@` und wähle eine Seite, Datenbank oder Person: sie wird zum Chip. Der Chip zeigt weiter auf dieselbe Seite, auch wenn sie umbenannt wird.

## Ausführen, Probelauf, Stopp
- <kbd>Mod+Shift+Enter</kbd> — **Probelauf**: liest wirklich, ändert nichts, sendet nichts und listet, was das Skript tun *würde* („2 Einträge in Aufgaben ändern, eine Mail an … senden“).
- <kbd>Mod+Enter</kbd> — **Ausführen**. Bevor etwas One verlässt (Mail, Claude, Web) oder in den Papierkorb geht, siehst du die Liste einmal und kannst Punkte abwählen. Web-Anfragen sind aus, bis du sie anhakst.
- <kbd>Mod+.</kbd> — **Stopp**. <kbd>Mod+E</kbd> wertet die Auswahl aus (oder die aktuelle Zeile).
- Jede geänderte Seite behält vorher eine Version (siehe [Versionsverlauf](help:history)), und **Lauf rückgängig** im Laufprotokoll stellt alles wieder her.
- Endlosschleifen enden von selbst: ein Schritt- und ein Zeitbudget (60 s; du kannst einmal mehr geben).

## Die Sprache
- `let x = 1` legt an, `x = 2` ändert. `#` oder `//` beginnt einen Kommentar.
- Werte: Zahlen, Texte `"Hallo {name}"` (mit `{…}` darin), `true` / `false` / `null`, Listen `[1, 2]`, Datensätze `{to: "a@b.c", subject: "Hallo"}`, Datum `today()`, `date("2026-10-05")`, Dauern `3d` `2h` `30m` `1w`.
- `if … { } else { }`, `for t in liste { }`, `while … { }`, `fn name(a, b = 1) { return … }`, kurze Funktionen `x => x.Name`.
- In Bedingungen vergleicht `=` (wie in SQL): `Status = "Offen"`; `!=`, `<`, `>=`, `and`, `or`, `not`, `in`.
- Eigenschaften sind Namen: `Fällig`, `Priorität`. Ein Name mit Leerzeichen steht in Backticks:

```
let bald = db(@Aufgaben).where(`Fällig am` < today() + 3d).sort(`Fällig am`)
```

- Aufrufe nehmen benannte Werte: `mail.send(to: x, subject: "Daten")`.

## Die Bibliothek
- `page(@Seite)` / `page("Eltern / Seite")` → `.title`, `.markdown`, `.text`, `.children`, `.set(…)`, `.append(md)`, `.prepend(md)`, `.replace(md)`, `.open()`; `page.current` ist die Seite, für die ein Skript läuft.
- `db(@Aufgaben)` → `.where(…)`, `.sort(Fällig desc)`, `.limit(n)`, `.select(Name, Status)`, `.count`, `.sum(Budget)`, `.avg`, `.min`, `.max`, `.group(Status)`, `.first`, `.rows`, `.add("Titel", Status: "Offen")`, `.schema`. Einträge sind Seiten mit ihren Eigenschaften: `t.Status`, `t.set(Status: "Erledigt")`.
- Werte folgen der Datenbank: Optionen per Name, Daten, Personen per Name, Verknüpfungen per Titel.
- `create.page(title: …, parent: @Seite, markdown: …)`, `trash(eintrag)`.
- Text, Listen, Zahlen, Datum: `upper`, `split`, `join`, `replace`, `contains`, `len`, `round`, `format(datum, "dd.MM.yyyy")`, `days_between` … — die **Referenz** neben einem Skript listet alle.
- Fragen: `modal(text, buttons: ["OK"])`, `confirm(text)`, `ask(text, default: "")`, `choose(text, optionen)`, `notify(text)`, `print(…)`.
- Wirkungen: `mail.send(to:, subject:, body:, cc:)` — ein fertiger Entwurf in deinem Mailprogramm (oder Gmail, wenn verbunden); `claude(prompt, context)` — dein eigener Claude-Schlüssel; `http.post(url, daten)` — nur, wenn du es erlaubst.

## Abfragen
Ein Skript der Art **Abfrage** zeigt sein Ergebnis live unter dem Editor, während du tippst — mit Anzahl, Zeit und „0 Ergebnisse“, wenn nichts passt. Abfragen lesen nur: Schreiben oder eine Wirkung wird abgelehnt.

Der **Abfrage-Baukasten** daneben baut `db(@X).where(…).sort(…).limit(…).select(…)` per Klick: Bedingungen je Eigenschaft (die Operatoren passen zum Typ; Optionen, Personen und Datumsvorgaben wie *heute + 3 Tage*), *alle* / *eine* und eine Ebene Gruppen, Sortierung, Höchstzahl und Felder. Er schreibt den Code, und Änderungen am Code zeigt er an. Code, den er nicht darstellen kann, bleibt genau so, wie er ist — **Als Text bearbeiten**.

> In einem Team-Workspace sind Skripte geteilt. Eine Version, die jemand anderes geändert hat, läuft auf deinem Gerät erst, nachdem du sie angesehen und bestätigt hast. Läufe werden pro Gerät gespeichert.
