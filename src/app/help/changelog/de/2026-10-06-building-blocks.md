---
id: 2026-10-06-building-blocks
date: 2026-10-06
order: 4
title: Bausteine — gemeinsame Listen, eigene Eigenschaftstypen, Datensatz-Typen
summary: Baue die Teile, aus denen deine Datenbanken bestehen: Listen, die jede Auswahl teilen kann (einfügen oder von Claude füllen lassen), eigene Eigenschaftstypen mit Aussehen und kleinen Skripten, die Werte prüfen, berechnen und formatieren, und Datensatz-Typen.
image: assets/shots/changelog/building-blocks.webp
alt: Der eigene Typ „IBAN“ auf der Seite Bausteine — seine Anzeige (eine blaue Plakette) mit Live-Vorschau, sein Prüf-Skript im One-Script-Editor und „An einer Zeile testen“, das „DE00 1234“ mit „Not a valid IBAN“ ablehnt
help: building-blocks, one-script
try: kit
---
**Bausteine** (Seitenleiste, ⌘K, `#/kit`) hat drei Reiter:

- **Listen** — gemeinsame Auswahlen wie Bundesländer oder Kostenstellen. Viele Zeilen auf einmal einfügen, mit Alt+↑ / ↓ umsortieren und **Mit Claude füllen** („alle ISO-Währungen“): Du hakst ab, was hinein soll. In einer Datenbank: **An Liste binden…**. Einen Eintrag, den Zeilen noch nutzen, zu entfernen fragt erst — entfernen oder durch einen anderen ersetzen. Aus einer Seite: KI-Menü → **In Liste umwandeln**.
- **Eigenschaftstypen** — ein Standardtyp mit deinen Regeln: Präfix, Suffix, Farbe, Stil Plakette / LED / Balken, und [One-Script](help:one-script)-Bindungen — **Wert** (berechnet, nur lesbar ƒ), **Prüfen** (ein Text lehnt die Eingabe ab), **Optionen**, **Format**, **Bei Änderung** (Mail und Web werden vorher gefragt). Jede mit Vorlagen und **An einer Zeile testen**.
- **Datensatz-Typen** — ein benannter Satz von Eigenschaften („Bug“, „Lead“) plus dem Inhalt, mit dem ein neuer Datensatz beginnt; jede Datenbank, die ihn führt, zieht beim Speichern nach.

Im Team laufen die Skripte eines Typs auf deinem Gerät nur in einer Fassung, die du gespeichert oder bestätigt hast — ein Chip **PRÜFEN** zeigt, wenn jemand sie geändert hat.
