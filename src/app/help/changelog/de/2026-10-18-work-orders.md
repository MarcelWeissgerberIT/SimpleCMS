---
id: 2026-10-18-work-orders
date: 2026-10-18
order: 1
title: Prüfaufträge: von der Bitte zur Kette
summary: Schreib auf, was geprüft werden soll — One plant daraus eine Kette von Pipeline-Aufgaben (Business-Analyse, Coding, QA), zeigt jeden Schritt vollständig und lässt sie nacheinander laufen, sobald du sie startest.
image: assets/shots/changelog/work-orders.webp
alt: Die Platte eines Prüfauftrags in Kette bereit — die Lampen Coding, Worker, Kontext (der eigene Server, nur lesend) und Planer, die Zusammenfassung des Planers, der Kontext des Servers als FREMD markiert mit seinem Abruf und drei Stationen (01 Analyse, 02 Coding, 03 QA), jede mit Projekt, Repo, wo sie anhält, und ihrem Ziel.
help: workorders, pipelines, coding-pipeline, patchbay
try: workorders
---
**Schreib auf, was geprüft werden soll** — in einer Zeile der neuen Datenbank **Prüfaufträge** oder auf jeder Seite mit **Prüfen lassen** (⋯, das Menü der Seitenleisten-Zeile, ⌘K). Ein Druck genügt: One liest den Auftrag, die Seiten, die er verlinkt, und — wenn du einen gewählt hast — deinen eigenen MCP-Server, nur mit seinen Lese-Werkzeugen. Daraus plant One eine **Kette**: Business-Analyse, dann Coding, dann QA.

**Jeder Schritt vollständig, dann ein ↵.** Die Platte zeigt jeden Schritt mit Ziel, Kriterien, Projekt, Repo, den Seiten, die mitgehen, und wo er für dich anhält; Inhalt von deinem Server ist als *FREMD* markiert. **↵ Kette starten** legt alle Aufgaben an; Schritt 01 startet nach 10 Sekunden (<kbd>Z</kbd> nimmt die ganze Kette zurück). Von da an gibt jeder Schritt sein Ergebnis als Grundlage an den nächsten und startet ihn — nach der Analyse zeigt One dir zuerst den Coding-Schritt.

**Nur du startest.** Planen, Starten und jede Taste, die dem Worker Arbeit gibt, sind deine eigenen Drücke — im Vorflug-Check VON HAND, nie in einer Sammel-Übernahme. <kbd>H</kbd> hält nach dem laufenden Schritt an, **↵ Fortsetzen** geht weiter, und ein **Budget je Kette** hält vor dem nächsten Schritt an. **Ohne Bestätigung starten** gibt es als Schalter pro Gerät, in lokalen Arbeitsbereichen, mit Budget. Das alles braucht Coding auf diesem Gerät und einen verbundenen Worker.

**Im Schaltplan** ist jede Datenbank Prüfaufträge ein Modul **Planer**. Weitergaben sind jetzt im Schaltplan sichtbar — neue Sicherungen möglich: Folgeaufgaben, Stories und die nächsten Schritte einer Kette sind als Kabel gezeichnet. Mehr unter [Prüfaufträge](help:workorders).
