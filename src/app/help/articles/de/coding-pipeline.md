---
id: coding-pipeline
title: Coding-Pipeline (Claude Code auf deinem Rechner)
section: ai
order: 9
keywords: coding, pipeline, claude code, worker, one-worker, download, einrichten, koppeln, modell, opus, sonnet, haiku, fable, repositories anhaken, git, branch, worktree, pull request, pr, diff, tests, repo, repository, code-review, programmieren, aufgaben
related: pipelines, legacy-modernisation, mcp-bridge, custom-agents, agent
summary: Gib Programmieraufgaben an Claude Code auf deinem Rechner — planen, freigeben, umsetzen, testen, ausliefern — und verfolge jeden Schritt in One.
---
**#/coding** (⌘K *Coding-Pipeline*). One verwaltet die Aufgaben, die Freigaben, das Log und den Diff; ein kleiner Worker auf **deinem** Rechner führt Git und Claude Code aus. Dein Code verlässt deinen Rechner nie.

## In drei Schritten einrichten
Du brauchst Node.js 20+, Git und die **Claude-Code**-CLI, einmal angemeldet (`claude`). Dann **Einstellungen → Coding-Worker** (oder **#/coding**):

1. **Lade den Worker für diesen Arbeitsbereich herunter.** Die Datei ist schon mit diesem Browser und diesem Arbeitsbereich gekoppelt — nichts einzustellen. One schaltet die Verbindung selbst ein.
2. **Starte ihn** in einem Terminal und lass ihn laufen:
```
node ~/Downloads/one-worker.mjs
```
3. **Hak deine Repositories auf der Seite an, die sich öffnet.** Der Worker findet die Git-Repositories auf deinem Rechner und öffnet eine Seite in deinem Browser: Hak die an, in denen One arbeiten darf, prüf Basis-Branch und Testbefehl (z. B. `npm test`), dann **Speichern & starten**. Die Karte zeigt *Verbunden · laptop · 2 Repos*, und die **WORKER**-LED in der Statusleiste wird grün.

Business-Analyse und QA haben eigene Pipelines – siehe [Business-Analyse- und QA-Pipelines](help:pipelines). Erwähne Seiten in einer Aufgabe mit **@**: Ihr Text geht mit an Claude Code.

Neuer Code? Dieselbe Seite klont von **GitLab / GitHub** (eine Adresse oder ein Projekt aus deiner Liste mit `glab` / `gh`) oder importiert eine **ZIP** als neues Repository nach `~/one-repos` – siehe [Altsoftware modernisieren](help:legacy-modernisation). Pro Repository kann sie Claude Code auch deine eigenen MCP-Server geben (z. B. eine Wissensbasis).

Später ändern: **Repositories ändern** — der Worker öffnet seine Seite wieder auf deinem Rechner. One erfährt immer nur die Namen der Repos; Pfade und Befehle bleiben in `~/.config/one/worker.json` auf deinem Rechner.

> Tipp: Ein neuer Download ersetzt die Kopplung — starte die zuletzt heruntergeladene Datei. Auf einem Rechner ohne Browser fragt `node one-worker.mjs --no-browser` stattdessen im Terminal (Zahlen haken an, Enter speichert).

## Freigaben – oder einfach machen
Im Coding-Panel wählst du bei **Freigaben**, wo die Aufgabe auf dich wartet: **Plan und Review freigeben** (Standard), **Nur Review – der Plan läuft durch** oder **Keine – einfach machen**: Dann laufen Plan, Umsetzung, Tests und Ausliefern ohne Halt durch; schlagen die Tests zweimal fehl, hält sie trotzdem beim Review. Die Wahl gilt auf diesem Gerät und ist die Vorgabe für neue Aufgaben. Wartet eine Aufgabe schon an einer Freigabe, die du gerade abwählst, geht sie sofort weiter.

Im Tab **Log** siehst du jeden Schritt: *Fetching origin…*, den neuen Branch, *Starting Claude Code…*, jedes Werkzeug, das Claude Code benutzt – und solange es still arbeitet, einmal pro Minute *still working*. Kann der Worker das Remote nicht holen (kein Netz, oder git bräuchte ein Passwort bzw. die Passphrase des SSH-Schlüssels), steht das nach höchstens 60 Sekunden im Log, und die Aufgabe arbeitet mit dem Stand auf deinem Rechner weiter. Für Push und Pull Request braucht git einen SSH-Agent oder einen Credential Helper – tippen kann der Worker nichts.

## Modell je Stufe
Welches Claude-Modell Claude Code nutzt, legst du in der **Pipeline** (auf #/coding) fest: Öffne die Details einer Stufe (Plan-, Umsetzungs- und Dokument-Stufen) und wähle ihr **Modell** — **Standard** (das Modell des Repos in der `worker.json` des Workers, sonst die Vorgabe von Claude Code), **Opus**, **Sonnet**, **Haiku**, **Fable** oder **Eigenes …** für jeden anderen Modellnamen (Buchstaben, Ziffern und `. _ : - [ ]`; One prüft ihn beim Tippen). Eine Stufe mit Modell zeigt es als kleinen Chip in ihrer Zeile. Mit einem starken Modell planen, mit einem schnelleren umsetzen — jede Stufe läuft mit ihrem eigenen.

Für eine Aufgabe überschreibt **Modell** im Coding-Panel (neben den Freigaben) jede Claude-Code-Stufe dieser Aufgabe — auf diesem Gerät: **Wie die Pipeline**, eines der Modelle oben oder ein eigener Name, den die Pipeline schon nutzt. Während Claude Code läuft, zeigt ein Chip unter **Jetzt** das Modell, das es wirklich nutzt, und das Log nennt das Modell, das der Worker weitergegeben hat. Ein Worker, der vor den Modellen heruntergeladen wurde, bekommt nie eine Stufe mit Modell — die Aufgabe meldet *Diese Stufe braucht einen neueren Coding-Worker*: lade ihn neu herunter, dann **Erneut versuchen**.

## Eine Aufgabe von Anfang bis Ende
1. **Neue Aufgabe**: Titel, Repo, Ziel, Abnahmekriterien. *Der Worker darf gleich anfangen* angehakt lassen. Die Aufgabe selbst steht im **Seiteninhalt** der Aufgabe (unter dem Coding-Panel) — mit diesem Text arbeitet Claude Code. Ist die Seite leer, fügt **Gliederung einfügen** Ziel, Abnahmekriterien und Hinweise zum Ausfüllen ein.
2. **Plan** — Claude Code liest den Code im Plan-Modus (ändert nichts) und schreibt den Plan in die Aufgabe. Die Aufgabe wartet bei **Plan freigeben**.
3. **Freigeben** — oder **Nacharbeit…** mit Anweisungen: Sie geht mit deiner Notiz zurück zum Plan.
4. **Umsetzen** — Claude Code ändert den Code in einem eigenen Git-Worktree; **Testen** führt deinen Testbefehl aus. Schlagen die Tests fehl, bekommt „Umsetzen“ mit deren Ausgabe noch einen Versuch.
5. **Review** — die Tabs **Diff** und **Tests** zeigen, was sich geändert hat. Freigeben oder zurückschicken.
6. **Ausliefern** — committen, pushen, Pull Request (mit der GitHub-CLI) oder ein Vergleichslink. **Fertig**.

Jede Aufgabe arbeitet auf einem eigenen Branch (`one/<titel>-<id>`) in einem eigenen Worktree — dein Haupt-Checkout bleibt, wie er ist. Bevor eine Aufgabe läuft, wählst du im Coding-Panel das **Repo** (die Repos, die dein Worker meldet) und den **Branch**: *Neuer Branch (automatisch)* oder einen vorhandenen Branch des Repos auf deinem Rechner, um darauf weiterzuarbeiten (der Basis-Branch wird nie angeboten). Eintippen geht auch im Feld **Branch**.

## Während sie läuft
- **Jetzt** zeigt die letzte Zeile des Workers und wie lange sie her ist; darunter **Schritt 6/30** (der Schritt von Claude Code von der Grenze der Stufe), **≈ +0,07 $** (diese Stufe bisher, geschätzt — den genauen Betrag gibt es am Ende) und **Dateien** (was sich bisher geändert hat; ein Klick öffnet den Diff). #/coding zeigt dieselbe Zeile unter jeder laufenden Aufgabe.
- **Log** zeigt live, was Claude Code tut – ein Tool-Aufruf zeigt seinen Namen, ein Klick öffnet, womit er aufgerufen wurde, bei Edit / Write die Änderung als Code-Diff; die eigenen Zeilen des Workers erscheinen in deiner Sprache. Braucht Claude eine Entscheidung, zeigt die Aufgabe **Claude fragt** — deine **Antwort** startet die Stufe neu.
- **Benachrichtigungen**: in **Einstellungen → Coding-Worker** *Benachrichtigen, solange One im Hintergrund ist* einschalten — der Browser meldet sich, wenn eine Aufgabe wartet, fragt, fehlschlägt oder fertig ist, während der Tab im Hintergrund ist (auf diesem Gerät).
- **Stopp** beendet Claude Code sofort; **Erneut versuchen** oder **Jetzt ausführen** starten die Stufe wieder.
- **Git**: Aktualisieren, Committen, Pushen, PR öffnen, Von Basis aktualisieren, Ordner zeigen (der Pfad erscheint nur im Terminal des Workers). **Force-Push** und **Worktree verwerfen** fragen zweimal; **Aufräumen** wartet, bis der Branch gemergt ist. **Merge Request**: **Review posten** und **Mergen** (fragen vorher, mit deinem glab / gh) – siehe [KI-Review und Merge Requests](help:review-merge).
- **Pipeline** (auf #/coding) ändert die Stufen: Namen, welche von selbst laufen, Modus, Züge, Modell und Anweisungen für Claude Code. Vorlagen: *Standard*, *Altsoftware modernisieren*, *Code erklären* ([eine Seite je Komponente](help:explain-code)), *Review & Merge*. Eine Stufe **Statische Analyse** führt Linter / Compiler des Repositorys aus (auf der Einrichtungsseite des Workers festgelegt) und schreibt die Befunde in die Seite.
- **Projekte**: mehrere Coding-Datenbanken nebeneinander – über dem Board wählen, anlegen und löschen ([Projekte](help:pipelines)).

**Repos in iCloud Drive** (z. B. in Dokumente, wenn „Schreibtisch & Dokumente“ synchronisiert wird): git wartet, sobald eine Datei nur in der Cloud liegt — Schritte können dann Minuten dauern, das Log sagt es. Schneller: den Ordner dauerhaft geladen halten, oder es auf der Setup-Seite des Workers mit **Von GitLab / GitHub klonen …** neu klonen (nach `~/one-repos`, nicht synchronisiert) und diesen Klon anhaken. Der Worker startet in jedem Fall sofort und nennt im Log ein Repository, dessen git langsam ist. Die Arbeitskopien des Workers landen nie in iCloud.

## Sicherheit
Der Worker fasst nur die Repos an, die du angehakt hast; One kann ihm Aufgabentext und feste Git-Aktionen schicken — nie einen Befehl, und selbst nie ein Repo anhaken. Ein heruntergeladener Worker nimmt nur diesen Browser und diesen Arbeitsbereich an. Claude Code behält seine Berechtigungsregeln, und Aufgabentext geht als Daten mit, nicht als Anweisung. Eine Kostengrenze pro Aufgabe stellst du auf der Seite des Workers ein, eine pro Tag in der `worker.json`. In einem Team-Arbeitsbereich nimmt dein Worker nur Aufgaben, die du auf diesem Gerät geschrieben oder bestätigt hast (**Auf diesem Gerät bestätigen**) — eine Stufe (auch ihr Modell), ein Repo oder ein Branch, auf einem anderen Gerät geändert, fragt erneut. Eine Aufgabe, die einer deiner eigenen Agenten geschrieben hat, wartet auf dieselbe Bestätigung, auch in deinem lokalen Arbeitsbereich.

> Tipp: Die vollständige Referenz — Konfiguration, Protokoll, Fehlersuche — steht in `docs/CODING.md` im Repository.
