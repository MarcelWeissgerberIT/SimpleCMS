---
id: properties
title: Eigenschaften
section: databases
order: 2
keywords: eigenschaft, spalte, feld, typ, auswahl, status, datum, zahl, person, relation, rollup, dateien, checkbox, bewertung, id, property, column, key, unique, only by hand, Schlüssel, eindeutig, Nur von Hand
related: formulas, views, ai-autofill, subitems
summary: Eigenschaften sind die Spalten einer Datenbank — Text, Zahlen, Daten, Relationen und mehr.
---
Hinzufügen mit **+** am Ende der Tabellenköpfe (oder **Eigenschaft hinzufügen** in einer Eintragsseite). Tippst du direkt einen neuen Namen, bietet One **Eigenschaft „…“ anlegen** an und fragt nach dem Typ.

## Typen
Text, Zahl, Auswahl, Mehrfachauswahl, Status, Datum, Person, Checkbox, URL, E-Mail, Telefon, Dateien & Medien, Bewertung, ID — dazu berechnete: **Formel**, **Rollup**, **Erstellt am**, **Zuletzt bearbeitet**, **Erstellt von**, **Zuletzt bearbeitet von**.

- **Zahl:** Format (Zahl, mit Trennzeichen, Prozent, Euro, US-Dollar, Pfund) und **Anzeigen als** Zahl, Balken oder Ring.
- **Status:** Optionen in drei Gruppen — Zu erledigen, In Arbeit, Abgeschlossen.
- **Datum:** mit Enddatum, Uhrzeit und der Option **Erinnern**.

## Relationen und Rollups
Eine **Relation** verknüpft Einträge einer Datenbank mit Einträgen einer anderen (oder derselben). **Auch in … anzeigen** macht sie beidseitig: die andere Datenbank bekommt eine passende Eigenschaft, und jede Verknüpfung erscheint auf beiden Seiten.

Ein **Rollup** liest über eine Relation: wähle die **Relation**, die **Eigenschaft** in der anderen Datenbank und was **Berechnen** soll — Anzahl, Summe, Durchschnitt, frühestes Datum, Prozent angehakt …

## Das Eigenschaftsmenü
Klick auf einen Spaltenkopf: umbenennen, **Typ** ändern, **In Ansicht ausblenden**, **Inhalt umbrechen**, links oder rechts einfügen, **Eigenschaft duplizieren**, **Eigenschaft löschen**, **KI-Autofill…**.

## Schlüssel und Nur von Hand
Zwei Schalter im Eigenschaftsmenü betreffen Agenten:
- **Schlüssel** — eine Text-, Zahl- oder URL-Eigenschaft, die einen Eintrag kennzeichnet (Ticketnummer, Bestellcode, Adresse). Jeder Wert kommt nur einmal vor; leer ist erlaubt. Eine Datenbank hat einen Schlüssel; ein Wert, den schon ein anderer Eintrag hat, wird mit einem Hinweis an der Zelle abgelehnt. Agenten finden Einträge darüber, wenn sie eine Datenbank mit einem anderen System abgleichen.
- **Nur von Hand** — Agenten (eigene Agenten, das KI-Terminal, MCP-Clients) schreiben diese Eigenschaft nie; du bearbeitest sie wie gewohnt. Gedacht für deine Notizen, Bewertungen oder Entscheidungen neben gespiegelten Daten.

Der Spaltenkopf zeigt einen kleinen Schlüssel oder eine Hand. Eine gesperrte Datenbank behält beides, wie es ist. Die beiden Schalter erscheinen, solange eine aktive [Integration](help:integrations) sie freischaltet; ohne sie zeigt ein gesetzter Schlüssel oder *Nur von Hand* eine Markierung — und gilt weiter für jeden, der schreibt.
