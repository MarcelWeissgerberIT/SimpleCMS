---
id: synced-blocks
title: Synchronisierte Blöcke
section: writing
order: 7
keywords: synchronisierter block, synchron, spiegeln, wiederverwenden, gleicher inhalt, kopieren und synchronisieren, entkoppeln, synced block
related: block-handle, templates, layout-blocks
summary: Derselbe Inhalt auf mehreren Seiten — irgendwo bearbeiten, überall geändert.
---
## Anlegen
- `/synchron` fügt einen leeren **Synchronisierten Block** ein: schreib hinein.
- Oder öffne das ⋮⋮-Menü eines beliebigen Blocks und wähle **Kopieren und synchronisieren**.

Dann auf einer anderen Seite einfügen (<kbd>Mod+V</kbd>): Die Kopie bleibt mit dem Original synchron. Ein Etikett zeigt, auf wie vielen Seiten er steht.

## Verwalten
Das Menü des Blocks (und das ⋮⋮-Menü) bietet:
- **Zum Original** — aus einer Kopie,
- **Entkoppeln** — diese Kopie wird zu normalen Blöcken,
- **Alle entkoppeln** — am Original: jede Kopie behält ihren aktuellen Inhalt und synchronisiert nicht mehr.

Wird das Original gelöscht, behalten die Kopien ihren Inhalt, schreibgeschützt, bis du sie entkoppelst.

Synchronisierte Blöcke können keine synchronisierten Blöcke enthalten.
