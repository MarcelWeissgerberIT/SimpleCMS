---
id: ai-data-rules
title: Datenregeln — was an welche KI darf
section: ai
order: 1
keywords: datenregeln, daten, regeln, datenschutz, voreinstellung, alles, arbeitsdaten, nur markiertes, auswahl, seitentext, zeilen, dateien, personen, namen, mitschriften, private seiten, mails, gedächtnis, mcp, betreiber, datensammlung, zdr, sperrliste, grenze, ausgabenlimit, team, admin, data rules, presets, operators, limit
related: ai-providers, privacy, ai-costs, memory
summary: Je Anbieter, welche Arten von Daten eine Anfrage mitnehmen darf — festgelegt in Schritt 04 des Assistenten, geprüft vor jeder Anfrage.
---
Jede KI-Anfrage nimmt bestimmte Arten von Daten mit — den markierten Text, eine Seite, Zeilen, ein Bild, Namen von Personen. **Datenregeln** legen je Anbieter fest, welche davon dorthin dürfen. One prüft sie, bevor etwas gesendet wird: Eine Anfrage, die eine gesperrte Art mitnähme, stoppt mit **Regel ändern** — und nichts geht hinaus.

## Die Tabelle
Schritt 04 von **KI einrichten** zeigt eine Zeile je Art von Daten und eine Spalte je Anbieter (**Einstellungen → KI → Daten** zeigt eine Zeile je Anbieter; ihre Taste **Ändern** öffnet Schritt 04):
**Hilfe & Anweisungen**, **Namen von Datenbanken & Feldern**, **Markierter Text**, **Seitentext**, **Datenbankzeilen**, **Bilder & Dateien**, **Viele Seiten**, **Namen von Personen** (sonst steht „@Person 1“) und **Besprechungs-Mitschriften**.

- **Claude** behält, was es hatte: alles, solange du seine Spalte nicht änderst.
- **Ein neuer Anbieter startet mit nichts.** Wähle eine Voreinstellung — **Alles**, **Arbeitsdaten** (keine Namen, keine Mitschriften) oder **Nur Markiertes** (Hilfe, Feldnamen, die Auswahl) — oder schalte einzelne Arten.
- Die Zeile unter der Tabelle sagt es in Worten, zum Beispiel *Private Seiten: nur an Claude. Mails: nur an Claude.*

## Deine eigenen Daten
Private Seiten (im Team), die Mails-Datenbanken, das One-Gedächtnis und MCP-Ergebnisse gehören dir: Sie gehen nur an einen Anbieter, wenn **du** sie einschaltest — auf diesem Gerät, je Anbieter. Eine Regel des Arbeitsbereichs kann sie fernhalten, aber nie für dich einschalten.

## Betreiber (OpenRouter)
OpenRouter gibt eine Anfrage an den Betreiber des Modells. One nennt die Betreiber, die deine Regeln erlauben, schaltet die Ausweichmodelle von OpenRouter ab und verlangt — solange du es nicht abschaltest — **Betreiber ohne Datensammlung**. **Nur ohne Datenspeicherung (ZDR)** grenzt weiter ein; eine **Sperrliste** nennt Betreiber, die nie eine Anfrage bekommen. Das gilt auch für den [Jev Router](help:ai-providers): Er leitet nur an Modelle deiner Liste weiter, und Jev (TypeSafe) liest die Anfrage, um zu wählen.

## Grenzen
Eine **Monatsgrenze** je Anbieter kannst du in One festlegen (Schritt 04). In dieser Version wird sie nur mit den Regeln gespeichert — One warnt und stoppt daran noch nicht; Warnungen und die Bremse kommen mit dem Ausgaben-Regler in einem späteren Update. Das verbindliche Limit liegt beim Anbieter — in der Claude Console oder als Limit des Schlüssels bei OpenRouter (live in Einstellungen → KI).

## Im Team
Inhaber und Admins legen die Spalten des Arbeitsbereichs fest; Mitglieder sehen sie nur lesend und können auf ihrem Gerät nur strenger sein (eine Art für sich abschalten). Deine eigenen Daten bleiben so oder so deine.
