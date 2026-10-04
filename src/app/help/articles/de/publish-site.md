---
id: publish-site
title: Website veröffentlichen
section: share
order: 2
keywords: veröffentlichen, website, webseite, statisch, github pages, netlify, rss, sitemap, llms.txt, blog, doku, publish, site
related: share-links, export, sync
summary: Mach aus einer Seite und ihren Unterseiten eine statische Website — bereit für GitHub Pages oder Netlify.
---
1. Öffne die Seite, die die Startseite der Website werden soll.
2. **Exportieren** (Seitenoptionen **•••**, oder ⌘K → *Exportieren*) → Format **Website**.
3. Wähle den **Umfang**: diese Seite mit ihren Unterseiten, oder **Ganzer Workspace**.
4. Optionen **Website**: **Titel der Website**, **Basis-URL** (optional), **RSS-Feed** (zuletzt bearbeitete Seiten oder die Einträge einer Datenbank).
5. Exportieren — du bekommst ein ZIP.

Die Website hat Navigation, Pfad, eine 404-Seite, `llms.txt` und jede Seite zusätzlich als Markdown. Mit **Basis-URL** (z. B. `https://name.github.io/site/`) bekommt sie außerdem `sitemap.xml`, RSS und Canonical-Links.

## So kommt sie online
- **GitHub Pages:** entpacken, die Dateien in ein Repository hochladen, dann *Settings → Pages → Deploy from branch*.
- **Netlify Drop:** entpacken und den Ordner auf app.netlify.com/drop ziehen.
- **Offline:** `index.html` direkt aus dem entpackten Ordner öffnen.

> Nur exportierte Seiten sind in der Website: Ein Link auf eine Seite außerhalb erscheint als „Private Seite“. Kommentare und Schaltflächen-Aktionen kommen nie in eine Website.
