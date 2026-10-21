---
id: team-cloud
title: Team-Workspaces
section: team
order: 1
keywords: team, cloud, server, zusammenarbeiten, workspace, workspace wechseln, eigener bereich, anmelden, magic link, live, präsenz, preis, kosten, collaborate, price, auschecken, checkout, lokal, merge, diff, konflikte
related: invites, members-roles, self-hosting, public-api
summary: Mit einem One-Server bearbeiten Teams live zusammen. Jedes Konto startet mit einem eigenen Bereich.
---
Der lokale Workspace braucht keinen Server. Für ein Team verbindest du dich mit einem **One-Server** — heute selbst gehostet (siehe [Selbst hosten & Verschlüsselung](help:self-hosting)); auf getonecms.com zeigt das Workspace-Menü *Team-Cloud — kommt bald* und verlinkt die Anleitung zum Selbsthosten.

## Was es kostet
- **Lokal** (dieser Browser): kostenlos.
- **Selbst gehostet** (dein eigener Server): kostenlos — eine Spende ist willkommen, nie Pflicht.
- **Die gehostete Team-Cloud**: 99 € pro Nutzer und Jahr. Sie ist in Entwicklung: Anmelden kannst du dich noch nicht.

## Anmelden
Auf dem Server deines Teams meldest du dich mit deiner E-Mail an: One schickt einen Einmal-Link — kein Passwort. Bei der ersten Anmeldung legt der Server **deinen eigenen Bereich** an („Bereich von *Name*“): ein Workspace, in dem nur du bist. Workspaces, in die du eingeladen wirst, stehen daneben.

## Workspace wechseln
Klick auf den Workspace-Namen oben in der Seitenleiste: **Dieser Browser (lokal)**, deine Team-Workspaces, **Neuer Team-Workspace…**, **Abmelden**. Ein neuer Team-Workspace kann **Leer beginnen** oder **Meinen lokalen Workspace kopieren** (Seiten, Datenbanken, Inhalte und Dateien; der lokale bleibt, wie er ist).

## Zusammenarbeiten
- Alle bearbeiten live: Präsenz und Cursor zeigen, wer wo ist.
- Offline? Deine Änderungen bleiben auf dem Gerät und synchronisieren, sobald die Verbindung zurück ist.
- Kommentare, Erwähnungen und Zuweisungen landen im **Posteingang** der Personen. Die Erinnerung einer [Aufgabe](help:tasks) erinnert ihre Personen (jedes Mitglied, wenn niemand zugewiesen ist).
- Ändern zwei Personen gleichzeitig dasselbe Feld (die Personen einer Aufgabe, ihren Status), gewinnt für dieses Feld die letzte Änderung.
- Ein Tab mit einer älteren Version von One kann in einem geteilten Arbeitsbereich nur lesen, bis er neu lädt (**Neu laden, um weiter zu bearbeiten**) — er entfernt nie, was eine neuere Version geschrieben hat.
- Dein Claude-Schlüssel, MCP-Server und Sync-Einstellungen bleiben pro Person und Gerät — sie werden nie mit dem Team geteilt.

## Bewusst lokal auschecken
Auf einem aktuellen Team-Server öffnet die Wolke **Cloud · Live** oben oder **Lokal auschecken…** im Workspace-Menü eine Warnung. Nach deiner Bestätigung erstellt One eine eigene lokale Arbeitskopie und lädt ihre Anhänge herunter. Der Ausgangsstand wird für den späteren Vergleich auf diesem Gerät gespeichert. Die ursprüngliche Cloud bleibt für das Team verfügbar.

Die **graue, durchgestrichene Wolke · Lokal · Ausgecheckt** und ein Hinweis über der Seite kennzeichnen die getrennte Kopie. Sie sendet keine Inhaltsänderungen automatisch zurück, auch wenn du wieder online bist. Das unterscheidet sie von einer bloß unterbrochenen Cloud-Verbindung, die weiterhin automatisch nachsynchronisiert.

**Mit Cloud vergleichen…** liest den aktuellen Cloud-Stand. Du siehst Ausgangsstand, Cloud und Lokal nebeneinander; geänderte Zeilen sind markiert. Unabhängige Felder lassen sich zusammenführen. Haben beide Seiten dasselbe Feld oder denselben Rich-Text verändert, musst du **Cloud behalten** oder **Lokal übernehmen** wählen. Rich-Text wird als ganzes Dokument behandelt; eine gewünschte Kombination beider Texte bereitest du vor dem erneuten Vergleich in deiner lokalen Seite vor. Auch Entfernen gegen zwischenzeitliches Bearbeiten ist ein Konflikt.

Erst **Auswahl mit Cloud zusammenführen** schreibt die bestätigte Auswahl. Ändert sich die Cloud zwischen Vergleich und Übernahme, stoppt One den gesamten Merge: **Erneut vergleichen**. Aktuelle Schreibrechte und Seitensperren gelten weiterhin. One aktualisiert anschließend auch die lokale Kopie mit dem bestätigten Ergebnis, solange dort keine neuen, noch ungeprüften Änderungen hinzugekommen sind. Der neue Vergleichsstand verhindert, dass entschiedene Konflikte erneut angeboten werden. **Cloud-Workspace öffnen** zeigt das gemeinsame Ergebnis. Ein Zurücksetzen der lokalen Kopie löst ihre Checkout-Bindung und wird nicht als Cloud-Löschung behandelt.

Der Inhalts-Checkout umfasst geteilte Seiten, Datenbankstruktur, Einträge, Kommentare und Dateien. Private Seiten, persönliche Einstellungen, Verbindungen, Agenten, Freigaben und Automationskonfiguration werden nicht zusammengeführt. Für neue lokale Anhänge ist vor dem Merge ein erfolgreicher Upload erforderlich. Eine Kopie ist an diesen Browser und die ursprüngliche Server-Adresse gebunden; sie bleibt auch nach einer Abmeldung lokal erhalten. Verwende für sie dein eigenes Geräteprofil und sichere wichtige lokale Arbeit regelmäßig. Ein Checkout unterstützt bis zu 5.000 Seiten; ein Merge-Auftrag höchstens 16 MiB JSON, Dateien unterliegen den Upload-Limits des Servers.
