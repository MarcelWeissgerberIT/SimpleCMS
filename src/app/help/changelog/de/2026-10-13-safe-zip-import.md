---
id: 2026-10-13-safe-zip-import
date: 2026-10-13
order: 1
title: Coding-Worker 1.8.1 – sicherer ZIP-Import, eigene Einstellungen nur für deine eigenen Repos
summary: Lade den Worker neu herunter und starte ihn neu – ein ZIP-Import kann keinen Git-Ordner mehr mitbringen und nichts mehr ausführen, und Claude Code startet ohne die eigenen Einstellungen von Repos, die der Worker geklont oder importiert hat (ein Schalter pro Repo).
image: assets/shots/changelog/safe-zip-import.webp
alt: Die Setup-Seite des Workers – der Hinweis, dass diese Version legacy-shop als fremden Code markiert hat, mit Verstanden, die Tasten Von GitLab / GitHub klonen und ZIP importieren, und das Repo legacy-shop aus ~/one-repos mit dem MCP-Server kb, dem Hinweis, dass nur Server aus dem Bereich user es erreichen, und dem Schalter Eigene Claude-Code-Einstellungen dieses Repos nutzen auf aus, „vom Worker aus einer ZIP importiert“.
help: legacy-modernisation, coding-pipeline
try: settings-coding
---
**Neu herunterladen und neu starten.** **Einstellungen → Coding-Worker → Erneut herunterladen**, beende den laufenden Worker (<kbd>Ctrl+C</kbd>) und starte die neue Datei. **#/coding** nennt einen Worker, der älter als 1.8.1 ist, mit einer Taste zum Download.

**Eine ZIP bringt Code mit, sonst nichts.** Datenträger unter macOS und Windows ignorieren Groß- und Kleinschreibung – so konnte eine ZIP einen Ordner `.GIT` mitbringen, den git für den eigenen Ordner des Repositorys hielt, und dessen Einstellungen konnten beim Import ein Programm starten. Jetzt bleibt `.git` in jeder Schreibweise draußen, eine ZIP, die selbst ein Repository ist, wird abgelehnt, und der Import führt keine Hooks, Filter, gc oder fsmonitor aus. In einem importierten Repository bleiben deine eigenen Git-Treiber (Filter, Diff- und Merge-Treiber) aus.

**Eigene Einstellungen nur für deine eigenen Repos.** Claude Code lädt beim Start die eigenen Einstellungen eines Repositorys – `.claude/` mit seinen Hooks, `.mcp.json`, `CLAUDE.md` –, auch in einer Stufe, die nur liest. Bei einem Repository, das der Worker geklont oder importiert hat, startet es jetzt ohne sie. Die Setup-Seite des Workers (**Repositories ändern**) hat pro Repository den Schalter **Eigene Claude-Code-Einstellungen dieses Repos nutzen**, mit dem Grund, warum er aus ist; schalte ihn nur für Code ein, dem du vertraust. Deine eigenen Repositories bleiben, wie sie waren. MCP-Server für ein solches Repository fügst du mit `claude mcp add -s user …` hinzu. Was ein älterer Worker geklont oder importiert hat, wird einmal markiert – die Setup-Seite nennt es, bis du **Verstanden** drückst.

**Schon einmal eine ZIP von jemand anderem importiert?** Hat ein älterer Worker sie unter macOS oder Windows importiert, prüf dieses Repository: `git config --local --list` sollte kein `core.fsmonitor`, `core.hooksPath`, `filter.*` oder `gpg.program` zeigen, das du nicht selbst gesetzt hast, und in `.git/hooks` sollten nur `*.sample`-Dateien liegen – oder lösch es und importiere die ZIP neu. Mehr: [Altsoftware modernisieren](help:legacy-modernisation).
