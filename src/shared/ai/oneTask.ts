/** Inspect only the current human instruction, never retrieved content or conversation history. */
export function oneOnlyTask(goal: string): boolean {
  const text = goal.normalize('NFKC').replace(/["“„`][^"“”„`]*["”`]/gu, '').toLowerCase()
  return /^\s*\/(?:ba|po)(?:\s|$)/u.test(text)
    || /\b(?:nur|ausschließlich|ausschliesslich|only|exclusively)\s+(?:(?:in|mit|within|using)\s+)?one\b/u.test(text)
}

/** An explicit ONE destination is not an instruction to write to Atlas mentioned as a source. */
export function onePageDestination(goal: string): boolean {
  const text = goal.normalize('NFKC').toLowerCase()
  return /(?:\b(?:in|im|within)\s+one\b.{0,60}\b(?:seite\w*|page\w*)\b|\b(?:seite\w*|page\w*)\b.{0,60}\b(?:in|im|within)\s+one\b)/u.test(text)
    && !/(?:nach\s+atlas|to\s+atlas|in\s+atlas\s+(?:speichern|anlegen|erstellen|kommentieren|aktualisieren))/u.test(text)
}
