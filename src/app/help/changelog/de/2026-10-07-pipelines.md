---
id: 2026-10-07-pipelines
date: 2026-10-07
order: 2
title: Business-Analyse und QA neben Coding – und die Import-Stufe
summary: Zwei weitere Pipelines auf dem Coding-Worker – Business-Analyse schreibt Analysen und Spezifikationen (ohne Repository), QA entwirft Testfälle in eine Datenbank – jede für sich oder verkettet; Altsoftware kommt direkt in der Aufgabe an.
image: assets/shots/changelog/pipelines.webp
alt: Eine Business-Analyse-Aufgabe wartet bei Spezifikation freigeben – die Stufen von Backlog bis Fertig, Freigeben und Nacharbeit, Danach mit Coding angehakt, die erwähnte Richtlinien-Seite unter Geht mit
help: pipelines, legacy-modernisation, coding-pipeline
try: coding
---
**Drei Pipelines.** **#/coding** schaltet zwischen **Coding**, **Business-Analyse** und **QA** um – jede mit eigener Datenbank und eigenen Stufen, jede für sich nutzbar. Die Business-Analyse schreibt eine **Analyse** und eine **Spezifikation** in die Aufgabenseite (ohne Repository), wartet auf deine Freigabe und hält das Ergebnis in deiner Wissensbasis fest. QA schreibt einen Testentwurf – und seine Testfälle werden Zeilen der Datenbank **Testfälle**.

**Verkettet, wenn du willst.** **Danach** übergibt eine fertige Aufgabe: Business-Analyse → Coding und/oder QA, QA → Coding. Die Folgeaufgabe bekommt die ganze Seite.

**Seiten gehen mit.** Erwähne in einer Aufgabe eine Seite mit **@** oder füge ihren One-Link ein (auch in eine Antwort) – Claude Code bekommt ihren Text, nur zum Lesen. Das Panel zeigt sie unter **Geht mit**. Für jede andere KI legt **Für KI-Kontext kopieren** (Seitenmenü, ⌘K) eine Seite als Markdown in die Zwischenablage.

**Der Code kommt in der Aufgabe an.** *Altsoftware modernisieren* beginnt jetzt mit einer **Import**-Stufe: ZIP im Aufgaben-Panel ablegen oder eine GitLab-/GitHub-Adresse einfügen, und der Worker macht daraus das Repository der Aufgabe. Claude Code kann jetzt auch beim Planen nachfragen, und jedes Edit / Write im Log klappt als Code-Diff auf. Für all das braucht der Worker einen neuen Download. Mehr: [Business-Analyse- und QA-Pipelines](help:pipelines).
