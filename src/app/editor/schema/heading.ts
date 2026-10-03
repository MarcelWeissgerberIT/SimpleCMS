/**
 * Heading node with a DOM outline offset.
 *
 * The JSON contract is unchanged (`heading`, attrs.level 1–3). Only the rendered tag moves:
 * with `outlineOffset: 1` a Heading 1 block renders as <h2>, H2 as <h3>, H3 as <h4>, so the
 * page title stays the only <h1> and the outline nests under it (Notion does the same).
 * Every heading carries `data-level` (the JSON level): styling keys off it, and copy → paste
 * round-trips the real level instead of reading it back from the shifted tag.
 */
import { mergeAttributes } from '@tiptap/core'
import { Heading, type HeadingOptions, type Level } from '@tiptap/extension-heading'

export interface OutlineHeadingOptions extends HeadingOptions {
  /** Added to the level for the DOM tag (0 = plain h1–h3, 1 = h2–h4 under a page title). */
  outlineOffset: number
}

export const OutlineHeading = Heading.extend<OutlineHeadingOptions>({
  addOptions() {
    return { ...(this.parent?.() as HeadingOptions), outlineOffset: 0 }
  },

  parseHTML() {
    const levels = this.options.levels
    const fromData = (el: HTMLElement) => {
      const level = Number(el.getAttribute('data-level')) as Level
      return levels.includes(level) ? { level } : false
    }
    // our own HTML first (clipboard, ReadOnlyDoc, export): data-level wins over the tag;
    // anything else falls through to the plain h1–h3 rules
    const own = [1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}[data-level]`, priority: 60, getAttrs: fromData }))
    return [...own, ...(this.parent?.() ?? [])]
  },

  renderHTML({ node, HTMLAttributes }) {
    const levels = this.options.levels
    const level: Level = levels.includes(node.attrs.level) ? node.attrs.level : levels[0]
    const tag = `h${Math.min(6, level + Math.max(0, this.options.outlineOffset))}`
    return [tag, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-level': String(level) }), 0]
  },
})
