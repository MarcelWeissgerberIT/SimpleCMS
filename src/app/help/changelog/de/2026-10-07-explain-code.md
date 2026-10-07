---
id: 2026-10-07-explain-code
date: 2026-10-07
order: 1
title: Altsoftware in One-Seiten erklärt, KI-Review und Merge, Projekte
summary: „Code erklären“ macht aus einer Codebasis One-Seiten – eine Seite je Komponente, mit statischer Analyse und Doku-Check; „Review & Merge“ lässt Claude den Merge Request prüfen und One ihn mergen; jede Pipeline kann mehrere Projekte haben.
image: assets/shots/changelog/explain-code.webp
alt: Die Doku-Seite „Billing service · Components“ in One – von der Pipeline geschrieben für die Aufgabe Billing service, die Einleitung, dann eine Seite je Komponente: Invoice engine, Tax rules, PDF export, Payment import
help: explain-code, review-merge, pipelines
try: coding
---
**Code erklären.** Eine neue Vorlage auf **#/coding**: Claude Code liest das Repository und schreibt einen **Überblick**, führt die **statische Analyse** aus, dokumentiert jede Komponente – und One macht aus jeder **eine eigene Seite** unter einer Doku-Seite. Ein **Doku-Check** vergleicht, was README und Doku sagen, mit dem Code. Im Repository ändert sich nichts – siehe [Altsoftware erklären](help:explain-code).

**Statische Analyse** ist in jeder Pipeline eine eigene Stufe: Linter oder Compiler des Repositorys (`npm run lint`, `dotnet build`, `go vet` …, auf der Einrichtungsseite des Workers erraten) – die Befunde landen in der Seite, und die nächsten Stufen lesen sie.

**Review & Merge.** Nach **Ausliefern** prüft Claude den Diff des Branches; du liest das Review am Tor – dann postet One es am Merge Request und mergt ihn mit deinem `glab` / `gh`. Von Hand: **Review posten** und **Mergen** im Git-Tab der Aufgabe – siehe [KI-Review und Merge Requests](help:review-merge). Gib Claude Code mit dem Playwright-MCP-Server einen Browser, dann prüft das Review auch die Ansichten.

**Projekte.** Mehrere Datenbanken je Pipeline – **Neues Projekt**, eins auswählen, **Projekt löschen** samt aller Aufgaben (Rückgängig holt es zurück). **Spezifikation → Stories** macht aus einer freigegebenen Spezifikation ein neues Coding-Projekt mit einer Aufgabe je Story.
