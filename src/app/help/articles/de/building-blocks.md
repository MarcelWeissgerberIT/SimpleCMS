---
id: building-blocks
title: Bausteine — Listen, eigene Typen, Datensatz-Typen
section: databases
order: 12
keywords: Bausteine, kit, gemeinsame Liste, Liste, Optionen, eigener Eigenschaftstyp, eigener Typ, Eigenschaftstyp, Skript, prüfen, Format, berechneter Wert, Bei Änderung, Datensatz-Typ, Bug, Lead, IBAN, Ampel, Team, bestätigen, prüfen, building blocks, shared list, own type, record type
related: properties, one-script, databases, team-cloud
summary: Gemeinsame Listen für jede Auswahl, eigene Eigenschaftstypen mit Aussehen und kleinen Skripten, und Datensatz-Typen — Sätze von Eigenschaften, die eine Zeile trägt.
---
**Bausteine** in der Seitenleiste (oder ⌘K → *Bausteine*, `#/kit`) enthält die Teile, aus denen deine Datenbanken bestehen. Drei Reiter:

## Listen
Eine Liste ist eine Auswahl, die viele Datenbanken teilen — Bundesländer, Währungen, Kostenstellen.
- **Neue Liste**, dann Einträge einzeln tippen — oder **viele Zeilen auf einmal einfügen** (Aufzählungszeichen und Nummern fallen weg).
- Einen Eintrag direkt umbenennen, seine Farbe wählen, per Ziehen oder **Alt+↑ / ↓** umsortieren.
- Wird ein Eintrag noch von Zeilen genutzt, fragt Löschen zuerst: **Trotzdem entfernen** oder **Ersetzen durch…** einen anderen Eintrag.
- **Mit Claude füllen**: Beschreib die Einträge („alle deutschen Bundesländer“, „ISO-Währungen“) — Claude schlägt sie vor, du hakst ab, was hinein soll. Verschickt werden nur deine Anfrage und die Namen der Liste; wählst du eine Seite, darf Claude auch sie lesen (ihre Kontext-Markierungen gelten).
- In einer Datenbank: das Typ-Menü der Eigenschaft → **An Liste binden…** → *Auswahl* oder *Mehrfachauswahl*. Die Eigenschaft bietet immer die Einträge der Liste an; eine dort neu getippte Option landet in der Liste.
- Aus einer Seite: Zeilen oder eine Aufzählung markieren → KI-Menü → *Mehr* → **In Liste umwandeln** (es wird nichts verschickt).

## Eigene Eigenschaftstypen
Ein eigener Typ ist ein Standardtyp mit deinen Regeln. **Neuer Eigenschaftstyp** fragt, wie Werte **gespeichert** werden (Text, Zahl, Auswahl, Datum …, oder *Frei* = Text, geformt von Skripten) — diese Basis steht nach dem Anlegen fest. Dann:
- **Optionen aus** einer Liste (Auswahl-Basen), Zahlenformat, Sterne.
- **Anzeige**: Präfix, Suffix, Farbe und Stil — schlicht, Plakette, LED oder Balken.
- **Skripte** in [One Script](help:one-script), jeweils mit Vorlagen und **An einer Zeile testen**:
  - **Wert** — berechnet den Wert aus der Zeile (`row`). Die Zelle ist nur lesbar und zeigt ƒ; neu berechnet wird, wenn sich die Zeile ändert, wenn sie angezeigt wird, und mit **Werte neu berechnen** im Eigenschaftsmenü.
  - **Prüfen** — prüft, was jemand tippt: `true` nimmt es an, ein Text lehnt es mit dieser Meldung ab, der Wert wird **nicht geschrieben**.
  - **Optionen** — die Auswahl im Picker: eine Liste von Texten oder `{name: "Hoch", color: "red"}`.
  - **Format** — der Text, den eine Zelle statt des gespeicherten Werts zeigt.
  - **Bei Änderung** — läuft nach einer Änderung (`value`, `old`, `row`) wie ein Skriptlauf: Mail, Claude und das Web werden vorher gefragt.

Drei Beispiele:
```
# Prüfen: nur Adressen einer Domain
let answer = true
if value and not ends_with(lower(value), "@example.com") {
  answer = "Bitte eine Adresse @example.com"
}
answer
```
```
# Wert: eine Ampel aus einer Zahl
let light = "Grün"
if row.Score < 70 { light = "Gelb" }
if row.Score < 40 { light = "Rot" }
light
```
```
# Optionen: die offenen Projekte
db("Projekte").where(Status != "Erledigt").sort(title).map(x => x.title)
```
In einer Datenbank: Das Typ-Menü der Eigenschaft zeigt ihn unter **Bausteine**. Ein fehlerhaftes Skript legt keine Tabelle lahm — die Zelle zeigt den gespeicherten Wert mit ⚠.

## Datensatz-Typen
Ein Datensatz-Typ — „Bug“, „Lead“, „Rechnung“ — ist ein benannter Satz von Eigenschaften (Standardtypen, eigene Typen, Listen) plus dem Inhalt, mit dem ein neuer Datensatz beginnt. Eine Datenbank, die den Typ führt, bekommt alle seine Eigenschaften; beim **Speichern** ziehen alle diese Datenbanken nach (eine gesperrte bleibt, wie sie ist). Entfernst du eine Eigenschaft aus dem Typ, bleibt sie in den Datenbanken als normale Eigenschaft — mit ihren Werten.

## Im Team
Listen und Typen teilen alle im Arbeitsbereich. Skripte laufen mit **deinen** Rechten auf deinem Gerät, darum laufen die Skripte eines Typs nur in einer Fassung, die **dieses Gerät gespeichert oder bestätigt** hat: Ändert jemand aus dem Team sie, zeigen Zellen die gespeicherten Werte und einen Chip **PRÜFEN** — öffnen, Code lesen, **Bestätigen**. Wert- und Bei-Änderung-Skripte einer geteilten Zeile lesen nie deine privaten Seiten.
