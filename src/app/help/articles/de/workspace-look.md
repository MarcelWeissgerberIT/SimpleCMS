---
id: workspace-look
title: Das Aussehen des Workspace — Farben, Schriften, Ecken
section: start
order: 7
keywords: Aussehen, Farben, Akzentfarbe, Signalfarbe, Marke, Schriftart, Schrift, Schriftfarbe, Tinte, Papier, Paper, Hintergrund, dunkles Design, Carbon, Ecken, eckig, rechtwinklig, Überschriften, Serifen, Schalter, LED der Schalter, Kippschalter, Design, Thema, look, theme, colours, colors, fonts, text colour, corners
related: workspace, members-roles, export, share-links
summary: Gib One die Farben und die Schrift deines Workspace — für alle darin. Der Kontrast bleibt lesbar; Exporte und geteilte Links behalten das Standard-Aussehen von One.
---
**Workspace-Einstellungen → Aussehen** legt fest, wie One für alle in diesem Workspace aussieht: Farben, Schrift und Ecken. Du öffnest es auf der Workspace-Seite (§ 02 Aussehen), mit <kbd>Mod+K</kbd> → *Aussehen des Workspace*, über **Überblick → Aussehen → Ändern** oder in **Einstellungen → Darstellung**.

Änderungen sind ein **Entwurf**: Die ganze App zeigt ihn sofort in diesem Tab, weiter unten mit einer Paper- und einer Carbon-Vorschau. **Speichern** behält ihn (im Team: *Für alle speichern*), **Verwerfen** vergisst ihn, und **Rückgängig** im Hinweis holt das vorige Aussehen zurück. Wer den Abschnitt verlässt, verwirft einen nicht gespeicherten Entwurf. **Auf Standard zurücksetzen** bringt One zurück, wie es ausgeliefert wird.

## Vorlagen
Fünf Ausgangspunkte: **Papier** (der Standard von One), **Blaupause** (Kobalt auf kühlem Papier, schmale Überschriften), **Ocker** (Bernstein auf Sand), **Andruck** (Magenta auf Zeitungspapier, Serifenschrift) und **Schweizer Stil** (neutrales Papier, Groteskschrift, rechtwinklige Ecken). Danach lässt sich alles ändern — die Anzeige sagt dann *BLAUPAUSE · ANGEPASST*.

## Farben
- **Signalfarbe** — der eine Akzent: Tasten, Fokusrahmen, Cursor, LEDs und das Licht jedes eingeschalteten Schalters (außer ein Gerät hat in Einstellungen → Darstellung eine andere **LED der Schalter** gewählt).
- **Papier** — der Hintergrundton. Er bleibt hell und ruhig, damit jede Text- und Tag-Farbe lesbar bleibt.
- **Tinte** — die Schriftfarbe. Leiser Text, Linien, Hover-Töne sowie Metall und Glas der Schalter leiten sich davon ab.

Wähle ein Farbfeld oder deine eigene Farbe (den Farbwähler oder einen Hex-Wert wie `#2759db`). **Carbon** (das dunkle Design) wird aus Paper abgeleitet — die Tinte wird zum Hintergrund, das Papier zur Schrift — oder du schaltest *Carbon-Farben getrennt festlegen* ein und wählst Papier, Tinte und Signalfarbe selbst.

## Kontrast ist garantiert
One hält Text bei mindestens **4,5 : 1** und Tasten, Fokusrahmen und die Schalter-LED auf ihrem dunklen Boden bei mindestens **3 : 1** (WCAG AA), in Paper und in Carbon. Eine Farbe, die das nicht schafft, wird abgedunkelt oder aufgehellt, bis sie passt — die Anzeige nennt dann die *verwendete* Farbe und **FÜR KONTRAST ANGEPASST**. Das Raster **Kontrast** zeigt die Werte für beide Designs. Eine Signalfarbe sehr nah an der Tinte bekommt einen Hinweis: Tasten und Links würden sich kaum abheben.

## Schrift und Ecken
- **Oberfläche** — Archivo (die Schrift von One), *Schweizer Grotesk* (Helvetica und Verwandte) oder *System* (die Schrift deines Computers). Schweizer Grotesk und System kommen vom Gerät, nichts wird geladen — deshalb sehen sie auf jedem Computer etwas anders aus.
- **Seitentext** — was *Standard* im Schriftmenü einer Seite bedeutet: die Schrift der Oberfläche, Newsreader (Serifen) oder JetBrains Mono. Seiten mit Serif oder Mono behalten ihre Schrift.
- **Überschriften** — Seiten- und Ansichtstitel, H1–H3 und Aufklapp-Überschriften: Archivo breit (Standard), normal oder schmal, die Schrift der Oberfläche, Serifen oder Mono.
- **Ecken** — Standard (2 · 4 · 8 px) oder rechtwinklig. LED-Punkte bleiben rund.

## Team-Workspaces
Das Aussehen gehört dem Workspace und erreicht alle sofort. **Inhaber und Admins** ändern es; Mitglieder und Leser sehen den Abschnitt nur zum Lesen — auch der Server weist eine Änderung von allen anderen ab. Die Anzeige nennt, wer es wann festgelegt hat.

## Nur auf diesem Gerät
**Auf diesem Gerät das Standard-Aussehen verwenden** (im Abschnitt Aussehen und in **Einstellungen → Darstellung**) zeigt nur hier das Standard-Aussehen von One — alle anderen behalten das Aussehen des Workspace. Hell / dunkel (Paper / Carbon) und die Schriftgröße bleiben ebenfalls Einstellungen dieses Geräts.

## Was das Standard-Aussehen behält
Geteilte Links und Formulare (#/s/…, #/f/…), die HTML- und Markdown-Exporte, die veröffentlichte Website, die öffentlichen Hilfeseiten und Diagramm-Downloads nutzen immer das Standard-Aussehen von One. Komplett-Backups enthalten das Aussehen des Workspace, ein Seiten-Backup nicht. In **Groß öffnen** behält *Als SVG herunterladen* bei einem Mermaid-Schaubild, was auf dem Bildschirm steht; die Datei eines Diagramms behält das Standard-Aussehen von One.
