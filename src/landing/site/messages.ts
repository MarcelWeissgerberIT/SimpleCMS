/**
 * All visible strings of the marketing site, EN + DE.
 * Simple strings live in `messages` (flat keys, used via t()); structured lists
 * (features, deep dives, comparison, FAQ) live in `content[lang]`.
 */
import type { Lang, Messages } from '@/shared/i18n'

export const messages: Messages = {
  en: {
    'meta.title': 'SimpleCMS One — Notion, rebuilt. Minus the bill.',
    'skip': 'Skip to content',

    'nav.label': 'Sections',
    'nav.savings': 'Savings',
    'nav.features': 'Features',
    'nav.compare': 'Compare',
    'nav.faq': 'FAQ',
    'nav.open': 'Open the workspace',
    'nav.openShort': 'Open',
    'nav.menu': 'Contents',
    'nav.close': 'Close',
    'nav.lang': 'Language',
    'nav.home': 'SimpleCMS One — home',
    'dial.label': 'Section dial — jump to a section',

    'sec.hero': 'Notion, rebuilt',
    'sec.savings': 'Savings',
    'sec.features': 'Features',
    'sec.deep': 'Up close',
    'sec.compare': 'Compare',
    'sec.privacy': 'Data flow',
    'sec.own': 'Own it',
    'sec.faq': 'FAQ',

    'hero.label': '§ 00 — Notion, rebuilt',
    'hero.plate': 'Model One · Rev {version} · Local-first',
    'hero.h1': 'Notion, rebuilt.',
    'hero.h2': 'Minus the bill.',
    'hero.sub':
      'Block editor, databases with seven views, Claude AI on your own key and automations straight into n8n. Free, local-first, no account — it all runs in this browser tab.',
    'hero.cta': 'Open the workspace',
    'hero.import': 'Import from Notion',
    'hero.fine': 'No sign-up · No card · No catch',
    'hero.bom': 'Parts list',
    'hero.partA': 'Block editor',
    'hero.partB': 'Databases',
    'hero.partC': 'Command bar',
    'hero.partD': 'AI, your key',
    'hero.fig': 'Fig. 0 — The workspace, scale 1:1',
    'hero.dwg': 'DWG ONE-001 · Rev {version}',
    'hero.alt': 'Screenshot of the SimpleCMS One workspace: page tree on the left, a page with text blocks and a database, the command bar and the AI menu.',
    'hero.schematicAlt': 'Technical drawing of the SimpleCMS One workspace: sidebar, page with blocks and a database table, command bar and AI panel.',
    'readout.label': 'Instrument readout',
    'readout.cost': '$0',
    'readout.costUnit': 'Per seat, forever',
    'readout.servers': 'Servers',
    'readout.trackers': 'Trackers',
    'readout.pages': 'Pages',

    'savings.label': '§ 01 — Savings',
    'savings.title': 'Do the math.',
    'savings.lead': 'Pick a team size and a Notion plan. The printer does the rest.',
    'savings.team': 'Team size',
    'savings.seats': 'Seats',
    'savings.less': 'One seat fewer',
    'savings.more': 'One seat more',
    'savings.plan': 'Notion plan',
    'savings.plus': 'Plus',
    'savings.business': 'Business',
    'savings.businessNote': 'incl. Notion AI',
    'savings.plusNote': 'AI trial only',
    'savings.billing': 'Billing',
    'savings.monthly': 'Monthly',
    'savings.annual': 'Annual',
    'savings.perSeat': '{price} per member / month',
    'savings.headline': 'You keep',
    'savings.perYear': 'per year',
    'savings.fiveYears': 'Over five years: {amount}',
    'savings.receipt': 'Receipt',
    'savings.live': '{seats} seats, Notion {plan}, billed {billing}: you keep {amount} a year.',
    'r.shop': 'SimpleCMS One',
    'r.sub': 'Cost comparison · 12 months',
    'r.date': 'Date',
    'r.term': 'Term',
    'r.term12': '12 mo',
    'r.seats': 'Seats',
    'r.billing': 'Billing',
    'r.notion': 'Notion {plan}',
    'r.calc': '{seats} × {price} × 12',
    'r.one': 'SimpleCMS One',
    'r.hosting': 'Hosting & servers',
    'r.accounts': 'Accounts & seats',
    'r.ai': 'Claude AI (your key)',
    'r.aiValue': 'per use*',
    'r.saved': 'Saved / year',
    'r.five': '5 years',
    'r.foot':
      '* Billed by Anthropic to your own API key, only when you use it.',
    'r.source': 'Notion list prices in USD excl. tax, as of {asOf}. Source: notion.com/pricing',
    'r.thanks': 'Thank you for not subscribing',
    'r.paid': 'Nothing to pay',

    'features.label': '§ 02 — Features',
    'features.title': 'Sixteen things it does.\nZero add‑ons.',
    'features.lead': 'Everything below ships in the free workspace. There is no other version.',

    'deep.label': '§ 03 — Up close',
    'deep.title': 'Five closer looks.',

    'compare.label': '§ 04 — Compare',
    'compare.title': 'Notion vs. One.\nThe spec sheet.',
    'compare.lead':
      'Notion is excellent at real-time teamwork. One is for people who would rather own their notes. We marked our own gaps, too.',
    'compare.param': 'Parameter',
    'compare.notion': 'Notion',
    'compare.one': 'One',
    'compare.yes': 'Yes',
    'compare.no': 'No',
    'compare.partial': 'Partial',
    'compare.asOf': 'Facts as of {asOf}. Sources: notion.com/pricing, notion.com/help.',

    'privacy.label': '§ 05 — Data flow',
    'privacy.title': 'Where your data goes.',
    'privacy.lead': 'Short answer: nowhere. Long answer: see the schematic.',
    'privacy.browser': 'Your browser',
    'privacy.app': 'One — this tab',
    'privacy.idb': 'IndexedDB',
    'privacy.idbNote': 'Pages · rows · files',
    'privacy.anthropic': 'Anthropic API',
    'privacy.anthropicNote': 'Only with your key, only what you send',
    'privacy.hooks': 'Your webhooks',
    'privacy.hooksNote': 'Only URLs you configure',
    'privacy.servers': 'Our servers',
    'privacy.serversNote': 'Not present',
    'privacy.solid': 'Always',
    'privacy.dashed': 'Optional, opt-in',
    'privacy.none': 'Does not exist',
    'privacy.alt':
      'Diagram: the One app in your browser tab reads and writes IndexedDB. Optionally it calls the Anthropic API with your key and your own webhooks. There are no SimpleCMS servers.',
    'privacy.p1': 'Every page, row and file is stored in IndexedDB, on this device.',
    'privacy.p2': 'AI requests go from your browser straight to Anthropic. No proxy, no markup.',
    'privacy.p3': 'Webhooks fire only to endpoints you enter yourself.',
    'privacy.p4': 'No analytics, no cookies banner — because there are no cookies.',

    'own.label': '§ 06 — Own it',
    'own.title': 'Own the whole thing.',
    'own.lead':
      'Fork the repository, flip two switches, run the deploy. Your copy, your URL, your rules — in about two minutes.',
    'own.s1': 'Fork the repository on GitHub. Keep the name SimpleCMS — the build expects it.',
    'own.s2': 'In your fork: Actions tab → enable workflows. Then Settings → Pages → Source: GitHub Actions.',
    'own.s3': 'Actions → “Deploy to GitHub Pages” → Run workflow. Live at you.github.io/SimpleCMS.',
    'own.fork': 'Fork on GitHub',
    'own.source': 'Read the source',
    'own.timer': 'Est. time',

    'faq.label': '§ 07 — FAQ',
    'faq.title': 'Questions, answered.',

    'footer.end': 'End of document',
    'footer.product': 'Product',
    'footer.project': 'Project',
    'footer.colophon': 'Colophon',
    'footer.armory': 'Built for the Ninja Armory — AI Automations by Jack.',
    'footer.replay': 'Replay the intro',
    'footer.replayNote': '1997 → now · bring earplugs',
    'footer.made': 'Set in Archivo and JetBrains Mono. Printed with paper, ink and one orange.',
    'footer.version': 'Rev {version}',
    'footer.top': 'Back to top',

    'fig.pending': 'Figure',
  },
  de: {
    'meta.title': 'SimpleCMS One — Notion, neu gebaut. Ohne Abo.',
    'skip': 'Zum Inhalt springen',

    'nav.label': 'Abschnitte',
    'nav.savings': 'Ersparnis',
    'nav.features': 'Funktionen',
    'nav.compare': 'Vergleich',
    'nav.faq': 'FAQ',
    'nav.open': 'Workspace öffnen',
    'nav.openShort': 'Öffnen',
    'nav.menu': 'Inhalt',
    'nav.close': 'Schließen',
    'nav.lang': 'Sprache',
    'nav.home': 'SimpleCMS One — Startseite',
    'dial.label': 'Abschnittsskala — zu einem Abschnitt springen',

    'sec.hero': 'Notion, neu gebaut',
    'sec.savings': 'Ersparnis',
    'sec.features': 'Funktionen',
    'sec.deep': 'Im Detail',
    'sec.compare': 'Vergleich',
    'sec.privacy': 'Datenfluss',
    'sec.own': 'Selbst hosten',
    'sec.faq': 'FAQ',

    'hero.label': '§ 00 — Notion, neu gebaut',
    'hero.plate': 'Modell One · Rev {version} · Local-first',
    'hero.h1': 'Notion, neu gebaut.',
    'hero.h2': 'Ohne Abo.',
    'hero.sub':
      'Block-Editor, Datenbanken mit sieben Ansichten, Claude-KI mit eigenem Schlüssel und Automationen direkt nach n8n. Kostenlos, local-first, ohne Konto — alles läuft in diesem Browser-Tab.',
    'hero.cta': 'Workspace öffnen',
    'hero.import': 'Aus Notion importieren',
    'hero.fine': 'Keine Anmeldung · Keine Karte · Kein Haken',
    'hero.bom': 'Stückliste',
    'hero.partA': 'Block-Editor',
    'hero.partB': 'Datenbanken',
    'hero.partC': 'Befehlsleiste',
    'hero.partD': 'KI, dein Schlüssel',
    'hero.fig': 'Abb. 0 — Der Workspace, Maßstab 1:1',
    'hero.dwg': 'ZNG ONE-001 · Rev {version}',
    'hero.alt': 'Screenshot des SimpleCMS-One-Workspace: Seitenbaum links, eine Seite mit Textblöcken und Datenbank, Befehlsleiste und KI-Menü.',
    'hero.schematicAlt': 'Technische Zeichnung des SimpleCMS-One-Workspace: Seitenleiste, Seite mit Blöcken und Datenbanktabelle, Befehlsleiste und KI-Panel.',
    'readout.label': 'Instrumentenanzeige',
    'readout.cost': '0 €',
    'readout.costUnit': 'Pro Platz, für immer',
    'readout.servers': 'Server',
    'readout.trackers': 'Tracker',
    'readout.pages': 'Seiten',

    'savings.label': '§ 01 — Ersparnis',
    'savings.title': 'Rechne nach.',
    'savings.lead': 'Teamgröße und Notion-Tarif wählen. Den Rest erledigt der Drucker.',
    'savings.team': 'Teamgröße',
    'savings.seats': 'Plätze',
    'savings.less': 'Ein Platz weniger',
    'savings.more': 'Ein Platz mehr',
    'savings.plan': 'Notion-Tarif',
    'savings.plus': 'Plus',
    'savings.business': 'Business',
    'savings.businessNote': 'inkl. Notion AI',
    'savings.plusNote': 'nur KI-Testversion',
    'savings.billing': 'Abrechnung',
    'savings.monthly': 'Monatlich',
    'savings.annual': 'Jährlich',
    'savings.perSeat': '{price} pro Mitglied / Monat',
    'savings.headline': 'Du behältst',
    'savings.perYear': 'pro Jahr',
    'savings.fiveYears': 'In fünf Jahren: {amount}',
    'savings.receipt': 'Beleg',
    'savings.live': '{seats} Plätze, Notion {plan}, {billing}: Du behältst {amount} pro Jahr.',
    'r.shop': 'SimpleCMS One',
    'r.sub': 'Kostenvergleich · 12 Monate',
    'r.date': 'Datum',
    'r.term': 'Laufzeit',
    'r.term12': '12 Mon.',
    'r.seats': 'Plätze',
    'r.billing': 'Abrechnung',
    'r.notion': 'Notion {plan}',
    'r.calc': '{seats} × {price} × 12',
    'r.one': 'SimpleCMS One',
    'r.hosting': 'Hosting & Server',
    'r.accounts': 'Konten & Plätze',
    'r.ai': 'Claude-KI (dein Key)',
    'r.aiValue': 'nach Nutzung*',
    'r.saved': 'Gespart / Jahr',
    'r.five': '5 Jahre',
    'r.foot': '* Abrechnung direkt durch Anthropic über deinen eigenen API-Key, nur bei Nutzung.',
    'r.source': 'Notion-Listenpreise in USD zzgl. Steuern, Stand {asOf}. Quelle: notion.com/pricing',
    'r.thanks': 'Danke, dass du nicht abonnierst',
    'r.paid': 'Nichts zu zahlen',

    'features.label': '§ 02 — Funktionen',
    'features.title': 'Sechzehn Funktionen.\nNull Add‑ons.',
    'features.lead': 'Alles hier steckt im kostenlosen Workspace. Eine andere Version gibt es nicht.',

    'deep.label': '§ 03 — Im Detail',
    'deep.title': 'Fünf genauere Blicke.',

    'compare.label': '§ 04 — Vergleich',
    'compare.title': 'Notion vs. One.\nDas Datenblatt.',
    'compare.lead':
      'Notion ist stark bei Teamarbeit in Echtzeit. One ist für alle, die ihre Notizen lieber selbst besitzen. Unsere eigenen Lücken haben wir auch markiert.',
    'compare.param': 'Merkmal',
    'compare.notion': 'Notion',
    'compare.one': 'One',
    'compare.yes': 'Ja',
    'compare.no': 'Nein',
    'compare.partial': 'Teilweise',
    'compare.asOf': 'Stand {asOf}. Quellen: notion.com/pricing, notion.com/help.',

    'privacy.label': '§ 05 — Datenfluss',
    'privacy.title': 'Wohin deine Daten gehen.',
    'privacy.lead': 'Kurze Antwort: nirgendwohin. Lange Antwort: siehe Schaltplan.',
    'privacy.browser': 'Dein Browser',
    'privacy.app': 'One — dieser Tab',
    'privacy.idb': 'IndexedDB',
    'privacy.idbNote': 'Seiten · Zeilen · Dateien',
    'privacy.anthropic': 'Anthropic-API',
    'privacy.anthropicNote': 'Nur mit deinem Key, nur was du sendest',
    'privacy.hooks': 'Deine Webhooks',
    'privacy.hooksNote': 'Nur URLs, die du einträgst',
    'privacy.servers': 'Unsere Server',
    'privacy.serversNote': 'Nicht vorhanden',
    'privacy.solid': 'Immer',
    'privacy.dashed': 'Optional, nur auf Wunsch',
    'privacy.none': 'Existiert nicht',
    'privacy.alt':
      'Diagramm: Die One-App in deinem Browser-Tab liest und schreibt IndexedDB. Optional ruft sie die Anthropic-API mit deinem Key und deine eigenen Webhooks auf. SimpleCMS-Server gibt es nicht.',
    'privacy.p1': 'Jede Seite, Zeile und Datei liegt in IndexedDB, auf diesem Gerät.',
    'privacy.p2': 'KI-Anfragen gehen aus deinem Browser direkt zu Anthropic. Kein Proxy, kein Aufschlag.',
    'privacy.p3': 'Webhooks feuern nur an Endpunkte, die du selbst einträgst.',
    'privacy.p4': 'Keine Analytics, kein Cookie-Banner — weil es keine Cookies gibt.',

    'own.label': '§ 06 — Selbst hosten',
    'own.title': 'Gehört komplett dir.',
    'own.lead':
      'Repository forken, zwei Schalter umlegen, Deploy starten. Deine Kopie, deine URL, deine Regeln — in etwa zwei Minuten.',
    'own.s1': 'Repository auf GitHub forken. Den Namen SimpleCMS behalten — der Build erwartet ihn.',
    'own.s2': 'Im Fork: Tab Actions → Workflows aktivieren. Dann Settings → Pages → Source: GitHub Actions.',
    'own.s3': 'Actions → „Deploy to GitHub Pages“ → Run workflow. Live unter du.github.io/SimpleCMS.',
    'own.fork': 'Auf GitHub forken',
    'own.source': 'Quellcode lesen',
    'own.timer': 'Dauer ca.',

    'faq.label': '§ 07 — FAQ',
    'faq.title': 'Fragen, beantwortet.',

    'footer.end': 'Ende des Dokuments',
    'footer.product': 'Produkt',
    'footer.project': 'Projekt',
    'footer.colophon': 'Kolophon',
    'footer.armory': 'Gebaut für die Ninja Armory — AI Automations by Jack.',
    'footer.replay': 'Intro erneut abspielen',
    'footer.replayNote': '1997 → heute · Ohrstöpsel empfohlen',
    'footer.made': 'Gesetzt in Archivo und JetBrains Mono. Gedruckt mit Papier, Tinte und einem Orange.',
    'footer.version': 'Rev {version}',
    'footer.top': 'Nach oben',

    'fig.pending': 'Abbildung',
  },
}

/* ------------------------------------------------------------------ */
/* Structured content                                                  */
/* ------------------------------------------------------------------ */

export type FeatureKey =
  | 'editor'
  | 'databases'
  | 'ai'
  | 'automations'
  | 'import'
  | 'graph'
  | 'history'
  | 'share'
  | 'present'
  | 'palette'
  | 'private'
  | 'templates'
  | 'panes'
  | 'focus'
  | 'offline'
  | 'i18n'

export interface Feature {
  key: FeatureKey
  /** Two-letter "element" code, used when no illustration is available. */
  code: string
  title: string
  text: string
}

export interface DeepDive {
  key: 'database' | 'ai' | 'automations' | 'graph' | 'import'
  title: string
  text: string
  specs: string[]
  fig: string
}

export type Mark = 'yes' | 'no' | 'partial'
export interface CompareRow {
  param: string
  notion: [Mark, string?]
  one: [Mark, string?]
}

export interface Faq {
  q: string
  a: string
}

export interface SiteContent {
  features: Feature[]
  deep: DeepDive[]
  compare: CompareRow[]
  faq: Faq[]
}

export const content: Record<Lang, SiteContent> = {
  en: {
    features: [
      { key: 'editor', code: 'Ed', title: 'Block editor', text: 'Slash menu, drag handles, toggles, callouts, tables, columns, math and Mermaid diagrams.' },
      { key: 'databases', code: 'Db', title: 'Databases, 7 views', text: 'Table, board, list, gallery, calendar, timeline and chart — seven views over the same rows.' },
      { key: 'ai', code: 'Ai', title: 'Claude AI, your key', text: 'Write, rewrite, summarise and ask your pages, billed per use to your own Anthropic key.' },
      { key: 'automations', code: 'Au', title: 'Automations', text: 'When a row is created, changed or deleted, fire a webhook to n8n, Make or Zapier.' },
      { key: 'import', code: 'Im', title: 'Notion import', text: 'Drop in a Notion export and your pages, nesting and databases come along.' },
      { key: 'graph', code: 'Gr', title: 'Graph view', text: 'A live map of how every page links to every other page in your workspace.' },
      { key: 'history', code: 'Hi', title: 'Version history', text: 'Automatic snapshots of every page, no day limit. Scroll back, restore, carry on.' },
      { key: 'share', code: 'Sh', title: 'Serverless share links', text: 'Share a read-only page as a link. The content travels inside the URL — no server involved.' },
      { key: 'present', code: 'Pr', title: 'Presentation mode', text: 'Present any page full-screen, slide by slide, straight from the editor.' },
      { key: 'palette', code: '⌘K', title: 'Command palette', text: 'One shortcut finds every page, command and setting. Hands stay on the keys.' },
      { key: 'private', code: 'Lo', title: 'Local-first & private', text: 'Everything lives in your browser’s IndexedDB. No account, no server, no telemetry.' },
      { key: 'templates', code: 'Tp', title: 'Templates', text: 'Start from ready-made pages and databases instead of a blank sheet.' },
      { key: 'panes', code: 'Pn', title: 'Stacked panes', text: 'Open pages side by side in sliding panes, like papers spread across a desk.' },
      { key: 'focus', code: 'Fo', title: 'Focus mode', text: 'Hide every panel. Only the page and the caret remain.' },
      { key: 'offline', code: 'Of', title: 'Survives dead Wi-Fi', text: 'Lose the connection mid-sentence and keep typing: writing, databases and search run in the open tab. Reloading, AI and webhooks need a network.' },
      { key: 'i18n', code: 'En', title: 'English & German', text: 'A fully bilingual interface, switchable at any time. Sie oder du — we went with du.' },
    ],
    deep: [
      {
        key: 'database',
        title: 'Databases that keep up.',
        text: 'Rows are real pages. Filter, sort and group, flip between seven views, and every edit lands in IndexedDB the moment you make it.',
        specs: ['7 views over one dataset', '20 property types', 'Relations, rollups & formulas'],
        fig: 'Fig. 3.1 — Database, board view',
      },
      {
        key: 'ai',
        title: 'AI on your terms.',
        text: 'Bring your own Claude key. Requests travel from your browser straight to Anthropic — no middleman, no markup, no monthly AI seat.',
        specs: ['Key stored on this device only', 'Pay per use at Anthropic’s rates', 'Write · rewrite · summarise · ask'],
        fig: 'Fig. 3.2 — AI menu on a selection',
      },
      {
        key: 'automations',
        title: 'Built for automators.',
        text: 'Every database can fire a webhook when rows are created, changed or deleted. Point it at n8n, Make, Zapier or your own endpoint. This is what arrives:',
        specs: ['Triggers: created · changed · deleted', 'POST or PUT, custom headers', 'Plus: set property, notify'],
        fig: 'Fig. 3.3 — Webhook payload, as sent',
      },
      {
        key: 'graph',
        title: 'Your notes, as a map.',
        text: 'Every link between pages becomes an edge. Spot the hubs, find the orphans, and jump anywhere with one click.',
        specs: ['Live force layout', 'Backlinks on every page', 'Click a node to open it'],
        fig: 'Fig. 3.4 — Graph view',
      },
      {
        key: 'import',
        title: 'Switch in 60 seconds.',
        text: 'Export your workspace from Notion, drop the file into One, keep working. No account to create, nothing to configure.',
        specs: ['Notion → Settings → Export', 'Drop the .zip into One', 'Pages, nesting & databases'],
        fig: 'Fig. 3.5 — Migration, timed',
      },
    ],
    compare: [
      { param: 'Free for teams', notion: ['partial', 'Free plan limits blocks for 2+ members'], one: ['yes', 'No seats, no limits'] },
      { param: 'No account required', notion: ['no'], one: ['yes'] },
      { param: 'Data stays on your device', notion: ['no', 'Stored in Notion’s cloud'], one: ['yes', 'IndexedDB in your browser'] },
      { param: 'Keeps working offline', notion: ['partial', 'Apps only, not the browser; 50 rows per database'], one: ['partial', 'Open tab keeps every page & row; a reload needs a connection'] },
      { param: 'AI assistant', notion: ['partial', 'Full on Business ($20+); trial on Free & Plus'], one: ['yes', 'Claude, pay per use'] },
      { param: 'Bring your own AI key', notion: ['no'], one: ['yes'] },
      { param: 'Database views', notion: ['yes'], one: ['yes', '7 views'] },
      { param: 'Webhooks & automations', notion: ['yes', 'Paid plans'], one: ['yes', 'Free · n8n, Make, Zapier'] },
      { param: 'Version history', notion: ['partial', '7 / 30 / 90 days by plan'], one: ['yes', 'Local snapshots, no day limit'] },
      { param: 'Graph view', notion: ['no'], one: ['yes', 'Live map of all links'] },
      { param: 'Pages side by side', notion: ['no'], one: ['yes', 'Stacked panes'] },
      { param: 'Presentation mode', notion: ['partial', 'Beta, paid plans'], one: ['yes'] },
      { param: 'Self-host the whole app', notion: ['no'], one: ['yes', 'GitHub Pages, ~2 min'] },
      { param: 'Real-time multiplayer', notion: ['yes'], one: ['no', 'Single user; tabs stay in sync'] },
      { param: 'Sync across devices', notion: ['yes'], one: ['partial', 'Export / import & share links'] },
      { param: 'Native mobile apps', notion: ['yes'], one: ['partial', 'Responsive web app'] },
    ],
    faq: [
      {
        q: 'Where is my data stored?',
        a: 'In your browser’s IndexedDB, on this device. Nothing is uploaded — unless you add an AI key or a webhook, and then only what that feature sends.',
      },
      {
        q: 'Can I use it on several devices?',
        a: 'Not automatically: there is no cloud sync (yet). Move a workspace with export and import, or send single pages as share links.',
      },
      {
        q: 'What does the AI cost?',
        a: 'Nothing from us. Paste your own Anthropic API key and pay Anthropic per use, at their rates. No key, no AI, no cost.',
      },
      {
        q: 'How do I move from Notion?',
        a: 'In Notion: Settings → Export, Markdown & CSV. In One: Import, then drop the .zip. Pages, nesting and databases come along.',
      },
      {
        q: 'Does it work offline?',
        a: 'Once the workspace is open, yes: writing, databases and search keep running in the tab when the connection drops — your data is on the device anyway. Reloading the page, AI and webhooks need a connection.',
      },
      {
        q: 'Can my team collaborate?',
        a: 'Honestly: not in real time. One is single-user by design. Open it in several tabs and they stay in sync live; share read-only pages via link.',
      },
      {
        q: 'Why is it free?',
        a: 'It is a static site with no servers behind it. There is nothing to run, so there is nothing to bill you for.',
      },
      {
        q: 'What if I clear my browser data?',
        a: 'Then the workspace is gone, like a notebook left on a train. Export regularly — it takes one click.',
      },
    ],
  },
  de: {
    features: [
      { key: 'editor', code: 'Ed', title: 'Block-Editor', text: 'Slash-Menü, Ziehgriffe, Toggles, Callouts, Tabellen, Spalten, Formeln und Mermaid-Diagramme.' },
      { key: 'databases', code: 'Db', title: 'Datenbanken, 7 Ansichten', text: 'Tabelle, Board, Liste, Galerie, Kalender, Zeitleiste und Diagramm — sieben Ansichten auf dieselben Zeilen.' },
      { key: 'ai', code: 'Ai', title: 'Claude-KI, dein Key', text: 'Schreiben, umschreiben, zusammenfassen, Fragen an deine Seiten — abgerechnet über deinen eigenen Anthropic-Key.' },
      { key: 'automations', code: 'Au', title: 'Automationen', text: 'Wird eine Zeile angelegt, geändert oder gelöscht, feuert ein Webhook an n8n, Make oder Zapier.' },
      { key: 'import', code: 'Im', title: 'Notion-Import', text: 'Notion-Export hineinziehen — Seiten, Verschachtelung und Datenbanken kommen mit.' },
      { key: 'graph', code: 'Gr', title: 'Graph-Ansicht', text: 'Eine lebendige Karte, wie jede Seite mit jeder anderen in deinem Workspace verlinkt ist.' },
      { key: 'history', code: 'Hi', title: 'Versionsverlauf', text: 'Automatische Schnappschüsse jeder Seite, ohne Tageslimit. Zurückblättern, wiederherstellen, weitermachen.' },
      { key: 'share', code: 'Sh', title: 'Teilen ohne Server', text: 'Eine Seite schreibgeschützt als Link teilen. Der Inhalt steckt in der URL — kein Server beteiligt.' },
      { key: 'present', code: 'Pr', title: 'Präsentationsmodus', text: 'Jede Seite im Vollbild präsentieren, Folie für Folie, direkt aus dem Editor.' },
      { key: 'palette', code: '⌘K', title: 'Befehlspalette', text: 'Ein Kürzel findet jede Seite, jeden Befehl, jede Einstellung. Die Hände bleiben auf der Tastatur.' },
      { key: 'private', code: 'Lo', title: 'Local-first & privat', text: 'Alles liegt in der IndexedDB deines Browsers. Kein Konto, kein Server, keine Telemetrie.' },
      { key: 'templates', code: 'Tp', title: 'Vorlagen', text: 'Mit fertigen Seiten und Datenbanken starten statt mit einem leeren Blatt.' },
      { key: 'panes', code: 'Pn', title: 'Gestapelte Panels', text: 'Seiten nebeneinander in verschiebbaren Panels öffnen, wie Papiere auf dem Schreibtisch.' },
      { key: 'focus', code: 'Fo', title: 'Fokusmodus', text: 'Alle Panels ausblenden. Nur die Seite und der Cursor bleiben.' },
      { key: 'offline', code: 'Of', title: 'Übersteht Funklöcher', text: 'Verbindung weg, mitten im Satz? Einfach weitertippen: Texte, Datenbanken und Suche laufen im offenen Tab. Neu laden, KI und Webhooks brauchen Netz.' },
      { key: 'i18n', code: 'De', title: 'Deutsch & Englisch', text: 'Vollständig zweisprachig, jederzeit umschaltbar. Und ja: Wir duzen.' },
    ],
    deep: [
      {
        key: 'database',
        title: 'Datenbanken, die mithalten.',
        text: 'Zeilen sind echte Seiten. Filtern, sortieren, gruppieren, zwischen sieben Ansichten wechseln — jede Änderung landet sofort in der IndexedDB.',
        specs: ['7 Ansichten auf einen Datensatz', '20 Eigenschaftstypen', 'Relationen, Rollups & Formeln'],
        fig: 'Abb. 3.1 — Datenbank, Board-Ansicht',
      },
      {
        key: 'ai',
        title: 'KI zu deinen Bedingungen.',
        text: 'Bring deinen eigenen Claude-Key mit. Anfragen gehen aus deinem Browser direkt zu Anthropic — kein Zwischenhändler, kein Aufschlag, kein KI-Abo.',
        specs: ['Key bleibt auf diesem Gerät', 'Bezahlung nach Nutzung zu Anthropic-Preisen', 'Schreiben · umschreiben · zusammenfassen · fragen'],
        fig: 'Abb. 3.2 — KI-Menü auf einer Auswahl',
      },
      {
        key: 'automations',
        title: 'Gebaut für Automatisierer.',
        text: 'Jede Datenbank kann einen Webhook feuern, wenn Zeilen angelegt, geändert oder gelöscht werden. Ziel: n8n, Make, Zapier oder dein eigener Endpunkt. So kommt es an:',
        specs: ['Auslöser: angelegt · geändert · gelöscht', 'POST oder PUT, eigene Header', 'Dazu: Eigenschaft setzen, Hinweis'],
        fig: 'Abb. 3.3 — Webhook-Payload, wie gesendet',
      },
      {
        key: 'graph',
        title: 'Deine Notizen als Landkarte.',
        text: 'Jeder Link zwischen Seiten wird zur Kante. Finde die Knotenpunkte und die Waisen — und spring mit einem Klick überallhin.',
        specs: ['Live-Kräftelayout', 'Backlinks auf jeder Seite', 'Knoten anklicken, Seite öffnen'],
        fig: 'Abb. 3.4 — Graph-Ansicht',
      },
      {
        key: 'import',
        title: 'In 60 Sekunden umgezogen.',
        text: 'Workspace in Notion exportieren, Datei in One ziehen, weiterarbeiten. Kein Konto anlegen, nichts konfigurieren.',
        specs: ['Notion → Einstellungen → Export', '.zip in One ziehen', 'Seiten, Verschachtelung & Datenbanken'],
        fig: 'Abb. 3.5 — Umzug, gestoppt',
      },
    ],
    compare: [
      { param: 'Kostenlos für Teams', notion: ['partial', 'Free-Tarif begrenzt Blöcke ab 2 Mitgliedern'], one: ['yes', 'Keine Plätze, keine Limits'] },
      { param: 'Ohne Konto nutzbar', notion: ['no'], one: ['yes'] },
      { param: 'Daten bleiben auf deinem Gerät', notion: ['no', 'In der Notion-Cloud gespeichert'], one: ['yes', 'IndexedDB in deinem Browser'] },
      { param: 'Arbeitet offline weiter', notion: ['partial', 'Nur Apps, nicht im Browser; 50 Zeilen pro Datenbank'], one: ['partial', 'Offener Tab behält alle Seiten & Zeilen; Neuladen braucht Netz'] },
      { param: 'KI-Assistent', notion: ['partial', 'Voll ab Business (20 $+); Test bei Free & Plus'], one: ['yes', 'Claude, Bezahlung nach Nutzung'] },
      { param: 'Eigener KI-Key', notion: ['no'], one: ['yes'] },
      { param: 'Datenbank-Ansichten', notion: ['yes'], one: ['yes', '7 Ansichten'] },
      { param: 'Webhooks & Automationen', notion: ['yes', 'Bezahltarife'], one: ['yes', 'Kostenlos · n8n, Make, Zapier'] },
      { param: 'Versionsverlauf', notion: ['partial', '7 / 30 / 90 Tage je Tarif'], one: ['yes', 'Lokale Schnappschüsse, ohne Tageslimit'] },
      { param: 'Graph-Ansicht', notion: ['no'], one: ['yes', 'Live-Karte aller Links'] },
      { param: 'Seiten nebeneinander', notion: ['no'], one: ['yes', 'Gestapelte Panels'] },
      { param: 'Präsentationsmodus', notion: ['partial', 'Beta, Bezahltarife'], one: ['yes'] },
      { param: 'Komplette App selbst hosten', notion: ['no'], one: ['yes', 'GitHub Pages, ca. 2 Min.'] },
      { param: 'Echtzeit-Zusammenarbeit', notion: ['yes'], one: ['no', 'Ein Nutzer; Tabs bleiben synchron'] },
      { param: 'Sync zwischen Geräten', notion: ['yes'], one: ['partial', 'Export / Import & Share-Links'] },
      { param: 'Native Mobil-Apps', notion: ['yes'], one: ['partial', 'Responsive Web-App'] },
    ],
    faq: [
      {
        q: 'Wo werden meine Daten gespeichert?',
        a: 'In der IndexedDB deines Browsers, auf diesem Gerät. Hochgeladen wird nichts — außer du hinterlegst einen KI-Key oder einen Webhook, und dann nur, was diese Funktion sendet.',
      },
      {
        q: 'Kann ich One auf mehreren Geräten nutzen?',
        a: 'Nicht automatisch: Einen Cloud-Sync gibt es (noch) nicht. Workspaces ziehst du per Export und Import um, einzelne Seiten teilst du per Link.',
      },
      {
        q: 'Was kostet die KI?',
        a: 'Von uns: nichts. Du hinterlegst deinen eigenen Anthropic-API-Key und zahlst Anthropic nach Nutzung, zu deren Preisen. Kein Key, keine KI, keine Kosten.',
      },
      {
        q: 'Wie ziehe ich von Notion um?',
        a: 'In Notion: Einstellungen → Export, Markdown & CSV. In One: Importieren, dann die .zip hineinziehen. Seiten, Verschachtelung und Datenbanken kommen mit.',
      },
      {
        q: 'Funktioniert es offline?',
        a: 'Ist der Workspace einmal offen, ja: Schreiben, Datenbanken und Suche laufen im Tab weiter, wenn die Verbindung abreißt — deine Daten liegen ja schon auf dem Gerät. Neu laden, KI und Webhooks brauchen eine Verbindung.',
      },
      {
        q: 'Kann mein Team zusammenarbeiten?',
        a: 'Ehrlich gesagt: nicht in Echtzeit. One ist bewusst für eine Person gebaut. Mehrere Tabs bleiben live synchron; schreibgeschützte Seiten teilst du per Link.',
      },
      {
        q: 'Warum ist das kostenlos?',
        a: 'Es ist eine statische Website ohne Server dahinter. Es gibt nichts zu betreiben — also auch nichts, was wir dir berechnen müssten.',
      },
      {
        q: 'Was, wenn ich meine Browserdaten lösche?',
        a: 'Dann ist der Workspace weg, wie ein Notizbuch, das im Zug liegen blieb. Exportiere regelmäßig — es ist ein Klick.',
      },
    ],
  },
}
