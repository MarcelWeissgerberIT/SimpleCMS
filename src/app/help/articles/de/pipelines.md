---
id: pipelines
title: Business-Analyse- und QA-Pipelines
section: ai
order: 11
keywords: projekt, projekte, neues projekt, projekt löschen, stories, user stories, epic, copy for ai, ai context, clipboard, Für KI-Kontext kopieren, business analysis, ba, spec, specification, sdd, software design document, requirements, analysis, qa, quality assurance, test cases, test design, then, follow-up, chain, pipeline, document stage, import stage, zip, clone, reference, mention, knowledge base, atlas, mcp, Business-Analyse, Spezifikation, Anforderungen, Testfälle, Danach, Folgeaufgabe
related: coding-pipeline, legacy-modernisation, explain-code, review-merge, mcp-servers
summary: Neben Coding: eine Business-Analyse-Pipeline, die Analysen und Spezifikationen schreibt, und eine QA-Pipeline, die Testfälle entwirft – jede für sich oder verkettet.
---
**#/coding** hat drei Pipelines – oben umschalten: **Coding · Business-Analyse · QA**. Jede hat ihre eigene Datenbank, ihr Board und ihre Stufen, und jede funktioniert für sich: Eine reine Business-Analyse braucht kein Repository und keine Coding-Aufgabe. Sie laufen über denselben [Coding-Worker](help:coding-pipeline) mit Claude Code auf deinem Rechner.

## Business-Analyse
**#/coding/spec → Business-Analyse-Datenbank anlegen → Neue Aufgabe.** Das Repository ist optional – ohne arbeitet Claude Code mit der Aufgabenseite, den erwähnten Seiten und deiner Wissensbasis. Die Stufen:
1. **Analyse** – Kontext, Beteiligte, Anforderungen (FR / NFR, jede prüfbar), Geschäftsregeln, offene Fragen, Risiken.
2. **Spezifikation** – Umfang, User Stories mit Akzeptanzkriterien, Abläufe (Mermaid), Datenmodell, Schnittstellen, Nachverfolgbarkeit.
3. **Spezifikation freigeben** – beide Abschnitte in der Seite lesen; **Nacharbeit…** schickt eine Notiz zurück.
4. **Festhalten** – mit deinen Wissensbasis-MCP-Servern (z. B. `atlas`) hält Claude Code das freigegebene Ergebnis dort fest und schreibt eine kurze Zusammenfassung.

## QA
**#/coding/qa.** Die Stufe **Testfälle** schreibt Teststrategie und Abdeckung – und ihre Testfälle werden Zeilen der Datenbank **Testfälle** (ID, Status *Nicht ausgeführt*, Priorität, Testart, Bereich, Vorbedingungen, Schritte, erwartetes Ergebnis), jede mit ihrer Aufgabe verknüpft. Danach **Testfälle freigeben** und **Festhalten**.

## Dokument-Stufen
Business-Analyse- und QA-Stufen sind **Dokument**-Stufen: Claude Code liest nur – das Repository, falls die Aufgabe eins hat, die Aufgabe, die erwähnten Seiten, deine Wissensbasis-Tools – und seine letzte Nachricht wird ein Abschnitt der Aufgabenseite mit dem Namen der Stufe. Edit, Write und Bash sind abgeschaltet. Im **Pipeline**-Editor hat eine Dokument-Stufe ein **Ergebnis**: *Dokument in der Seite*, *Dokument + Testfälle (Datenbank)*, *Seitenbaum* (jeder `##`-Abschnitt wird eine Seite unter einer Doku-Seite – siehe [Altsoftware erklären](help:explain-code)), *Review* (wird am Merge Request gepostet – siehe [KI-Review und Merge Requests](help:review-merge)) oder *Stories* (ein neues Coding-Projekt, unten).

Für Aufgaben ohne Repository nimmt der Worker einen eigenen Arbeitsordner. Deine Wissensbasis dafür: auf der Setup-Seite des Workers **Aufgaben ohne Repository – eigene MCP-Server** (Namen wie in `claude mcp list`).

## Verkettet – oder für sich
**Danach** (in Neue Aufgabe und im Aufgaben-Panel) legt fest, was passiert, wenn eine Aufgabe fertig ist: Business-Analyse → **Coding** und/oder **QA**, QA → **Coding**. One legt die Folgeaufgabe in dieser Pipeline mit der ganzen Seite an (und einer Erwähnung, woher sie kommt); die fertige Aufgabe verlinkt darauf. Nichts angehakt: nichts folgt. Eine fertige Aufgabe lässt sich auch später übergeben (**An … übergeben**).

## Seiten, die mitgehen
Erwähne in einer Aufgabe eine Seite mit **@** oder füge ihren One-Link ein (auch in deine **Antwort** auf eine Rückfrage) – ihr Text geht mit der Aufgabe an Claude Code, nur zum Lesen: bis zu 8 Seiten, eine Datenbankzeile mit ihren Feldern, eine Datenbank mit den Titeln ihrer Einträge. Das Aufgaben-Panel zeigt sie unter **Geht mit**. Im Team wartet eine erwähnte Seite, die sich geändert hat, auf **Auf diesem Gerät bestätigen** – wie eine geänderte Aufgabe.

Für jede andere KI: **Für KI-Kontext kopieren** (Seitenmenü ⋯, Zeilenmenü der Seitenleiste, ⌘K) legt die Seite als Markdown in die Zwischenablage – Titel, Pfad, Link, Seiten-ID, die Felder einer Zeile, der Inhalt.

## Projekte
Jede Pipeline kann mehrere **Projekte** haben – jedes eine eigene Datenbank mit eigenen Aufgaben und eigener Pipeline, z. B. eins je Epic oder Kunde. Über dem Board: die Auswahl **Projekt** (was #/coding auf diesem Gerät zeigt), **Neues Projekt** (eine Kopie der Pipeline dieses Projekts oder eine Vorlage) und **Projekt löschen**: Die Datenbank und alle ihre Aufgaben kommen in einem Rutsch in den Papierkorb – **Rückgängig** oder der Papierkorb holen sie zurück; Branches auf dem Worker bleiben. Der Worker nimmt Aufgaben aus jedem Projekt.

## Stories
Die Business-Analyse-Vorlage **Spezifikation → Stories** endet mit einer Stufe **Stories**: Claude Code teilt die freigegebene Spezifikation in User Stories, und One macht daraus ein **neues Coding-Projekt** – *<Epic> – Stories*, eine Aufgabe je Story mit Akzeptanzkriterien und Priorität, im Backlog, jede mit der Spezifikation verknüpft. Starte die, die du willst; Epic erledigt? **Projekt löschen**.

## Import-Stufe
Eine Pipeline kann mit dem Code beginnen: **Import** (die Vorlage *Altsoftware modernisieren* beginnt damit, ebenso *Für Altsoftware anlegen* auf einer leeren #/coding-Seite). Eine Aufgabe dort zeigt in ihrem Panel ein Feld: **ZIP** ablegen, eine **GitLab-/GitHub-Adresse** einfügen oder ein Repo des Workers nehmen. Der Worker legt ein neues Repository in `~/one-repos` an, die Aufgabe übernimmt es als **Repo** und geht weiter – siehe [Altsoftware modernisieren](help:legacy-modernisation).

## Aus dem KI-Terminal
Claude im [KI-Terminal](help:agent) kann auch Business-Analyse- und QA-Aufgaben anlegen (mit *Danach*), die Frage einer Aufgabe mit deinen Worten beantworten, ein Dokument mit Anweisungen zurückschicken oder eine fertige Aufgabe übergeben — jede Änderung ein Vorschlag, den du übernimmst. `/pipelines spec` oder `/pipelines qa` listet, was dort offen ist.

> Tipp: Rückfragen gehen in jeder Stufe – Claude Code fragt im Aufgaben-Panel (**Claude fragt**), statt zu raten, auch beim Planen.
