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

## Jev als Vorprüfer
Eine [Vorprüfung](help:ai-jev) ist eine OpenRouter-Anfrage wie jede andere: Die Spalte OpenRouter bestimmt, was Jev lesen darf. Er liest Anweisung, Änderung und Zeile des Agenten — nie IDs, E-Mail-Adressen oder Schlüssel; Namen nur, wenn Namen zu OpenRouter dürfen (sonst „@Person 1“); eine Seite, die OpenRouter nicht sehen darf, steht als „[Seite]“. Eine Datenart, die die Regel verweigert, heißt **gar keine Anfrage**, und die Karte sagt welche („Jev darf … nicht sehen“) — mit **Zurückhalten** wird so ein Vorschlag zurückgehalten, mit der Schreibschranke wartet der Lauf.

## Grenzen
Eine **Monatsgrenze** je Anbieter kannst du in One festlegen. Der [Ausgaben-Regler](help:ai-costs) erklärt Warnungen und Bremse. Ein zusätzliches verbindliches Kontolimit setzt du beim Anbieter — in der Claude Console oder als Limit des Schlüssels bei OpenRouter (live in Einstellungen → KI).

## Im Team
Inhaber und Admins legen die Spalten des Arbeitsbereichs fest; Mitglieder sehen sie nur lesend und können auf ihrem Gerät nur strenger sein (eine Art für sich abschalten). Deine eigenen Daten bleiben so oder so deine.

## Datenwege: erst Hinweise, Grenzen bei Bedarf
Unter **Einstellungen → KI → Datenwege** bleiben ohne neue Vorgabe die bisherigen Freigaben bestehen. Der kleine **Datenwege**-Schalter an der Modellwahl und an Coding-Aufgaben zeigt, wo die Inferenz stattfindet: lokaler Worker, freigegebener Modellhost oder Cloud-Anbieter. Ein geteilter lokaler Host nutzt den ONE-Teamserver als verschlüsselten Übertragungsweg; „lokal“ bedeutet nicht, dass alle Workspace-Inhalte nur auf dem Laptop liegen.

ONE sucht auf diesem Gerät nach wenigen deutlichen Merkmalen, etwa einer Vertraulichkeitskennzeichnung, internen technischen Beschreibungen oder ausdrücklich bezeichneten Personaldaten. Es ist eine Vermutung, keine vollständige Erkennung. Dafür wird keine zusätzliche KI-Anfrage gesendet. Ein Hinweis sperrt nichts, erzeugt keine Rückfrage und legt keine Regel fest. Du kannst ihn für diesen Kontext ausblenden oder Hinweise auf diesem Gerät ausschalten. Es werden keine Textausschnitte oder erkannten Namen als Erkennungsprotokoll gespeichert.

Erst eine ausdrücklich gewählte Zielgrenze ist verbindlich: **Nur lokale Inferenz**, ausgewählte Anbieter oder keine Modellziele. Die Grenze erteilt keine neue Anbieterfreigabe. Für eine Seite, Coding-Aufgabe oder Datenbank kannst du den Bereich im Datenwege-Schalter wählen. Ihre Unterseiten erben die Grenze; mehrere Grenzen gelten gemeinsam. In Team-Workspaces ändern Inhaber/Admins diese Vorgaben. Ein nicht erreichbares lokales Modell erlaubt keinen Cloud-Ausweichlauf über die Grenze hinweg. Ältere Clients müssen für solche Regeln aktualisiert werden; ein Coding-Worker ohne Unterstützung erhält keinen begrenzten Auftrag. Geänderte Grenzen stoppen weitere Modellrunden und fordern den verbundenen Coding-Worker zum Stoppen auf; bereits übertragene Daten lassen sich nicht zurückholen.

**MCP bleibt ein eigener Datenweg.** Optional kannst du im Workspace genaue MCP-Ursprünge freigeben, etwa `https://aj-atlas.com`. Bei aktiver leerer Liste ist keine externe MCP-Verbindung erlaubt. Die Regel schützt die von ONE verwalteten Modell- und MCP-Wege, ersetzt jedoch keine Betriebssystem-Firewall: Shell, Git, Programme, bestehende Cloud-Synchronisierung und interne Weiterleitungen eines Anbieters sind keine vollständig überwachten Datenkanäle. Kopierter Text verliert seinen Herkunftsbezug; die Heuristik ist kein DLP-System. Bei nativen CLI-Agenten können zusätzliche lokale Einstellungen oder Werkzeuge relevant sein. Unter einer MCP-Grenze werden nicht kontrollierbare native MCP-Konfigurationen abgewiesen; nutze ausdrücklich ausgewählte persönliche Verbindungen.

Der ältere lokale MCP-Assistent in den KI-Einstellungen kann diese ausdrücklichen Grenzen nicht nachweisen. Unter einer Zielgrenze nutzt du deshalb den aktuellen Coding-Worker. Ohne neue Grenze bleibt die bisherige Einrichtung nutzbar.
