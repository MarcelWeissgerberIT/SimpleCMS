---
id: one-script
title: One Script
section: calculate
order: 4
keywords: skript, skripte, code, abfrage, abfragen, automatisieren, probelauf, abfrage-baukasten, autovervollständigung, vorschläge, bausteine, vorlagen, vorlagengalerie, md_table, md_chart, mail.send, claude, skript ausführen, schaltfläche, datenbankbefehl, automatisierung, gmail, mcp, one_run_query, one_run_script, ki-terminal, claude fragen, script, query, dry run
related: databases, database-commands, buttons, automations, gmail-sync, mcp-bridge, agent, custom-agents, formulas
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

## Vorlagen
**Aus Vorlage** auf der Skripte-Seite (oder ⌘K → *Neues Skript aus Vorlage …*) öffnet die Galerie: fertige Skripte in fünf Gruppen — *Aufgaben & Projekte*, *Mail & Kontakte*, *Berichte*, *Aufräumen*, *Mit Claude*. Jede Karte sagt, was das Skript tut, was es berührt (liest, schreibt, legt Seiten an, Papierkorb, sendet Mail, nutzt Claude, fragt nach) und welche deiner Datenbanken es nimmt.

- Eine Vorlage passt sich beim Verwenden deinem Workspace an: Sie wählt eine passende Datenbank nach ihren Eigenschaften (ein Status, ein Datum, Personen, eine Relation; die Mails- und Kontakte-Datenbank des [Gmail-Syncs](help:gmail-sync)) und schreibt deren echte Namen und Optionen in den Code, mit Kommentaren in deiner Sprache.
- Passt nichts, sagt die Karte, was fehlt (*Braucht eine Datenbank mit Datum*), und das Skript sagt es beim Lauf nur an.
- Darunter: Überfälliges → eine Berichtsseite, diese Woche fällig nach Tagen, offene Termine um N Tage verschieben, Projektfortschritt als Tabelle und Diagramm, Mails mit Antwortbedarf → Aufgaben (keine Doppelten beim nächsten Lauf), Kontakte zum Nachfassen, Einträge pro Status mit Ringdiagramm, ein Wochenrückblick, doppelte Titel → nach deinem OK in den Papierkorb, Zusammenfassungen mit Claude, eine Wochen-Update-Mail von Claude entworfen.
- Probier zuerst den **Probelauf**: Er zeigt, was das Skript ändern würde, ohne etwas zu ändern.

## Autovervollständigung
Der Editor schlägt beim Tippen vor — nach einem Buchstaben, nach `.` und `@` und in einem Text, wo eine Option passt; <kbd>Strg+Leertaste</kbd> (<kbd>⌥Esc</kbd> auf dem Mac) holt Vorschläge überall. <kbd>↑</kbd> <kbd>↓</kbd> wählen, <kbd>Enter</kbd> oder <kbd>Tab</kbd> übernehmen, <kbd>Esc</kbd> schließt; ist die Liste zu, macht Enter eine neue Zeile.

- Er weiß, was ein Wert ist: nach `db(@Aufgaben).` die Abfrage-Methoden, nach `.rows.` die Listen-Methoden, bei einem Eintrag zuerst seine Eigenschaften (mit Typ und Optionen), bei einer Seite, einem Text oder einem Datum deren Mitglieder — jedes mit Signatur und einer Zeile dazu.
- In `.where(`, `.sort(`, `.group(` … kommen die Eigenschaften der Datenbank als Namen (in Backticks, wo nötig); in `t.set(` und `.add(` als `Eigenschaft: `.
- Nach `Status = `, `Status != ` oder `set(Status: ` kommen die Optionen als Texte, bei einer Checkbox `true` / `false`, bei einem Datum `today()`, `today() + 7d` …, bei Personen `me()` und ihre Namen.
- `@` findet Seiten, Datenbanken, Einträge, Personen, Agenten und Skripte — auch mit Tippfehlern —, die zuletzt bearbeiteten zuerst.
- **Bausteine** am Zeilenanfang: `for`, `if`, `ifelse`, `fn`, `let`, `query`, `each`, `mail`, `confirm`, `choose`, `ask`, `notify`, `claude`. <kbd>Tab</kbd> springt zur nächsten Stelle zum Ausfüllen, <kbd>Shift+Tab</kbd> zurück, <kbd>Esc</kbd> verlässt sie.
- Die Leiste unter dem Code zeigt den Aufruf, in dem du bist, mit markiertem Argument. <kbd>F1</kbd> oder <kbd>Mod+I</kbd> — oder <kbd>Strg</kbd> / <kbd>⌘</kbd> + Zeigen — erklärt den Namen an der Schreibmarke.

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
- Markdown für Seiten: `md_table(zeilen, ["Name", "Fällig"])` schreibt eine Abfrage, Einträge oder Datensätze als Tabelle (Titel verlinken auf ihre Seiten); `md_chart(db(@Aufgaben).group(Status), "donut")` wird ein echter Diagramm-Block, wenn das Skript es in eine Seite schreibt. `page.here` ist `page.current` — oder `null` statt eines Fehlers, wenn das Skript für keine Seite läuft.
- Ein Zeitraum verschiebt sich als Ganzes: `t.Zeitraum + 7d`.
- Text, Listen, Zahlen, Datum: `upper`, `split`, `join`, `replace`, `contains`, `len`, `round`, `format(datum, "dd.MM.yyyy")`, `days_between` … — die **Referenz** neben einem Skript listet alle.
- Fragen: `modal(text, buttons: ["OK"])`, `confirm(text)`, `ask(text, default: "")`, `choose(text, optionen)`, `notify(text)`, `print(…)`.
- Wirkungen: `mail.send(to:, subject:, body:, cc:)` — ein fertiger Entwurf in deinem Mailprogramm (oder Gmail, wenn verbunden); `claude(prompt, context)` — dein eigener Claude-Schlüssel; `http.post(url, daten)` — nur, wenn du es erlaubst.

## Abfragen
Ein Skript der Art **Abfrage** zeigt sein Ergebnis live unter dem Editor, während du tippst — mit Anzahl, Zeit und „0 Ergebnisse“, wenn nichts passt. Abfragen lesen nur: Schreiben oder eine Wirkung wird abgelehnt.

Der **Abfrage-Baukasten** daneben baut `db(@X).where(…).sort(…).limit(…).select(…)` per Klick: Bedingungen je Eigenschaft (die Operatoren passen zum Typ; Optionen, Personen und Datumsvorgaben wie *heute + 3 Tage*), *alle* / *eine* und eine Ebene Gruppen, Sortierung, Höchstzahl und Felder. Er schreibt den Code, und Änderungen am Code zeigt er an. Code, den er nicht darstellen kann, bleibt genau so, wie er ist — **Als Text bearbeiten**.

## Skripte von überall ausführen
- **Datenbankbefehl** — *Befehle bearbeiten… → Befehl hinzufügen → Skript ausführen* an einer Datenbank (siehe [Datenbankbefehle](help:database-commands)). Über die Befehle-Taste der Datenbankseite mit ausgewählten Zeilen läuft es einmal pro Zeile — `page.current` ist diese Zeile; sonst einmal für die Datenbankseite.
- **Schaltfläche** — die Aktion *Skript ausführen*, oder tippe `/script`: eine Schaltfläche, die ein Skript für die Seite ausführt, auf der sie steht (siehe [Schaltflächen](help:buttons)).
- **Automatisierung** — die Aktion *Skript ausführen* läuft für die Zeile, die sich geändert hat (siehe [Automatisierungen](help:automations)). Solange es läuft, starten seine eigenen Änderungen keine Automatisierung erneut.
- **⌘K** — tippe *Skript ausführen: <Name>*: es läuft für die geöffnete Seite.

Jeder davon ist ein normaler Lauf: Mail, Claude, Web-Anfragen und der Papierkorb werden vorher aufgelistet und bestätigt; der Hinweis nach dem Lauf hat **Rückgängig**.

## Mail über Gmail
Ist Gmail auf diesem Gerät verbunden (Einstellungen → Mail, siehe [Gmail-Sync](help:gmail-sync)), **sendet** `mail.send` von diesem Konto — die Liste vor dem Lauf sagt *über Gmail · du@…*. Beim ersten Mal fragt Google noch einmal: nach der Erlaubnis, Mails zu *senden* (Lesen bleibt, wie es war). Die Anmeldung liegt nur im Speicher dieses Tabs, nie im Speicher des Browsers. Ohne Gmail öffnet sich stattdessen ein fertiger Entwurf in deinem Mailprogramm; One selbst sendet nichts.

## Claude fragen
Über dem Abfrage-Baukasten (Abfragen) und der Referenz (Skripte): beschreibe, was du willst — *offene Aufgaben, die diese Woche fällig sind, die nächsten zuerst* — und Claude entwirft den Code. Claude bekommt deine Bitte, den Code und die Namen und Eigenschaften deiner Datenbanken, nie Seiteninhalte. Der Entwurf wird geprüft, bevor du ihn siehst (eine Abfrage wird auch lesend ausprobiert, mit ihrer Zeilenzahl); **Übernehmen** setzt ihn in den Editor (mit Rückgängig), nichts läuft von selbst.

## Mit Claude und Agenten
- **KI-Terminal** (⌘J): Claude beantwortet Fragen über Datenbanken hinweg mit einer lesenden Abfrage (`run_query`) und entwirft Skripte für dich (`write_script`) — ein entworfenes Skript landet in der Prüfliste; *Übernehmen* speichert es unter Skripte, es läuft nie von selbst.
- **Eigene Agenten** bekommen `run_query` auch — innerhalb ihres Bereichs.
- **One MCP** (Claude Desktop, Claude Code, siehe [MCP-Brücke](help:mcp-bridge)): `one_run_query` beantwortet eine Abfrage; `one_run_script` führt eines deiner gespeicherten Skripte aus — One zeigt auf der Freigabekarte zuerst einen Probelauf mit allem, was es ändern und senden würde, und es läuft erst, wenn du zustimmst, auch bei *Direkt anwenden*. *Nur lesen* lehnt es ab.

> In einem Team-Workspace sind Skripte geteilt. Eine Version, die jemand anderes geändert hat, läuft auf deinem Gerät erst, nachdem du sie angesehen und bestätigt hast. Läufe werden pro Gerät gespeichert.
