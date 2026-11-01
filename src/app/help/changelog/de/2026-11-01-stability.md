---
id: 2026-11-01-stability
date: 2026-11-01
order: 7
help: mcp-servers
title: Verlässlicher von Atlas-Quelle bis Abnahme
summary: Kleine Werkzeugkataloge, konkrete Fehlerhilfe und gespeicherte Quellen-Übergabenachweise.
---
Copilot mit kleinem Kontext lädt ONE-Werkzeuge jetzt gezielt nach. Atlas-Fehler bekommen eine passende Reparaturkarte; fehlende Rechte werden von einem abgelehnten Token unterschieden. Identitätsprüfung und Werkzeugsuche ersetzen keine Projektabfrage. Widersprüchliche Aussagen über leere Ergebnisse oder ungeprüftes Speichern werden vor der Ausgabe geprüft.

Direkte Quellenübergaben merken sich auf diesem Gerät bereits versuchte identische Schreibvorgänge auch nach dem Neuladen. Bei einer verlorenen Antwort zuerst Atlas prüfen. Der Nachweis enthält Hash und echte Referenz, keine Zugangstokens oder Quellentexte. Das ist kein geräteübergreifendes Exactly-once-Versprechen. Der genaue Aufruf bleibt auf 20.000 Zeichen begrenzt; größere Originalquellen bleiben vollständig in ONE.

Eine offene Frage in einer Analyse hält den Lauf nicht allein deshalb an. Der Entscheidungswürfel ist für tatsächlich abhängige nächste Schritte gedacht. Zu früh angeforderte Rückfragen erhalten einen Korrekturhinweis; sie werden weder als Nutzerentscheidung gespeichert noch mit erweiterten Rechten ausgeführt.

Bei einer ausdrücklich genannten Atlas-Referenz löst ONE eine bloße Werkzeugsuche nach „Atlas“ zum direkten Lesewerkzeug auf. Es liest dadurch noch keinen Datensatz und erweitert keine Rechte. Ein Kompilat übernimmt für seine werkzeuglose Generierung die frische, begrenzte Originalantwort statt einer interaktiven Seitenübersicht. Die normale Kontextgrenze gilt weiter: Eine zu große Quelle stoppt den Schritt, statt fehlende Inhalte zu erfinden.
