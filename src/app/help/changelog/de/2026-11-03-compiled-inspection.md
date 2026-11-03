---
id: 2026-11-03-compiled-inspection
date: 2026-11-03
order: 1
title: Kompilate bedienen und ihre Würfel prüfen
summary: Neue BA-/PO-Aufgaben ohne JSON, geführte Eingaben und gespeicherte Compiler-Nachweise.
image: assets/shots/changelog/compiled-inspection.webp
alt: Persönliche Kompilat-Ansicht mit Dimensionsschnitt und ausdrücklich noch offenen Prüfungen.
help: agent
try: terminal
---
**Meine Kompilate** bietet jetzt **Neue BA-/PO-Aufgabe**: Quellenseite, tatsächliche Überschrift oder eigenes Thema wählen und das private Rezept speichern. Die Eingaben eines Kompilats erscheinen als passende Felder. **Prüfen, was noch fehlt** erklärt die lokalen Voraussetzungen, ohne eine Modellanfrage zu starten.

Unter **Ablauf und Blöcke** siehst du Werkzeugfolge und Datenbezüge. **Quantenraum** zeigt Würfel mit anklickbaren Details, Abhängigkeiten und einem **Dimensionsschnitt**. Neue Laufnachweise speichern die tatsächlichen Compiler-Prüfungen und das gebundene Modellpaket; ältere Einträge zeigen nur vorgesehene, offene Prüfungen. Historische Nachweise ersetzen keine aktuelle Freigabe.

BA-/PO-Analysen verlieren lange Absätze und kurze Überschriften nicht mehr stillschweigend. Mehrdeutige Abschnitte halten vor der Modellanfrage mit konkreten Auswahlhinweisen an. In Laufnachweisen bleibt ein Fehler auch neben einer Teilantwort sichtbar. Vollständige persönliche Nachweise werden erst beim Öffnen geladen.


Beim gemeinsamen Claude-Zugang wartet der Aufgabenstart auf die zentrale Freigabe. Eine vorübergehend nicht geladene Konfiguration wird als Verbindungsproblem erklärt und verlangt keinen persönlichen Teilnehmer-Key.


Bei unklaren Atlas-Übertragungen fragt ONE nach der Ablage: **neue Records**, **vorhandenen Inhalt aktualisieren** oder **Kommentare ergänzen**. Die Wahl begrenzt die erlaubten Schreibwerkzeuge dieses Auftrags. Zielinhalte werden vor Kommentaren und Updates gelesen; ein Übertragungsnachweis trennt von Atlas angenommene Schreibvorgänge von durch Rücklesen bestätigten Ergebnissen. Auch bei einem späteren Fehler bleiben angenommene Teilschritte sichtbar. Die Auswahl allein bestätigt keine fachlichen Entscheidungen.


Laufnachweise erfassen jetzt auch gewöhnliche Terminalaufträge sowie fehlgeschlagene und gestoppte Versuche. Diese Verlaufsbelege sind keine ausführbaren Kompilate. Sie enthalten Auftrag, Ergebnis oder Teilantwort, Fehler und aufgezeichnete Werkzeugschritte. Der Verlauf aktualisiert sich nach dem Speichern und beim Zurückkehren; Speichern-Fehler bleiben sichtbar und können erneut versucht werden. Ältere, damals nicht protokollierte Antworten werden dadurch nicht nachträglich rekonstruiert.


Die Seiten-KI hält Werkzeugprotokoll, Quellennachweise, Fehler und Antwort in einem gemeinsamen Scrollbereich. Einfügen und andere Ergebnisaktionen bleiben getrennt erreichbar. Ein dauerhafter Hinweis zählt fehlgeschlagene und erfolgreiche Werkzeugaufrufe; **Fehler anzeigen** springt zum betroffenen Aufruf mit dessen Suchanfrage. Syntaxfehler, Anfragelimits und Serverfehler bekommen eigene Hinweise. Eine unbekannte Ursache wird nicht als falscher Token oder ausgeschalteter Worker ausgegeben.


Bei Dokument-Aufträgen auf einer leeren Seite meldet ONE jetzt vor der Modellanfrage, wenn nur der Titel und kein Dokumentinhalt mitgegeben wurde. Öffne und markiere die importierte Quelle oder nutze die KI am Dateiblock. Atlas-Suchaufrufe mit gleichzeitigem Suchtext und überschreibender AQL-Abfrage werden vor dem Versand zur Korrektur zurückgegeben. Die Faktenprüfung unterscheidet Gesamtzahlen von belegten Tenant-Teilmengen und strukturierte Quellenverweise von tatsächlich gelesenen oder beschreibbaren Records.
