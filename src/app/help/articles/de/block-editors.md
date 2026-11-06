---
id: block-editors
title: Bearbeiter und Änderungen im Abschnitt
section: team
order: 25
keywords: Zusammenarbeit, Bearbeiter, Autor, Block, geteilt, einblenden, Nachweis, Änderungen, Abschnitt
related: team-cloud
summary: Namen pro Abschnitt einblenden und ihre erfassten Änderungen gemeinsam ansehen.
---
Öffne eine geteilte Seite im Server-Workspace und wähle **Seitenoptionen (…) → Block-Bearbeiter anzeigen**. Namen erscheinen einmal pro Abschnitt, nicht nach jedem Tastendruck oder an jedem einzelnen Block. Eine Überschrift beginnt einen Abschnitt; Inhalt davor gehört zum ersten Bereich. Ohne Überschriften ist die Seite ein Bereich. Unbekannte oder nicht auflösbare Bearbeiter bleiben ohne Plakette und ohne zusätzlichen Abstand.

**Klicke auf einen Namen**, um alle erfassten Beiträge dieser Person im angeklickten Abschnitt zu sehen. Das Panel zeigt zunächst nur hinzugefügten und entfernten Text. Die Änderungen werden nach betroffenem Bereich gebündelt. Fortlaufende Bearbeitungen derselben Person werden zusammengefasst; ein Wechsel zu einem anderen Bearbeiter erzeugt einen getrennten Beitrag. So erscheinen fremde Änderungen nicht als eigene. Über **Vorher und nachher anzeigen** kannst du Kontext und Formatierung vergleichen. Weitere Bereiche lassen sich nachladen; die Ansicht beschränkt sich nicht auf den letzten Beitrag. Der Seitentext wird dafür nicht verändert oder in neue Blöcke zerlegt.

ONE erfasst die Vergleiche auf dem Server ab der Bereitstellung dieser Funktion. Früher wurden nur Name und Zeitpunkt gespeichert. Dafür zeigt das Panel einen Hinweis, statt einen alten Inhaltsvergleich zu erfinden. Gelöschter Inhalt bleibt in den erfassten Vergleichen erhalten, solange der betreffende Abschnitt existiert; gelöschte Abschnitte haben keinen Namen mehr als Einstieg auf der aktuellen Seite. Rückgängig gemachte Änderungen können in einem zusammengefassten Beitrag keine verbleibende Änderung ergeben.

Der Schalter ist **jederzeit abschaltbar**. Ausgeschaltet verschwinden Namensleisten und Panel vollständig. Die Einstellung gilt für diesen Browser und verändert die Ansicht anderer Personen nicht. Sie schaltet die Anzeige aus; der Server erfasst neue Beiträge weiterhin für die gemeinsame Änderungsansicht. Auch Gäste mit Leserecht können die Ansicht benutzen. Erfasste Vergleiche sind für die aktuellen Leser derselben Seite sichtbar; persönliche Geheimnisse gehören in **Meine Secrets**.

Der Server verwendet das angemeldete Konto. Browser-KI zeigt das Konto, das eine Änderung angewendet hat. Zeitpunkte bezeichnen den Serverempfang, auch nach Offline-Arbeit. Übersetzte Ansichten zeigen Änderungen am Quellinhalt. Live-Cursor zeigen dagegen, wer gerade anwesend ist oder tippt.

Lokale Workspaces, Privatseiten und öffentliche Freigabeseiten zeigen die Funktion nicht. In privaten Seitendokumenten werden keine neuen Inhaltsvergleiche erfasst. Exportierte Workspace-Dateien enthalten diese Ansicht nicht; vollständige Serversicherungen bewahren die gemeinsam gespeicherten Vergleiche. Der Server benötigt `block-authors:1` und für Inhaltsvergleiche `block-changes:1`.
