---
id: 2026-10-07-legacy-modernise
date: 2026-10-07
order: 4
title: Altsoftware modernisieren — von einer ZIP oder GitLab zum Neubau
summary: Der Coding-Worker klont von GitLab oder GitHub und importiert eine ZIP mit altem Code als neues Repository; die Pipeline-Vorlage „Altsoftware modernisieren“ analysiert, entwirft und hält das heutige Verhalten mit Tests fest, bevor neu gebaut wird.
image: assets/shots/changelog/legacy-modernise.webp
alt: Der Pipeline-Editor mit der Vorlage Altsoftware modernisieren — Analysis, Design, Test design, Approve concept, Write tests, Tests on the old code, Rebuild, Test, Review, Ship
help: legacy-modernisation, coding-pipeline
try: coding
---
**Neuer Code für den Worker.** Seine Setup-Seite (**Einstellungen → Coding-Worker → Repositories ändern**) hat jetzt **Von GitLab / GitHub klonen …** – Klon-Adresse einfügen oder eines deiner Projekte wählen, wenn `glab` oder `gh` angemeldet ist – und **ZIP importieren …**, das aus einer ZIP mit Quellcode ein neues Repository mit einem Commit macht – und mit angemeldetem `glab` oder `gh` gleich danach das Projekt auf GitLab oder GitHub anlegt (Name aus dem Code oder der ZIP vorgeschlagen) und pusht. Beides landet in `~/one-repos`, einem Ordner, der nicht synchronisiert wird. Die eigenen `.git`-Ordner einer ZIP bleiben draußen, und eine ZIP mit einem Pfad außerhalb ihres Ordners wird abgelehnt.

**Die Vorlage.** **#/coding → Pipeline → Altsoftware modernisieren**: **Analyse**, **Design** und **Testentwurf** schreiben je einen eigenen Abschnitt in die Seite der Aufgabe – Architektur mit Diagramm, Risiken, das Verhalten, das bleiben muss, das Zieldesign, eine Tabelle mit Testfällen. Nach deiner Freigabe des Konzepts schreibt Claude Code Tests gegen den alten Code, baut dann neu, und dieselben Tests müssen am neuen Code bestehen.

**Deine Wissensbasis.** Pro Repository kann die Setup-Seite Claude Code deine eigenen MCP-Server geben – z. B. `atlas` –, um zu lesen und festzuhalten, was über den Code bekannt ist. Bei GitLab öffnet Ausliefern einen Merge Request mit `glab`. Die Anleitung: [Altsoftware modernisieren](help:legacy-modernisation).
