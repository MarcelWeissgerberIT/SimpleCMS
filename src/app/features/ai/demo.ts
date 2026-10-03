/**
 * Offline demo answers for people without a Claude key. Nothing leaves the browser: the text is
 * canned (or derived from the selection with plain string rules) and streamed word by word, so the
 * panel, Insert / Replace / Copy and workspace citations can be tried before paying for a key.
 * The panel labels every demo answer as canned.
 */
import type { AIAction } from './client'

type Lang = 'en' | 'de'

export interface DemoRequest {
  action: AIAction
  input: string
  instruction?: string
  context?: string
}

/** Stream `text` in word-sized chunks (20–40 ms apart). Throws `onAbort()` when the signal fires. */
export function streamDemo(text: string, opts: { onToken?: (delta: string) => void; signal?: AbortSignal; onAbort: () => Error }): Promise<string> {
  const chunks = text.match(/\s*\S+/g) ?? []
  return new Promise((resolve, reject) => {
    let i = 0
    let timer = 0
    const abort = () => {
      window.clearTimeout(timer)
      reject(opts.onAbort())
    }
    if (opts.signal?.aborted) return abort()
    opts.signal?.addEventListener('abort', abort, { once: true })
    const tick = () => {
      if (i >= chunks.length) {
        opts.signal?.removeEventListener('abort', abort)
        resolve(text)
        return
      }
      // (not `onToken?.(chunks[i++])`: without a listener the increment would be skipped)
      const chunk = chunks[i]
      i++
      opts.onToken?.(chunk)
      timer = window.setTimeout(tick, 20 + Math.random() * 20)
    }
    // a short "thinking" pause first, like the real thing
    timer = window.setTimeout(tick, 420)
  })
}

/* ---------------- canned texts ---------------- */

const CANNED: Record<Lang, Record<'continue' | 'continueEmpty' | 'summarize' | 'action_items' | 'explain' | 'custom' | 'outline' | 'brainstorm' | 'longer' | 'translate', string>> = {
  en: {
    continue:
      'The next step is to turn these notes into decisions: who owns each point, what “done” looks like and when we check in again. Anything without an owner goes into a short list at the end of this page, so nothing gets lost between meetings.\n\nOnce that list exists, link the related pages here — the context then stays one click away instead of in somebody’s inbox.',
    continueEmpty:
      'This page is where {title} gets its shape. It starts with the goal in one sentence, then the few decisions that are already made, then the questions that are still open.\n\n- **Goal** — what success looks like, in one sentence\n- **Decided** — what we no longer need to discuss\n- **Open** — what still needs an answer, and from whom',
    summarize:
      '- **{title}** collects the key points, decisions and open questions in one place.\n- The most important decision comes first; the details below explain how it was reached.\n- Open questions are still listed and need an owner before the next check-in.',
    action_items:
      '- [ ] Review {title} and confirm the decisions it records\n- [ ] Assign an owner to every open question\n- [ ] Set a date for the next check-in\n- [ ] Share the page with everyone it affects',
    explain:
      'In plain words: this passage describes how a piece of work is organised — what has been decided, who moves it forward and what happens next.\n\n- **Decision** — what the team agreed on\n- **Owner** — the person responsible for the next step\n- **Next step** — the concrete action that follows, with a date',
    custom:
      '**A first draft to build on:**\n\n- State the goal in one sentence\n- List what is already decided\n- Note the open questions and who answers them\n- Close with the next concrete step and a date',
    outline:
      '## {topic}\n\n1. **Context** — why this matters now\n2. **Goal** — what success looks like, in one sentence\n3. **Approach** — the three to five steps to get there\n4. **Risks** — what could go wrong, and how we would notice\n5. **Next steps** — owners and dates',
    brainstorm:
      '- Start with the smallest version of {topic} that someone could use this week\n- Ask three people who would use it what they do today instead\n- Turn the most common question into a page everyone can find\n- Track progress in a database, so the state is visible at a glance\n- Set a date to look back — and keep only what worked',
    longer:
      'In practice, this means agreeing on who owns each part and when the next check-in happens. Writing that down here keeps the context in one place, so anyone who joins later can follow the reasoning without another meeting.',
    translate: '*Demo mode cannot translate offline.* With your Claude key, the selection comes back here in {lang}, formatting intact.',
  },
  de: {
    continue:
      'Als Nächstes machen wir aus diesen Notizen Entscheidungen: Wer verantwortet welchen Punkt, wie sieht „fertig“ aus und wann schauen wir wieder drauf? Alles ohne Verantwortliche kommt in eine kurze Liste am Ende dieser Seite, damit zwischen zwei Meetings nichts verloren geht.\n\nSobald diese Liste steht, verlinken wir die zugehörigen Seiten hier – der Kontext bleibt dann einen Klick entfernt statt in irgendeinem Postfach.',
    continueEmpty:
      'Auf dieser Seite bekommt {title} seine Form. Sie beginnt mit dem Ziel in einem Satz, dann folgen die Entscheidungen, die schon gefallen sind, und schließlich die offenen Fragen.\n\n- **Ziel** – woran wir Erfolg erkennen, in einem Satz\n- **Entschieden** – was wir nicht mehr diskutieren müssen\n- **Offen** – was noch eine Antwort braucht, und von wem',
    summarize:
      '- **{title}** bündelt die wichtigsten Punkte, Entscheidungen und offenen Fragen an einem Ort.\n- Die wichtigste Entscheidung steht oben; die Details darunter zeigen, wie es dazu kam.\n- Offene Fragen sind noch aufgelistet und brauchen vor dem nächsten Termin eine verantwortliche Person.',
    action_items:
      '- [ ] {title} durchgehen und die festgehaltenen Entscheidungen bestätigen\n- [ ] Jeder offenen Frage eine verantwortliche Person zuweisen\n- [ ] Einen Termin für die nächste Abstimmung festlegen\n- [ ] Die Seite mit allen Betroffenen teilen',
    explain:
      'Einfach gesagt: Der Abschnitt beschreibt, wie eine Aufgabe organisiert ist – was entschieden ist, wer sie vorantreibt und was als Nächstes passiert.\n\n- **Entscheidung** – worauf sich das Team geeinigt hat\n- **Verantwortlich** – wer den nächsten Schritt übernimmt\n- **Nächster Schritt** – die konkrete Aktion, mit Datum',
    custom:
      '**Ein erster Entwurf zum Weiterbauen:**\n\n- Das Ziel in einem Satz festhalten\n- Auflisten, was bereits entschieden ist\n- Offene Fragen notieren – und wer sie beantwortet\n- Mit dem nächsten konkreten Schritt und einem Datum abschließen',
    outline:
      '## {topic}\n\n1. **Kontext** – warum das gerade jetzt wichtig ist\n2. **Ziel** – woran wir Erfolg erkennen, in einem Satz\n3. **Vorgehen** – die drei bis fünf Schritte dorthin\n4. **Risiken** – was schiefgehen kann und woran wir es merken\n5. **Nächste Schritte** – Verantwortliche und Termine',
    brainstorm:
      '- Mit der kleinsten Version von {topic} starten, die jemand schon diese Woche nutzen kann\n- Drei künftige Nutzer fragen, was sie heute stattdessen tun\n- Die häufigste Frage in eine Seite verwandeln, die alle finden\n- Den Fortschritt in einer Datenbank verfolgen, damit der Stand auf einen Blick sichtbar ist\n- Einen Termin für den Rückblick setzen – und nur behalten, was funktioniert hat',
    longer:
      'Praktisch heißt das: Wir legen fest, wer welchen Teil verantwortet und wann wir das nächste Mal draufschauen. Steht das hier auf der Seite, bleibt der Kontext an einem Ort – und wer später dazukommt, versteht die Gründe ohne weiteres Meeting.',
    translate: '*Der Demo-Modus kann offline nicht übersetzen.* Mit deinem Claude-Schlüssel erscheint die Auswahl hier auf {lang} – mit derselben Formatierung.',
  },
}

const FILLER: Record<Lang, RegExp> = {
  en: /\b(very|really|just|actually|basically|quite|simply|literally|somewhat|in order)\s+/gi,
  de: /\b(sehr|wirklich|eigentlich|einfach|halt|eben|irgendwie|quasi|sozusagen)\s+/gi,
}

/** List / quote / heading marker at the start of a Markdown line. */
const LINE_PREFIX = /^(\s*(?:[-*+] \[[ xX]\]|[-*+]|\d+[.)]|>|#{1,6})\s+)/

function eachLine(md: string, fix: (text: string, plain: boolean) => string): string {
  return md
    .split('\n')
    .map((line) => {
      if (!line.trim() || /^\s*(```|\|)/.test(line)) return line
      const prefix = line.match(LINE_PREFIX)?.[1] ?? ''
      return prefix + fix(line.slice(prefix.length), !prefix)
    })
    .join('\n')
}

/** Spacing, sentence capitals, a lone lower-case "i" (EN) and a closing full stop for plain paragraphs. */
function tidy(text: string, lang: Lang, plain: boolean): string {
  let s = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;!?])(?=\s|$)/g, '$1')
  s = s.replace(/^(\s*)(\p{Ll})/u, (_m, a: string, b: string) => a + b.toUpperCase())
  s = s.replace(/(\p{L}{3,}[.!?]\s+)(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
  if (lang === 'en') s = s.replace(/(^|\s)i(?=['’\s])/g, '$1I')
  if (plain && /[\p{L}\p{N}]$/u.test(s.trim()) && s.trim().split(/\s+/).length > 3) s = `${s.trimEnd()}.`
  return s
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [text]
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '')
}

function titleOf(context: string | undefined, lang: Lang): string {
  const t = context?.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return t ? t.slice(0, 80) : lang === 'de' ? 'Diese Seite' : 'This page'
}

/** "Draft an outline about X" → X (the prefill text, in either language). */
function topicOf(instruction: string, lang: Lang): string {
  const t = instruction
    .replace(/^(draft an outline (about|for|on)|brainstorm ideas (for|about)|entwirf eine gliederung (zu|für|über)|sammle ideen (für|zu))\s*/i, '')
    .replace(/[.?!]+$/, '')
    .trim()
  return t || (lang === 'de' ? 'das Thema' : 'the topic')
}

/** The demo answer for an action (Markdown). */
export function demoAnswer(req: DemoRequest, lang: Lang): string {
  const c = CANNED[lang]
  const input = req.input.trim()
  const title = titleOf(req.context, lang)
  switch (req.action) {
    case 'continue':
      return input ? c.continue : fill(c.continueEmpty, { title })
    case 'summarize':
      return fill(c.summarize, { title })
    case 'action_items':
      return fill(c.action_items, { title: title === 'This page' || title === 'Diese Seite' ? (lang === 'de' ? 'die Seite' : 'the page') : `“${title}”` })
    case 'explain':
      return c.explain
    case 'translate':
      return fill(c.translate, { lang: req.instruction?.trim() || 'English' })
    case 'fix':
      return input ? eachLine(input, (s, plain) => tidy(s, lang, plain)) : c.custom
    case 'improve':
      return input ? eachLine(input, (s, plain) => tidy(s.replace(FILLER[lang], ''), lang, plain)) : c.custom
    case 'shorter': {
      if (!input) return c.custom
      return eachLine(input, (s, plain) => {
        const all = sentences(s.replace(FILLER[lang], ''))
        return tidy(all.slice(0, Math.max(1, Math.ceil(all.length / 2))).join(' '), lang, plain)
      })
    }
    case 'longer':
      return input ? `${input}\n\n${c.longer}` : c.longer
    case 'custom': {
      const ask = req.instruction?.trim() ?? ''
      if (/outline|gliederung/i.test(ask)) {
        const topic = topicOf(ask, lang)
        return fill(c.outline, { topic: topic.charAt(0).toUpperCase() + topic.slice(1) })
      }
      if (/brainstorm|ideen|ideas/i.test(ask)) return fill(c.brainstorm, { topic: topicOf(ask, lang) })
      return c.custom
    }
    default:
      return c.custom
  }
}

/* ---------------- Ask your workspace ---------------- */

export interface DemoDoc {
  title: string
  text: string
}

/** Crude stem, so "owns" finds "Owner" and "launches" finds "launch". */
const stem = (w: string) => (w.length > 3 ? w.replace(/(ing|es|ed|er|en|s)$/, '') : w)

/** Row facts ("Status: Done; Owner: Alex; …"): the ones the question asks about, else the first three. */
function pickFacts(line: string, stems: string[]): string {
  const facts = line.split('; ')
  if (facts.length < 3 || !facts.every((f) => /^[^:]{1,40}: /.test(f))) return line
  const asked = facts.filter((f) => stems.some((w) => f.toLowerCase().includes(w)))
  return (asked.length ? asked : facts.slice(0, 3)).join('; ')
}

/** The line of a page that best matches the question's keywords (prose and row facts, not code). */
function bestSentence(doc: DemoDoc, words: string[]): string {
  const stems = words.map(stem).filter((w) => w.length >= 3)
  const parts = doc.text
    .replace(/^(Entry in database "[^"]*"\.\s*)/, '')
    .split(/\n+|(?<=[.!?])\s+(?=\p{Lu})/u)
    .map((s) => s.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').replace(/(^|\s)@(?=\p{L})/gu, '$1').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 12 && !/^(Database with|Datenbank mit)/.test(s) && (s.match(/[{}"=<>`]/g)?.length ?? 0) < 3)
  if (!parts.length) return ''
  let best = parts[0]
  let score = -1
  for (const s of parts) {
    const low = s.toLowerCase()
    const sc = stems.reduce((n, w) => n + (low.includes(w) ? 2 : 0), 0) + (s.split(' ').length >= 5 ? 1 : 0)
    if (sc > score) {
      score = sc
      best = s
    }
  }
  best = pickFacts(best, stems)
  if (best.length <= 170) return best
  const cut = best.slice(0, 170)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 120))}…`
}

/** Answer from the locally retrieved pages, citing them as [[Title]] (max three). */
export function demoWorkspaceAnswer(question: string, hits: DemoDoc[], words: string[], lang: Lang): string {
  const q = question.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (!hits.length)
    return lang === 'de'
      ? `Keine Seite in diesem Workspace passt zu „${q}“. Versuch es mit einem Wort, das in einem Seitentitel vorkommt.`
      : `No page in this workspace matches “${q}”. Try a word that appears in a page title.`
  const cited = hits.slice(0, 3).map((d) => {
    const s = bestSentence(d, words)
    const title = d.title.replace(/[[\]\n]/g, ' ').trim()
    return s ? `- ${s} [[${title}]]` : `- [[${title}]]`
  })
  const head =
    lang === 'de'
      ? `${hits.length === 1 ? 'Eine Seite passt' : `${hits.length} Seiten passen`} zu „${q}“. Die nächsten Treffer:`
      : `${hits.length === 1 ? 'One page matches' : `${hits.length} pages match`} “${q}”. The closest:`
  return `${head}\n\n${cited.join('\n')}`
}
