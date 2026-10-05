---
id: database-commands
title: Datenbank-Befehle
section: databases
order: 11
keywords: befehle, datenbankbefehle, ausführen, jetzt synchronisieren, neuer eintrag, csv exportieren, ansicht öffnen, agent ausführen, aktionen, befehle bearbeiten, seitenleiste, commands, database commands
related: databases, buttons, custom-agents, gmail-sync
summary: Jede Datenbank hat ein Menü mit Befehlen — Neuer Eintrag, CSV-Export, Mails synchronisieren — und du kannst eigene hinzufügen.
---
Jede Datenbank hat eine kurze Liste von Befehlen: das, was du am häufigsten mit ihr tust, einen Klick entfernt.

## Wo sie sind
- **Seitenleiste:** mit der Maus über eine Datenbank fahren und auf die Taste **⌘** neben **+** klicken. Auf dem Handy **⋯** antippen — die Befehle stehen oben in diesem Menü.
- **Rechtsklick** auf eine Datenbank in der Seitenleiste: Der Abschnitt **Befehle** kommt zuerst.
- **Datenbankseite:** die Taste **⌘** in der Werkzeugleiste.
- **⌘K:** den Namen der Datenbank oder den Befehl tippen, z. B. *Mails: Jetzt synchronisieren* oder *Projekte: Als CSV exportieren*.

## Die Standardbefehle
Sie erscheinen von selbst, wo sie passen:
- jede Datenbank: **Neuer Eintrag**, **Aus Vorlage** (wenn sie Eintragsvorlagen hat), **Ansicht öffnen**, **CSV importieren…**, **Als CSV exportieren**, **Link kopieren**,
- die Datenbank **Mails**: **Jetzt synchronisieren** mit der Uhrzeit der letzten Synchronisierung, **Jetzt mit Claude ordnen** (wenn das an ist), **Mail-Einstellungen…** — siehe [Gmail-Sync](help:gmail-sync),
- eine Datenbank, die ein eigener Agent beobachtet oder in seinem Bereich nennt: **„<Agent>“ jetzt ausführen** — wie **Jetzt ausführen** beim Agenten selbst,
- das One-Gedächtnis: **Gedächtnis-Verlauf öffnen**.

Läuft ein Befehl, leuchtet die LED an der Taste; das Ergebnis kommt als kurze Meldung (*Projekte · Als CSV exportieren · 8 Zeilen exportiert*). Geht etwas schief, hat die Meldung eine Taste **Erneut**.

## Eigene Befehle
**Befehle bearbeiten…** (am Ende des Menüs) zeigt alle Befehle:
- einen Standardbefehl aus- oder wieder einblenden,
- die Reihenfolge ändern: am Griff ziehen, oder <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd>,
- **Befehl hinzufügen** — eine Beschriftung, ein Symbol und was er tut:
  - **Aktionen** — dieselben Aktionen wie bei einer [Schaltfläche](help:buttons): einen Eintrag mit voreingestellten Werten anlegen, Eigenschaften ändern, einen Webhook senden, einen Link oder eine Seite öffnen, eine Nachricht zeigen,
  - **Agent ausführen** — einer deiner [eigenen Agenten](help:custom-agents),
  - **Ansicht öffnen** — die Datenbank in einer ihrer Ansichten.

*Eigenschaften ändern* betrifft die Zeilen, die du in der Tabelle markiert hast — starte den Befehl mit der Taste **⌘** auf der Datenbankseite.

> Eine **gesperrte** Datenbank behält ihre Befehle, wie sie sind: Sie laufen weiter, aber niemand ändert die Liste, bis sie entsperrt ist. In einem Team-Arbeitsbereich werden die Befehle wie die Datenbank geteilt; Leser sehen nur Befehle, die nichts verändern, und Agenten folgen ihren eigenen Regeln (ein Browser-Agent läuft im Browser seines Erstellers).
