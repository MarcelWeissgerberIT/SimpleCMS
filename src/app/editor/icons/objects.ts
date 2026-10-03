/**
 * The generated ceramic objects (public/assets/icons, manifest.json) as inline icons: labels live in
 * messages (editor.icon.obj.<name>); these are extra search words (English + German) for each object.
 * A file the manifest gains later still works — it is found by name and its manifest labels.
 */
import type { Lang } from '@/shared/i18n'
import { iconMessages } from './messages'

export const OBJECT_WORDS: Record<string, string> = {
  blocks: 'stack bricks layers stapel klötze',
  database: 'cylinder drum storage data zylinder speicher daten',
  kanban: 'board grid cards tafel raster karten',
  calendar: 'date month schedule datum monat termine',
  graph: 'network nodes atom netzwerk knoten',
  ai: 'chat message talk comment nachricht chat kommentar',
  command: 'key button keyboard taste knopf tastatur',
  lock: 'secure private closed sicher privat zu',
  history: 'tape recording past band aufnahme verlauf',
  sync: 'chain link connected kette glied verbunden',
  templates: 'documents papers pages dokumente papiere seiten',
  publish: 'send fly launch senden fliegen',
  present: 'board slide display tafel folie anzeige',
  code: 'math numbers rechnen zahlen',
  split: 'panels columns view paneele spalten ansicht',
  focus: 'aim goal dial ziel fokus',
  search: 'find lens loupe suchen finden',
  automation: 'cogs machine settings zahnrad maschine einstellungen',
  import: 'inbox box card eingang kiste karte',
  hammer: 'tool build smash werkzeug bauen',
  'app-icon': 'switch toggle app schalter app',
  binder: 'folder file archive wiki ordner akte archiv',
  notepad: 'notes memo pad notizen memo',
  book: 'read reading lesen lektüre',
  megaphone: 'announce marketing campaign ankündigung marketing kampagne',
  microphone: 'voice podcast audio stimme podcast',
  compass: 'direction navigation onboarding richtung navigation',
  cardbox: 'index cards glossary karteikarten glossar',
  clock: 'time watch hour meeting zeit stunde termin',
  rolodex: 'contacts addresses crm kontakte adressen',
  counter: 'tally clicker count habit zählen klicker gewohnheit',
  sheet: 'spreadsheet grid cells table excel tabelle raster zellen',
  fx: 'function formula tree keys funktion formel baum',
  chart: 'bars graph statistics plot diagramm balken statistik',
  adder: 'sum calculate rollup adding machine summe rechnen rechenmaschine',
}

const humanize = (name: string) => name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The object's name in a language (deterministic — exports use English). */
export function objectLabel(name: string, lang: Lang): string {
  const key = `editor.icon.obj.${name}`
  return iconMessages[lang][key] ?? iconMessages.en[key] ?? humanize(name)
}

/** Everything an object can be found by: name, both labels, extra words (and manifest labels, if given). */
export function objectSearchText(name: string, extra = ''): string {
  return `${name} ${objectLabel(name, 'en')} ${objectLabel(name, 'de')} ${OBJECT_WORDS[name] ?? ''} ${extra}`
}
