---
id: block-editors
title: Wer hat diesen Block bearbeitet?
section: team
order: 25
keywords: Zusammenarbeit, Bearbeiter, Autor, Block, geteilt, einblenden, Nachweis
related: team-cloud
summary: Den zuletzt synchronisierenden Account je Block im Cloud-Dokument einblenden.
---
Öffne eine Seite im Cloud-Workspace und wähle **Seitenoptionen (…) → Block-Bearbeiter anzeigen**. Kleine Plaketten über den Blöcken zeigen den letzten Bearbeiter. Beim Darüberfahren siehst du den Zeitpunkt. Auch Leser können den Schalter nutzen. ONE merkt sich die Ansicht in diesem Browser; der Seiteninhalt, fremde Ansichten und Workspace-Exporte ändern sich dadurch nicht.

ONE zeigt bereits anwesende Personen und Live-Cursor. Sie zeigen, wer gerade da ist oder tippt. Die Block-Plaketten zeigen dagegen das Konto, dessen Inhaltsänderung zuletzt beim Server ankam. Listen, Tabellen und andere Container haben jeweils eine gemeinsame Plakette. Änderungen darin aktualisieren deren Bearbeiter. Das Verschieben eines unveränderten Blocks innerhalb der Seite behält dessen Bearbeiter bei.

Der Server erfasst das angemeldete Konto statt eines mitgelieferten Namens. KI-Änderungen aus dem Browser zeigen das Konto, das sie angewendet hat. Ohne bekannten Bearbeiter oder zugehörigen Namen erscheint keine Plakette und es entsteht kein zusätzlicher Abstand. Das gilt auch für Server-/API-Schreibvorgänge ohne auflösbaren Namen. Ältere Blöcke erhalten beim Öffnen keinen erfundenen Autor.

Der Zeitpunkt bezeichnet den Serverempfang, auch nach Offline-Arbeit. Gleichzeitige Änderungen laufen mit dem gemeinsamen Dokument zusammen. Dies ist eine Anzeige der letzten Änderung, keine vollständige Autorenhistorie oder Änderungsverfolgung. Beim Löschen eines Blocks entfällt seine aktuelle Plakette. Übersetzte Ansichten zeigen den Bearbeiter des Quellblocks, nicht dessen Übersetzer.

Neu erfasst werden Änderungen, die nach der Bereitstellung dieser Funktion eintreffen. Lokale Workspaces, öffentliche Freigabeseiten und exportierte Dateien zeigen keine Plaketten. Der Server muss `block-authors:1` unterstützen.
