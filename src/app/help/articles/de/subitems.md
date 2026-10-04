---
id: subitems
title: Unterelemente & Abhängigkeiten
section: databases
order: 6
keywords: unterelemente, unteraufgaben, verschachteln, übergeordnet, abhängigkeiten, blockiert durch, blockiert, gantt, zeitleiste, pfeil, sub-items, dependencies
related: views, properties, filter-sort-group
summary: Einträge unter einem übergeordneten verschachteln — und auf der Zeitleiste aufeinander warten lassen.
---
Beides steht in der Werkzeugleiste der Datenbank unter **•••**.

## Unterelemente
Schalte **Zeilen können Unterelemente haben** ein. One legt das Paar **Übergeordnet** ↔ **Unterelemente** an. Tabellen und Listen verschachteln dann Einträge unter ihrem übergeordneten; aufklappen mit dem Pfeil, oder **Unterelement hinzufügen**. **Unterelemente zeigen** wählt *Verschachtelt*, *Flach* oder *Nur oberste*. Boards, Galerien und Kalender zeigen jeden Eintrag als eigene Karte mit der Anzahl seiner Unterelemente.

## Abhängigkeiten
Schalte **Zeilen können andere blockieren** ein. One legt **Blockiert durch** ↔ **Blockiert** an.

In einer **Zeitleiste** ziehst du den Punkt am Ende eines Balkens auf einen anderen Balken: Dieser Eintrag wartet jetzt auf den ersten, ein Pfeil zeigt es. Pfeil anklicken und <kbd>Entf</kbd> drücken entfernt ihn.

**Bei Terminkonflikten:**
- **Abhängige verschieben** — rückt ein Blocker über seine Abhängigen hinaus, wandern sie um die Überschneidung nach hinten; ihre Dauer bleibt.
- **Nur warnen** — Termine bleiben; Pfeile überlappender Paare werden orange.

Beim Ausschalten fragt One, ob beide Eigenschaften als normale Relationen bleiben oder gelöscht werden.
