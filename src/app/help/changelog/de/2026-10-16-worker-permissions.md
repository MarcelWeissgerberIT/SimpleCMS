---
id: 2026-10-16-worker-permissions
date: 2026-10-16
order: 3
title: Claude Code fragt dich – und hört auf, wenn es fertig ist
summary: Braucht Claude Code eine Erlaubnis, fragt dich die Coding-Aufgabe in One – einmal, immer für dieses Repo oder nein. Eine Stufe endet, sobald Claude Code endet, und eine, die ihr Schrittlimit erreicht hat, macht dort weiter.
image: assets/shots/changelog/worker-permissions.webp
alt: Zwei Coding-Aufgaben in One – links die Karte „Claude wants · Bash npm run lint“ mit Allow once, Always allow for this repo und Refuse; rechts „Step limit reached (3/3)“ mit Continue (+40 steps) und Start over.
help: coding-pipeline
try: coding
---
**Claude möchte …** Braucht Claude Code eine Erlaubnis, die die Regeln deines Repositorys nicht abdecken – einen Befehl, ein Tool, eine Datei außerhalb des Projekts –, zeigt die Aufgabe **WARTET AUF DICH · ERLAUBNIS** und eine Karte, die genau sagt, was. **Einmal erlauben**, **Für dieses Repo immer erlauben** (der Worker trägt genau diese eine enge Regel in seine eigene `worker.json` ein; seine Einrichtungsseite listet sie mit einer Taste zum Entfernen) oder **Ablehnen**. Die Lampe **Claude möchte** im Vorflug-Check leuchtet für jede Anfrage, und – wenn unter Einstellungen → Coding-Worker die Benachrichtigungen an sind – meldet sich der Browser, solange One im Hintergrund ist. Die Karte zeigt die Anfrage immer vollständig. Ohne Antwort lehnt der Worker nach 15 Minuten ab; ist kein One-Tab offen, sofort.

**Fertig heißt fertig.** Eine Stufe endet, wenn Claude Code endet – mit jedem Modell. Ein Dev-Server oder Watcher, den es laufen gelassen hat, wird beendet, und das Log nennt ihn; ein Server, den deine anderen Werkzeuge mitnutzen (ein Gradle-Daemon, eine ssh-Verbindung), läuft weiter – auch ihn nennt das Log. Jede Aufgabe bekommt einen Scratch-Ordner für ihre Zwischendateien.

**Schrittlimit erreicht?** **Weitermachen (+N Schritte)** setzt die Stufe dort fort, wo sie stand, im selben Worktree; **Neu starten** führt sie mit der ursprünglichen Anweisung noch einmal aus, im selben Worktree (für einen sauberen Neuanfang vorher **Worktree verwerfen**). Der Pipeline-Editor zeigt das **Schrittlimit** jeder Stufe.

Braucht Worker 1.11.0: **Erneut herunterladen** unter Einstellungen → Coding-Worker. Mehr: [Coding-Pipeline](help:coding-pipeline).
