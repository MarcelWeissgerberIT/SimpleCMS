---
id: 2026-10-08-terminal-pipelines
date: 2026-10-08
order: 3
title: Das KI-Terminal steuert deine Pipelines – und meldet dich bei MCP-Servern an
summary: In ⌘J listet Claude Aufgaben der Coding-Pipelines, legt sie an, gibt sie frei, schickt sie zurück, beantwortet Fragen, startet und stoppt sie – jede Änderung als Vorschlag, den du prüfst; /verbinden meldet dich in einem Browserfenster bei einem MCP-Server an.
image: assets/shots/changelog/terminal-pipelines.webp
alt: Das KI-Terminal – /pipelines listet eine Aufgabe, die bei Plan freigeben wartet, und eine im Backlog; darunter hat Claude eine neue Coding-Aufgabe vorgeschlagen, mit Repo, Branch, Start, Hält an bei, Git und der ganzen Aufgabenseite, wie Claude Code sie liest, markiert mit STARTET WORKER
help: agent, coding-pipeline, mcp-servers
try: terminal
---
**Pipelines per Tastatur.** Drück <kbd>Mod+J</kbd> und frag mit eigenen Worten – *„Was wartet auf mich?“*, *„Leg eine Aufgabe an: Rechnungen als CSV exportieren, und starte sie“*, *„Schick den Login-Plan zurück: Nimm den vorhandenen Session-Speicher“*. Claude liest die [Coding-Pipelines](help:coding-pipeline) – Coding, Business-Analyse, QA: was wartet, die Stufe einer Aufgabe, ihren Plan, das Testergebnis und das Protokoll. Es legt Aufgaben an und führt Aktionen an ihnen aus: freigeben, mit Anweisungen zurückschicken, eine Frage beantworten, einmal ausführen, stoppen, *Danach* setzen, übergeben.

**Nichts bewegt sich, bevor du übernimmst.** Jede Änderung landet in der Prüfliste. Eine neue Aufgabe zeigt sich vollständig – Projekt, Repo, Branch, wo sie startet und anhält, ihre ganze Seite, wie Claude Code sie liest. Was den Worker startet, trägt **STARTET WORKER** und ist nie Teil von *Alle übernehmen*: Übernimm jede einzeln (<kbd>Enter</kbd> darauf). Eine Aufgabe, die ein Agent geschrieben oder ein anderes Gerät geändert hat, wartet auf ihrer Seite auf **Auf diesem Gerät bestätigen** – das Terminal bestätigt nie für dich.

`/pipelines` listet die offenen Aufgaben – zuerst das, was auf dich wartet – mit **Öffnen** und, bei einer laufenden, **Stopp**.

`/verbinden` (`/connect`) listet deine [MCP-Server](help:mcp-servers) und wie sie stehen. `/verbinden atlas` – ein Name, ein Codewort oder eine Adresse – meldet dich an: Die Anmeldeseite des Servers öffnet sich direkt mit deinem <kbd>Enter</kbd> in einem Browserfenster (oder per Code, wenn die Rückkehr aus dem Fenster nicht klappt). `/verbinden https://…` fügt zuerst einen Server hinzu. Scheitert eine Aufgabe, weil ein Server sein Token abgelehnt hat, steht **Bei … anmelden** direkt darunter, danach **Aufgabe erneut ausführen**.
