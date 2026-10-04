---
id: forms
title: Formulare
section: databases
order: 7
keywords: formular, umfrage, fragebogen, fragen, antworten, formular teilen, öffentlicher link, webhook, logik, form, survey
related: views, automations, share-links
summary: Ein Formular fragt die Eigenschaften einer Datenbank ab — jede Antwort wird ein Eintrag.
---
## Formular anlegen
- **In einer Seite:** tippe `/formular` (englisch `/form`). One fügt eine Datenbank mit Formularansicht und drei Startfragen ein — Name, E-Mail, Nachricht.
- **Für eine bestehende Datenbank:** **+** neben ihren Ansichten → **Formular**.

Das Formular hat zwei Modi: **Bauen** und **Ausfüllen**. Beim **Bauen** ist jede Frage eine Eigenschaft: mit **Frage hinzufügen** ergänzen (oder eine neue Eigenschaft benennen), als **Pflicht** markieren, Hilfetext und Platzhalter setzen, wählen, wie Optionen **Zeigen als**. **Nur zeigen, wenn** fügt Logik hinzu — eine Frage erscheint nur, wenn frühere Antworten passen. **Nach dem Absenden** legt Abschluss-Überschrift, Nachricht und eine optionale Weiterleitung fest.

In deinem Workspace wird jede Antwort ein neuer Eintrag; **Antworten** listet sie.

## Formular teilen
**Formular teilen** erzeugt einen Link, den jede:r öffnen kann — ohne Konto, ohne Server. Der Link trägt nur die Fragen: keine Einträge, keine Personen, keine IDs. Antworten über den Link schickt der Browser der antwortenden Person als JSON an **deinen Webhook** (n8n, Make, Zapier …) — deshalb ist eine Webhook-URL nötig. **Was dein Webhook empfängt** zeigt die genaue Payload.

> Personen- und Relationsfragen werden über einen geteilten Link als Freitext gestellt; Dateien höchstens 1,5 MB pro Datei, 5 MB insgesamt.
