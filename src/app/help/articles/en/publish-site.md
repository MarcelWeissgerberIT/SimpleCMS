---
id: publish-site
title: Publish a website
section: share
order: 2
keywords: publish, website, site, static, github pages, netlify, rss, sitemap, llms.txt, blog, docs, veröffentlichen, Website, Webseite
related: share-links, export, sync
summary: Turn a page and its subpages into a static website — ready for GitHub Pages or Netlify.
---
1. Open the page that should become the site's start page.
2. **Export** (Page options **•••**, or ⌘K → *Export*) → format **Website**.
3. Choose the **Scope**: this page with its subpages, or the **Whole workspace**.
4. **Website** options: **Site title**, **Base URL** (optional), **RSS feed** (recently edited pages, or the rows of a database).
5. Export — you get a ZIP.

The site has navigation, breadcrumbs, a 404 page, `llms.txt`, and every page also as Markdown. With a **Base URL** (e.g. `https://name.github.io/site/`) it also gets `sitemap.xml`, RSS and canonical links.

## Put it online
- **GitHub Pages:** unzip, upload the files to a repository, then *Settings → Pages → Deploy from branch*.
- **Netlify Drop:** unzip and drag the folder onto app.netlify.com/drop.
- **Offline:** open `index.html` straight from the unzipped folder.

> Only the pages you export are in the site: a link to a page outside it shows as “Private page”. Comments and button actions never go into a site.
