---
id: sync
title: Ordner- & GitHub-Sync
section: sync
order: 1
keywords: sync, synchronisieren, ordner, github, markdown, git, repository, backup, dateien, obsidian, token, folder
related: export, offline-app, privacy, coding-pipeline, workorders
summary: Halte eine lebende, lesbare Kopie des Workspace als Markdown-Dateien — in einem Ordner und in einem GitHub-Repository.
---
**Einstellungen → Sync.** Eine Datei pro Seite, Front Matter oben, Anhänge daneben. Diese Einstellungen gelten nur für dieses Gerät.

## Ein Ordner auf diesem Computer
1. **Ordner wählen…** und Zugriff erlauben. Jede Änderung landet dort nach wenigen Sekunden.
2. Bearbeite die Dateien mit einem beliebigen Editor; **Änderungen holen** (oder die Rückkehr zu One) liest deine Änderungen ein.
3. Nach einem Neuladen fragt der Browser noch einmal: **Zugriff erlauben**.

Geht in Chrome und Edge. Andere Browser können nicht in einen Ordner schreiben — nimm dort **Als Markdown exportieren**.

## Ein GitHub-Repository
1. **Repository** — `besitzer/repo`, eins, das dir gehört (privat geht). **Branch** (wird beim ersten Push angelegt) und ein optionaler **Ordner im Repository**.
2. **Zugriffstoken** — ein *Fine-grained Personal Access Token* mit **Contents: Read and write** für genau dieses Repository (**Auf GitHub erstellen**). Es liegt verschlüsselt nur in diesem Browser.
3. **Verbindung testen**, dann **Jetzt pushen**. **Automatisch pushen** committet in einem Intervall, solange One offen ist. **Pull** holt Änderungen, die auf GitHub gemacht wurden.
4. **Meine privaten Seiten mitnehmen** ist standardmäßig aus: Die Mitwirkenden des Repositorys könnten sie lesen.

## Konflikte und Löschungen
Auf beiden Seiten geändert? Ones Fassung bleibt; die andere wird als „(conflict …)“-Kopie behalten. Außerhalb von One gelöschte Dateien löschen nie von sich aus Seiten — One fragt: **Seiten in den Papierkorb** oder **Dateien neu schreiben**.

**Pipeline-Aufgaben** kommen dort nur lesend zurück, wo es zählt: eine außerhalb von One bearbeitete Aufgaben-Datei verschiebt ihre Aufgabe nicht — Stufe, Repo, Branch und die übrigen Pipeline-Felder bleiben, wie One sie hat, ebenso der Status eines [Prüfauftrags](help:workorders), und die Datei wird neu geschrieben. Eine Aufgabe, deren Text aus der Datei kam, wartet auf **Auf diesem Gerät bestätigen**, bevor der [Coding-Worker](help:coding-pipeline) sie nimmt.

> Die Statusleiste zeigt den Sync-Zustand. Datums- und Personen-Erwähnungen werden so geschrieben, dass One sie genau zurückliest.
