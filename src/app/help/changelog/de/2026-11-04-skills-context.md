---
id: 2026-11-04-skills-context
date: 2026-11-04
order: 101
title: Skills auswählen und nach Kontextgrenzen weiterarbeiten
summary: Persönliche Skill-Anleitungen, SKILL.md und ein kompakter Wiedereinstieg mit erhaltenem Arbeitsnachweis.
---

Im Seitendialog und im KI-Terminal öffnet **Skills** eine persönliche Bibliothek für den aktuellen Workspace auf diesem Gerät. Erstelle eine Anleitung oder importiere eine `SKILL.md` mit `name`, `description` und Anleitungstext. Tags helfen beim Suchen. Änderungen werden als neue Version gespeichert; frühere Versionen bleiben auswählbar und als Markdown exportierbar.

**Zum Auftrag hinzufügen** ergänzt beispielsweise `$klartext@2`. Es startet keine Anfrage. Die ausgewählte Anleitung wird bei der nächsten Anfrage modellunabhängig eingebunden. Ohne Versionsnummer verwendet `$klartext` die neueste lokal gespeicherte Version. Der Laufnachweis hält Name, Version und Hash fest; ein daraus gespeichertes Kompilat bindet die verwendete Versionsnummer samt Inhalts-Hash. ONE-Exporte bewahren diese Bindung beim Import. Fehlt diese Version auf einem anderen Gerät, muss sie dort bereitgestellt werden; ONE ersetzt sie nicht stillschweigend.

Skills geben ein Vorgehen vor. Sie erteilen keine Werkzeug- oder Schreibrechte, zählen nicht als aktuelle Quellen und führen keine Skripte aus. Importierte Werkzeugdeklarationen und Dateiverweise werden nicht automatisch aktiviert oder geladen. Skill-Inhalte werden als persönlicher Kontext behandelt und nur an dafür freigegebene Modelle gesendet. Der Nachweis belegt die bereitgestellte Anleitung; das fachliche Ergebnis bleibt zu prüfen.

Nach einer Kontext- oder Ausgabelängengrenze bietet das Terminal **Mit kompaktem Kontext fortsetzen** direkt bei der Eingabe. Der neue Lauf übernimmt einen begrenzten Arbeitsnachweis, frühere Entscheidungen, Quellenverweise und vorhandene Vorschläge. Alte Quelleninhalte ersetzen keine frischen Abrufe. Diese Wiederaufnahme liest und analysiert; externe Änderungen benötigen einen eigenen ausdrücklichen Auftrag. Bereits angenommene oder unklare Schreibvorgänge werden nicht automatisch wiederholt.

Auch am Werkzeugaufruflimit steht **Fortsetzen** jetzt direkt bei der Eingabe. Budget- und Anbietergrenzen gelten weiterhin. ONE kann keinen unbegrenzt großen Einzelaufruf senden; eine bereits für sich zu große Eingabe muss gezielter aufgeteilt werden.

Bei Textanfragen im Seitendialog führt **Im Terminal mit kompaktem Kontext fortsetzen** aus einer Kontext- oder Antwortlängengrenze in eine neue, lesende Analyse. Der bisherige Lauf bleibt erhalten.
