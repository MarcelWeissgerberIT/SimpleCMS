/**
 * Plain text → Markdown without HTML entities: "A & B <tag>" reads as "A & B \<tag>", not
 * "A &amp; B &lt;tag&gt;" (Copy as Markdown, .md export and AI input are read by people and models).
 * Everything that could change meaning on the way back is backslash-escaped instead:
 *  - inline syntax  \ ` * _ [ ] ~   (same set @tiptap/markdown escapes)
 *  - "<"            would open raw HTML / an autolink
 *  - "&"            only where it would read as an entity ("&amp;", "&#39;" …)
 *  - ">"            only at a line start, where it would open a blockquote
 * Code spans and code blocks never come through here — they stay verbatim.
 */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/([\\`*_[\]~<])/g, '\\$1')
    .replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g, '\\&')
    .replace(/(^|\n)([ \t]*)>/g, '$1$2\\>')
}

/** A link title inside "…": only the quote and backslash need escaping. */
export function escapeMarkdownTitle(text: string): string {
  return text.replace(/["\\]/g, '\\$&')
}
