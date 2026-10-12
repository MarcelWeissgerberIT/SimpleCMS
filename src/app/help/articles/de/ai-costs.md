---
id: ai-costs
title: Was KI-Anfragen kosten
section: ai
order: 17
keywords: kosten, preis, preise, beleg, belege, token, verbrauch, budget, schätzung, tabelle, cache, cache lesen, cache schreiben, ausgabenlimit, /kosten, cost, costs, price, receipt, tokens, usage, estimate, spend limit
related: claude-key, ai-menu, agent, custom-agents
summary: Jede KI-Anfrage in One bekommt einen Beleg — welches Modell geantwortet hat, was es gekostet hat und wie One den Preis ermittelt hat. Abgerechnet wird beim Anbieter.
---
One schickt KI-Anfragen mit deinem eigenen Schlüssel, also rechnet dein Anbieter sie ab — bei Claude ist das Anthropic, über dein Konto. One zählt jede Antwort auf diesem Gerät mit und zeigt, was sie gekostet hat.

## Wo du es siehst
- **KI-Menü:** unter jedem Ergebnis eine Belegzeile, zum Beispiel `Claude Sonnet 5.5 · 0,0040 $ · TABELLE`. Fährst du darüber, siehst du die Token (rein, Cache schreiben, Cache lesen, raus) und das Datum der Preistabelle. Braucht ein Ergebnis mehrere Anfragen (Umwandeln → Automatisch, ein MCP-Server, der die Antwort pausiert), zählt der Beleg sie zusammen.
- **[KI-Terminal](help:agent):** Die Fußzeile summiert die Unterhaltung; `/kosten` (`/cost`) listet eine Zeile je Modell, das geantwortet hat — Anfragen, Token rein, Cache schreiben / lesen, raus, die Kosten und woher der Preis kommt — und die Summe. Wechselst du mitten in der Unterhaltung das Modell, bekommen beide eine Zeile. Die Anfrage nach einer Aufgabe, die vorschlägt, was One sich merken soll, zählt mit. *Rein* ist immer die Eingabe außerhalb des Cache — Cache schreiben und lesen haben eigene Zahlen.
- **[Agenten](help:custom-agents):** Jeder Lauf zeigt unter seinem Verbrauch eine Zeile je Modell. Das Budget des Laufs zählt dieselbe Summe.

## Wie One den Preis ermittelt
- **Tabelle** — die Token, die der Anbieter meldet, × Ones datierte Preistabelle. Cache lesen und Cache schreiben haben eigene Preise und werden nie doppelt gezählt.
- **Schätzung** — eine Antwort, die gestoppt wurde oder abbrach, bevor ihr Verbrauch kam: die Eingabe, die der Anbieter zu Beginn gemeldet hat (sonst die Größe der Anfrage — der Text, die Seiten eines Dokuments, ein Bild, die Werkzeuge), plus die Zeichen, die schon ankamen. Der Betrag steht mit `≈`; Beträge ohne `≈` kommen aus der Tabelle.
- **Preis unbekannt** — ein Modell, das die Tabelle nicht kennt. Ein Agentenlauf mit Budget hält dann lieber an, als ein Budget zu überschreiten, das er nicht zählen kann.
- Eine Anfrage, die dein Anbieter vor der Antwort abweist (Ratenlimit, Überlastung), steht ohne Kosten in der Liste — auch wenn du sie stoppst, während sie auf den nächsten Versuch wartet. Eine Anfrage, die gestoppt wurde, bevor sie hinausging, steht gar nicht in der Liste.

## Ein anderes Modell hat geantwortet
Anthropic kann eine Anfrage, die das gewählte Modell ablehnt, an ein anderes Claude-Modell weitergeben. Der Beleg nennt dann das Modell, das geantwortet hat, und fügt die Zeile *Anthropic hat an Claude Sonnet 5.5 weitergegeben* hinzu. Jeder Teil kostet den Preis des Modells, das ihn bearbeitet hat: was das gewählte Modell vor der Ablehnung gelesen hat, zu seinem Preis, die Antwort zum Preis des anderen. Terminal und Agentenläufe zeigen dieselbe Zeile.

## Was gespeichert wird
Die Aufzeichnung hinter den Belegen bleibt auf diesem Gerät: IDs, Modelle, Token-Zahlen, Beträge — nie Seitentext. Sie hält 90 Tage, wird nie synchronisiert, exportiert oder gesichert und verschwindet, wenn du die Kopie eines Arbeitsbereichs von diesem Gerät entfernst oder die App hier zurücksetzt. Im Team hat jedes Mitglied seine eigene.

> Das sind Ones Zahlen nach Listenpreisen. Der verbindliche Betrag und ein festes Ausgabenlimit liegen bei deinem Anbieter — für Claude in der Anthropic-Konsole (**console.anthropic.com → Settings → Limits**).
