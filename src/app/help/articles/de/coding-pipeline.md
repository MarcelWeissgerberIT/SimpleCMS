---
id: coding-pipeline
title: Coding-Pipeline (Claude Code auf deinem Rechner)
section: ai
order: 9
keywords: coding, pipeline, claude code, worker, one-worker, git, branch, worktree, pull request, pr, diff, tests, repo, repository, code-review, programmieren, aufgaben
related: mcp-bridge, custom-agents, agent
summary: Gib Programmieraufgaben an Claude Code auf deinem Rechner — planen, freigeben, umsetzen, testen, ausliefern — und verfolge jeden Schritt in One.
---
**#/coding** (⌘K *Coding-Pipeline*). One verwaltet die Aufgaben, die Freigaben, das Log und den Diff; ein kleiner Worker auf **deinem** Rechner führt Git und Claude Code aus. Dein Code verlässt deinen Rechner nie.

## Einmal einrichten
1. Du brauchst Node.js 20+, Git und die **Claude-Code**-CLI, angemeldet (`claude`).
2. **Einstellungen → Coding-Worker → Einrichtung**: `one-worker.mjs` speichern, dann den dort gezeigten Init-Befehl ausführen — er bindet den Worker an diesen Arbeitsbereich:
```
node ~/one-worker.mjs init --workspace local:…
```
3. Trag deine Repositories in `~/.config/one/worker.json` ein: Name, Pfad, Basis-Branch und — für die Test-Stufe — einen Testbefehl als Liste, z. B. `["npm", "test"]`. Dann `node ~/one-worker.mjs check` und `node ~/one-worker.mjs` laufen lassen.
4. **Mit einem Coding-Worker auf diesem Rechner verbinden** einschalten. Die **WORKER**-LED in der Statusleiste wird grün.

## Eine Aufgabe von Anfang bis Ende
1. **Neue Aufgabe**: Titel, Repo, Ziel, Abnahmekriterien. *Der Worker darf gleich anfangen* angehakt lassen.
2. **Plan** — Claude Code liest den Code im Plan-Modus (ändert nichts) und schreibt den Plan in die Aufgabe. Die Aufgabe wartet bei **Plan freigeben**.
3. **Freigeben** — oder **Nacharbeit…** mit Anweisungen: Sie geht mit deiner Notiz zurück zum Plan.
4. **Umsetzen** — Claude Code ändert den Code in einem eigenen Git-Worktree; **Testen** führt deinen Testbefehl aus. Schlagen die Tests fehl, bekommt „Umsetzen“ mit deren Ausgabe noch einen Versuch.
5. **Review** — die Tabs **Diff** und **Tests** zeigen, was sich geändert hat. Freigeben oder zurückschicken.
6. **Ausliefern** — committen, pushen, Pull Request (mit der GitHub-CLI) oder ein Vergleichslink. **Fertig**.

Jede Aufgabe arbeitet auf einem eigenen Branch (`one/<titel>-<id>`) in einem eigenen Worktree — dein Haupt-Checkout bleibt, wie er ist. Um auf einem vorhandenen Branch weiterzuarbeiten, trag seinen Namen ins Feld **Branch** der Aufgabe ein.

## Während sie läuft
- **Log** zeigt live, was Claude Code tut. Braucht Claude eine Entscheidung, zeigt die Aufgabe **Claude fragt** — deine **Antwort** startet die Stufe neu.
- **Stopp** beendet Claude Code sofort; **Erneut versuchen** oder **Jetzt ausführen** starten die Stufe wieder.
- **Git**: Aktualisieren, Committen, Pushen, PR öffnen, Von Basis aktualisieren, Ordner zeigen (der Pfad erscheint nur im Terminal des Workers). **Force-Push** und **Worktree verwerfen** fragen zweimal; **Aufräumen** wartet, bis der Branch gemergt ist.
- **Pipeline** (auf #/coding) ändert die Stufen: Namen, welche von selbst laufen, Modus, Züge und Anweisungen für Claude Code.

## Sicherheit
Der Worker fasst nur die Repos aus seiner eigenen Konfiguration an; One kann ihm Aufgabentext und feste Git-Aktionen schicken — nie einen Befehl. Claude Code behält seine Berechtigungsregeln, und Aufgabentext geht als Daten mit, nicht als Anweisung. Kostengrenzen pro Aufgabe und pro Tag stehen in der `worker.json`. In einem Team-Arbeitsbereich nimmt dein Worker nur Aufgaben, die du auf diesem Gerät geschrieben oder bestätigt hast (**Auf diesem Gerät bestätigen**) — eine Stufe, ein Repo oder ein Branch, auf einem anderen Gerät geändert, fragt erneut. Eine Aufgabe, die einer deiner eigenen Agenten geschrieben hat, wartet auf dieselbe Bestätigung, auch in deinem lokalen Arbeitsbereich.

> Tipp: Die vollständige Referenz — Konfiguration, Protokoll, Fehlersuche — steht in `docs/CODING.md` im Repository.
