---
id: atlas-package-freshness
date: 2026-11-08
order: 7
title: Atlas-Paketstand direkt am Mock
summary: Paket und verwendete Komponenten werden beim Laden erneut geprüft.
help: agent
---

Beim Öffnen oder Neuladen eines gespeicherten Mocks liest One dessen belegte Designquellen erneut in Atlas. Direkt unter den Tabs siehst du **wird geprüft**, **verwendete Quellen aktuell**, **Paket geändert** oder **nicht prüfbar** – mit Prüfzeitpunkt.

Geänderte Quellen und zugehörige verwendete Komponenten werden namentlich angezeigt. **Details in Atlas** öffnet die Quellenliste; dort lässt sich eine gezielte Aktualisierung als Notiz vormerken. Der bisherige Mock bleibt erhalten, bis du eine neue Version annimmst.

Die Prüfung verwendet deine bestehende Atlas-Verbindung und braucht keinen Modellaufruf. Sie prüft Paketindex und tatsächlich verwendete Quellen, nicht jede ungenutzte Komponente. Ein alter gespeicherter Abgleich wird bei fehlendem Zugriff ausdrücklich als historisch angezeigt. Der Tab-Wechsel löst keine erneute Prüfung aus; **Quellen jetzt prüfen** liest jederzeit neu.
