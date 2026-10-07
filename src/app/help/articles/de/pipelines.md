---
id: pipelines
title: Business-Analyse- und QA-Pipelines
section: ai
order: 11
keywords: copy for ai, ai context, clipboard, Für KI-Kontext kopieren, business analysis, ba, spec, specification, sdd, software design document, requirements, analysis, qa, quality assurance, test cases, test design, then, follow-up, chain, pipeline, document stage, import stage, zip, clone, reference, mention, knowledge base, atlas, mcp, Business-Analyse, Spezifikation, Anforderungen, Testfälle, Danach, Folgeaufgabe
related: coding-pipeline, legacy-modernisation, mcp-servers
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
Business-Analyse- und QA-Stufen sind **Dokument**-Stufen: Claude Code liest nur – das Repository, falls die Aufgabe eins hat, die Aufgabe, die erwähnten Seiten, deine Wissensbasis-Tools – und seine letzte Nachricht wird ein Abschnitt der Aufgabenseite mit dem Namen der Stufe. Edit, Write und Bash sind abgeschaltet. Im **Pipeline**-Editor hat eine Dokument-Stufe ein **Ergebnis**: *Dokument in der Seite* oder *Dokument + Testfälle (Datenbank)*.

Für Aufgaben ohne Repository nimmt der Worker einen eigenen Arbeitsordner. Deine Wissensbasis dafür: auf der Setup-Seite des Workers **Aufgaben ohne Repository – eigene MCP-Server** (Namen wie in `claude mcp list`).

## Verkettet – oder für sich
**Danach** (in Neue Aufgabe und im Aufgaben-Panel) legt fest, was passiert, wenn eine Aufgabe fertig ist: Business-Analyse → **Coding** und/oder **QA**, QA → **Coding**. One legt die Folgeaufgabe in dieser Pipeline mit der ganzen Seite an (und einer Erwähnung, woher sie kommt); die fertige Aufgabe verlinkt darauf. Nichts angehakt: nichts folgt. Eine fertige Aufgabe lässt sich auch später übergeben (**An … übergeben**).

## Seiten, die mitgehen
Erwähne in einer Aufgabe eine Seite mit **@** oder füge ihren One-Link ein (auch in deine **Antwort** auf eine Rückfrage) – ihr Text geht mit der Aufgabe an Claude Code, nur zum Lesen: bis zu 8 Seiten, eine Datenbankzeile mit ihren Feldern, eine Datenbank mit den Titeln ihrer Einträge. Das Aufgaben-Panel zeigt sie unter **Geht mit**. Im Team wartet eine erwähnte Seite, die sich geändert hat, auf **Auf diesem Gerät bestätigen** – wie eine geänderte Aufgabe.

Für jede andere KI: **Für KI-Kontext kopieren** (Seitenmenü ⋯, Zeilenmenü der Seitenleiste, ⌘K) legt die Seite als Markdown in die Zwischenablage – Titel, Pfad, Link, Seiten-ID, die Felder einer Zeile, der Inhalt.

## Import-Stufe
Eine Pipeline kann mit dem Code beginnen: **Import** (die Vorlage *Altsoftware modernisieren* beginnt damit, ebenso *Für Altsoftware anlegen* auf einer leeren #/coding-Seite). Eine Aufgabe dort zeigt in ihrem Panel ein Feld: **ZIP** ablegen, eine **GitLab-/GitHub-Adresse** einfügen oder ein Repo des Workers nehmen. Der Worker legt ein neues Repository in `~/one-repos` an, die Aufgabe übernimmt es als **Repo** und geht weiter – siehe [Altsoftware modernisieren](help:legacy-modernisation).

> Tipp: Rückfragen gehen in jeder Stufe – Claude Code fragt im Aufgaben-Panel (**Claude fragt**), statt zu raten, auch beim Planen.
