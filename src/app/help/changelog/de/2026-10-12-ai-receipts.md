---
id: 2026-10-12-ai-receipts
date: 2026-10-12
order: 1
title: Belege für jede KI-Anfrage
summary: Jede Antwort von Claude sagt jetzt, welches Modell sie gegeben hat und was sie gekostet hat — im KI-Menü, im KI-Terminal und bei Agentenläufen.
image: assets/shots/changelog/ai-receipts.webp
alt: Links das KI-Menü nach „Text verbessern“ mit der Belegzeile „Receipt Claude Opus 5.5 · $0.0164 · Table“ unter dem Ergebnis; rechts das KI-Terminal nach zwei Aufgaben mit zwei Modellen und /cost — eine Zeile für Claude Opus 5.5 und eine für Claude Sonnet 5.5 mit Anfragen, Token rein, Cache schreiben / lesen, raus, Kosten und Quelle, darunter die Summe.
help: ai-costs, claude-key, agent
try: terminal
---
**Ein Beleg unter jedem Ergebnis.** Das KI-Menü zeigt unter der Antwort eine Zeile: welches Modell geantwortet hat, was die Anfrage gekostet hat und woher der Preis kommt — **Tabelle** für Ones datierte Preisliste, **Schätzung** (≈) für eine Antwort, die du vor dem Ende gestoppt hast. Fährst du darüber, siehst du die Token.

**`/kosten` je Modell.** Im [KI-Terminal](help:agent) listet `/kosten` (oder `/cost`) eine Zeile je Modell, das in dieser Unterhaltung geantwortet hat — Anfragen, Token rein, Cache schreiben / lesen, raus, die Kosten — und die Summe. Wechselst du mitten in der Unterhaltung das Modell, stehen beide da.

**Agentenläufe** zeigen unter ihrem Verbrauch eine Zeile je Modell; das Budget des Laufs zählt dieselbe Summe.

**Wenn ein anderes Modell antwortet.** Gibt Anthropic eine Anfrage an ein anderes Claude-Modell weiter, sagt der Beleg das und rechnet die Antwort zu dessen Preis.

Die Aufzeichnung bleibt auf diesem Gerät und enthält keinen Seitentext. Mehr unter [Was KI-Anfragen kosten](help:ai-costs).
