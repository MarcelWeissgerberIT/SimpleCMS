---
id: history
title: Versionsverlauf
section: writing
order: 11
keywords: verlauf, versionen, wiederherstellen, rückgängig, snapshot, sicherung, frühere version, vorversion, vergleich, vergleichen, was ist neu, diff, änderungen, eigenschaften, datenbank-eintrag, history, restore, compare, properties
related: lock, export, ai-menu
summary: One bewahrt frühere Versionen jeder Seite auf. Zurückspulen, sehen, was jede Version neu brachte, und wiederherstellen.
---
Öffne eine Seite und klick **Versionsverlauf** (die Uhr oben), oder ⌘K → *Versionsverlauf*.

1. Zieh das Band — oder drück <kbd>←</kbd> / <kbd>→</kbd> —, um durch die Versionen zu reisen.
2. **Änderungen** zeigt, was eine Version geändert hat: einen geänderten Absatz Wort für Wort — entfernte Wörter rot durchgestrichen, neue orange hinterlegt —, hinzugekommene und entfernte Blöcke ganz, unveränderte Blöcke eingeklappt (*12 unveränderte Blöcke — anzeigen*).
3. **Version** zeigt die Seite vollständig, wie sie war — und markiert orange, was in dieser Version **neu** war; durchgestrichen wird dort nichts. Schalte **Neues markieren** aus, um die Seite ohne Markierung zu lesen.
4. **Diese Version wiederherstellen** holt sie zurück. Der Stand vor dem Wiederherstellen wird ebenfalls als Version gesichert — du kannst also wieder zurück.

## Verglichen mit der Vorversion — oder mit jetzt
**Vergleich** über den Änderungen legt fest, womit eine Version verglichen wird:

- **Zur Vorversion** (Standard): was diese Version gegenüber der Version davor hinzugefügt, geändert und entfernt hat — *Verglichen mit der Vorversion (Di., 10:42)*. Vor der ältesten Version gibt es keine, darum zählt bei ihr alles als hinzugefügt. **Jetzt** auf dem Band zeigt, was sich seit der neuesten Version getan hat.
- **Bis jetzt**: alles, was sich von dieser Version bis zur Seite, wie sie jetzt ist, geändert hat.

One merkt sich **Vergleich** und **Neues markieren** auf diesem Gerät.

## Datenbank-Einträge
Eine Version eines Datenbank-Eintrags bewahrt auch seinen **Titel, sein Symbol und die Werte seiner Eigenschaften** — Status, Datum, Personen, Optionen, Zahlen, Checkboxen, Relationen. **Änderungen** listet über dem Text in einem Block **Eigenschaften**, was zwischen den beiden verglichenen Ständen abweicht: *Status: In Arbeit → Erledigt*, der alte Wert durchgestrichen, der neue markiert, eine Mehrfachauswahl als entfernte und neue Chips. Wiederherstellen holt die Werte mit dem Inhalt zurück.

- Eine inzwischen gelöschte Eigenschaft oder eine mit anderem Typ kann ihren alten Wert nicht zurückbekommen: Sie steht dann als *nicht wiederhergestellt* da, die übrigen kommen zurück.
- Berechnete Eigenschaften (Formeln, Rollups, Erstellt / Bearbeitet am und von) gehören nie zu einer Version; eine ID bleibt, wie sie ist.
- Spalten und Ansichten einer Datenbank sind nicht im Verlauf — nur die Werte der Einträge. Geänderte Werte lösen Versionen aus wie Tippen; eine Massenänderung auch, höchstens eine Version je Eintrag alle paar Minuten.

## Wann Versionen entstehen
- **Start** — der Stand, bevor du in einer Sitzung zu bearbeiten beginnst,
- **Auto** — beim Bearbeiten, höchstens alle paar Minuten (**Einstellungen → Daten → Versions-Snapshots**),
- **KI** — direkt bevor Claude, ein Agent, eine Automation oder ein MCP-Client die Seite oder die Werte des Eintrags ändert,
- **Manuell** — wenn du **Version sichern** klickst.

> Versionen liegen mit der Seite auf diesem Gerät. Für eine Kopie anderswo exportiere ein Backup.
