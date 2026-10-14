---
id: 2026-10-14-worker-windows
date: 2026-10-14
order: 1
title: Coding-Worker 1.9.0 – direkt unter Windows
summary: Der Coding-Worker läuft direkt unter Windows 10 und 11 – starte ihn aus PowerShell oder der Eingabeaufforderung. Unter Windows Version 1.9.0 oder neuer nehmen.
image: assets/shots/changelog/worker-windows.webp
alt: Einstellungen → Coding-Worker, Schritt 2 „Starte ihn“ mit dem Schalter Dein Rechner auf Windows – eine Zeile für PowerShell und eine für die Eingabeaufforderung, jede mit ihrer Kopiertaste, und der Hinweis zu Git for Windows und Windows Terminal.
help: coding-pipeline
try: settings-coding
---
**Unter Windows starten.** **Einstellungen → Coding-Worker** zeigt die Startzeile für deinen Rechner – Schalter **Windows | macOS · Linux**. Unter Windows bekommst du eine Zeile für PowerShell und eine für die Eingabeaufforderung, der Pfad in Anführungszeichen, damit auch ein Benutzerordner mit Leerzeichen klappt. Du brauchst Node.js 22 oder neuer, **Git for Windows** (Claude Code braucht dessen Git Bash) und Claude Code – mit dem eigenen Installer oder über npm –, einmal angemeldet. `node one-worker.mjs check` sagt, was der Worker gefunden hat.

**Unter Windows 1.9.0 oder neuer nehmen.** Windows sucht ein Programm zuerst in dem Ordner, in dem es gestartet wird, und erst dann im `PATH` – und der Worker führt git und Claude Code in deinen Repositories aus. Ein älterer Worker konnte so ein Programm namens `git.exe`, `claude.exe` oder `npm.exe` starten, das ein geklontes oder importiertes Repository mitgebracht hat. 1.9.0 sucht nur im `PATH`, nie im Repository, und nichts, was One schickt, läuft je über `cmd.exe`. Läuft bei dir unter Windows ein älterer Worker? **Erneut herunterladen** und die neue Datei starten. Unter macOS und Linux ändert sich nichts.

**Die Eigenheiten von Windows sind abgedeckt.** Lange Pfade, Repositories in OneDrive (der Worker warnt und hält seine Worktrees von dort fern), SSH-Schlüssel und Anmeldungen, die auf eine Frage warten würden, die niemand sieht: Der Worker hält jetzt sofort an und sagt im Log in deiner Sprache, was zu tun ist. WSL2 geht auch. Mehr: [Coding-Pipeline](help:coding-pipeline).
