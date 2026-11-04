---
id: 2026-11-04-atlas-skills
date: 2026-11-04
order: 110
title: Skill-Anleitungen aus Atlas übernehmen
summary: Persönliche Atlas-Quellen suchen, vor dem Import lesen und unverändert als Skill-Version binden.
---

Öffne **Skills → Aus Atlas** im Seitendialog oder KI-Terminal. Wähle deine persönliche Verbindung, gib den Tenant und bei Bedarf ein Projekt an. Suche nach einer Anleitung oder lies einen bekannten numerischen Atlas-Ref direkt. Eine Suche zeigt höchstens 20 Kandidaten; sie belegt weder eine vollständige Skill-Liste noch die Abwesenheit weiterer Treffer.

**Quelle lesen** lädt den vollständigen aktiven Record im angegebenen Tenant. Das optionale Projekt wird geprüft. Die Vorschau erwartet eine vollständige `SKILL.md`, einen einzelnen Markdown-Codeblock damit oder eine JSON-Definition mit `name`, `description`, `tags` und `instructions`. Ein Titel oder Tag allein macht aus einem Record keinen Skill. Anhänge und relative Dateiverweise werden nicht automatisch geladen.

**Diese Anleitung übernehmen** speichert einen persönlichen Snapshot auf diesem Gerät und in diesem Workspace. Verbindung, Ursprung, Tenant, Projekt, Ref sowie Inhalts- und Metadaten-Hash bleiben gebunden und werden im Skill-Nachweis mitgeführt. Die lokale Versionsnummer bezeichnet diesen Snapshot; sie ist nicht die Atlas-Revision. Erst **Zum Auftrag hinzufügen** ergänzt die ausgewählte Version zur nächsten Anfrage. Suchen, Lesen und Übernehmen starten keine Modellanfrage und schreiben keine Atlas-Records.

Über **Atlas-Quelle prüfen** lässt sich derselbe Ref erneut lesen. Geänderter Inhalt wird nur nach erneuter Übernahme als neue Version gespeichert. Vorhandene Kompilate behalten ihren alten Snapshot. Gleiche Skill-Namen aus unterschiedlichen Quellen werden nicht stillschweigend überschrieben. Eine manuell bearbeitete Kopie erhält eine neue Version ohne die ursprüngliche Atlas-Quellenbindung. Markdown-Exporte erhalten die feste Quellenbindung beim Import auf einem anderen Gerät.

Unter **Meine Skills → Vorlage: Atlas-Abgleich** steht eine bearbeitbare Anleitung bereit: mit ONE-Kontext arbeiten, bei unklarem Ziel zwischen Neuanlage, Aktualisierung und Kommentar nachfragen, tatsächliche Quellen lesen und Ergebnisse nachvollziehbar prüfen. Atlas bleibt optional. Die Vorlage startet nichts automatisch und gewährt keine Schreibrechte.

Der Markdown-Import unterstützt Beschreibungen bis 2.000 Zeichen, damit auch die vorhandenen deutschen und englischen SDD-Skills übernommen werden können. Skripte aus diesen Paketen werden nicht ausgeführt. Gespeicherte Quellenbindungen sind historische Herkunftsnachweise; sie ersetzen keine aktuellen fachlichen Quellenabrufe oder Freigaben.
