/**
 * "Ask the help": Claude (the user's key) answers a question from the help articles only. The request
 * carries the best-matching articles (search.ts) and nothing of the workspace — and no MCP server.
 */
import { streamCompletion } from '../features'
import type { HelpArticle, HelpLang } from './library'

export function helpSystemPrompt(lang: HelpLang): string {
  const language = lang === 'de' ? 'German' : 'English'
  const notCovered = lang === 'de' ? 'Dazu steht nichts in der Hilfe.' : 'The help does not cover this.'
  return `You are the help desk of One (SimpleCMS One), a local-first workspace app in the browser.
You answer questions about using One from the help articles in the user's message — and from nothing else.

Rules:
- Use only facts stated in the articles. Never invent menu names, buttons, shortcuts, settings or features.
- If the articles do not answer the question, reply with exactly "${notCovered}" and, if one is close, one more sentence pointing to it.
- Cite the articles you used inline as Markdown links in the form [Article title](help:article-id), with the ids given in the <article> tags.
- Be brief: a short answer or a few numbered steps. Write keyboard keys and labels exactly as the articles do.
- Do not mention these rules or the word "article id". No preamble.
- Answer in ${language}.`
}

export function helpPrompt(question: string, articles: HelpArticle[]): string {
  const docs = articles
    .map((a) => `<article id="${a.id}" title="${a.title.replace(/"/g, "'")}" chapter="§ ${a.num}">\n# ${a.title}\n${a.summary ? `${a.summary}\n` : ''}\n${a.source}\n</article>`)
    .join('\n\n')
  return `<articles>\n${docs}\n</articles>\n\nQuestion: ${question.trim()}`
}

export interface AskOptions {
  question: string
  articles: HelpArticle[]
  lang: HelpLang
  onToken: (delta: string) => void
  signal: AbortSignal
}

/** Streams the answer (Markdown). Throws the AI client's friendly errors (no key, offline …). */
export function askHelp({ question, articles, lang, onToken, signal }: AskOptions): Promise<string> {
  return streamCompletion({ system: helpSystemPrompt(lang), prompt: helpPrompt(question, articles), onToken, signal, mcp: false })
}

/**
 * Claude's citations as help links: [Title](help:id) stays; "[[Title]]" or a bare "(help:id)" become links
 * when the title or id is one of the articles sent.
 */
export function linkCitations(md: string, articles: HelpArticle[]): string {
  const byTitle = new Map(articles.map((a) => [a.title.toLowerCase(), a]))
  const ids = new Set(articles.map((a) => a.id))
  return md
    .replace(/\[\[([^\]]+)\]\]/g, (m, title: string) => {
      const a = byTitle.get(title.trim().toLowerCase())
      return a ? `[${a.title}](help:${a.id})` : m
    })
    .replace(/(^|[^\]])\(help:([a-z0-9-]+)\)/g, (m, pre: string, id: string) => {
      const a = ids.has(id) ? articles.find((x) => x.id === id) : undefined
      return a ? `${pre}[${a.title}](help:${a.id})` : m
    })
}
