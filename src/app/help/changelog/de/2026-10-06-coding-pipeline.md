---
id: 2026-10-06-coding-pipeline
date: 2026-10-06
order: 4
title: Coding-Pipeline — Claude Code auf deinem Rechner, gesteuert aus One
summary: Gib Programmieraufgaben an einen kleinen Worker auf deinem Rechner: Er plant, setzt um, testet und liefert sie mit Claude Code aus — pro Aufgabe in einem eigenen Git-Worktree. Du gibst an den Toren frei.
image: assets/shots/changelog/coding-pipeline.webp
alt: Eine Coding-Aufgabe in One wartet beim Review — die Stufen von Backlog bis Fertig, die Tasten Freigeben und Nacharbeit, und der Diff-Tab mit der Änderung an src/login.ts in Syntaxfarben
help: coding-pipeline, mcp-bridge
try: coding
---
**#/coding** macht One zur Schaltzentrale für Code-Arbeit. `one-worker` läuft auf deinem Rechner, holt Aufgaben aus One und erledigt sie mit **Claude Code** — jede Aufgabe auf einem eigenen Branch in einem eigenen Git-Worktree, dein Haupt-Checkout bleibt unberührt.

- **Die Pipeline**: Backlog → Bereit → **Plan** (Claude Code im Plan-Modus) → **Plan freigeben** → **Umsetzen** → **Testen** (dein Testbefehl; ein Fehlschlag geht einmal mit der Ausgabe zurück) → **Review** → **Ausliefern** (committen, pushen, Pull Request) → Fertig. Die Stufen änderst du unter **Pipeline**.
- **Das Aufgaben-Panel**: ein Live-Log, der Plan, der Diff pro Datei, die Testausgabe, der Git-Stand — und **Freigeben**, **Nacharbeit…**, **Antworten** (wenn Claude fragt), **Stopp**, **Erneut versuchen**. Force-Push und Verwerfen fragen zweimal.
- **Einrichten** unter **Einstellungen → Coding-Worker**: `one-worker.mjs` speichern, den dort gezeigten Init-Befehl ausführen, deine Repos in die `worker.json` eintragen, laufen lassen.

Pfade und Befehle bleiben auf deinem Rechner; One erfährt nur Repo-Namen, Branches, Diffs und Logs. Claude Code behält seine Berechtigungsregeln, Kostengrenzen pro Aufgabe und pro Tag stehen in deiner Konfiguration — siehe [die Anleitung](help:coding-pipeline).
