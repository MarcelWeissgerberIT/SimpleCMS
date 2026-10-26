type Message = { role: 'system' | 'user' | 'assistant'; content: string }

const OMITTED = '\n[Harness context excerpt: tool result shortened. Do not infer omitted facts; request a narrower source if needed.]'

/** Fit a local inference round without changing its task, system, tool arguments or saved history.
 * Only results of preceding, explicitly linked tool calls may be excerpted. Older results go first;
 * the latest result retains a larger prefix. Every call/result pair stays closed. No model summary
 * is invented and the original messages stay available to the browser's run history. */
export function fitLocalToolContext<T extends Message>(messages: T[], fits: (messages: T[]) => boolean): T[] {
  if (fits(messages)) return messages
  const next = messages.map(m => ({ ...m }))
  const calls = new Set<string>()
  const results: Array<{ text: string; set: (text: string) => void }> = []
  for (const message of next) {
    let parsed: any
    try { parsed = JSON.parse(message.content) } catch { continue }
    if (message.role === 'assistant') {
      const listed = Array.isArray(parsed) ? parsed.filter(b => b?.type === 'tool_use').map(b => ({ id: b.id })) : parsed?.tool_calls
      if (Array.isArray(listed)) for (const call of listed) if (typeof call?.id === 'string') calls.add(call.id)
    } else if (message.role === 'user') {
      const listed = Array.isArray(parsed) ? parsed.filter(b => b?.type === 'tool_result') : parsed?.tool_result ? [parsed.tool_result] : []
      for (const result of listed) {
        const id = result.tool_use_id ?? result.id
        if (!calls.has(id) || typeof result.content !== 'string') continue
        results.push({ text: result.content, set(text) { result.content = text; message.content = JSON.stringify(parsed) } })
      }
    }
  }
  for (const [index, result] of results.entries()) {
    const minimum = index === results.length - 1 ? 512 : 128
    if (result.text.length <= minimum + OMITTED.length) continue
    const excerpt = (end: number) => {
      // Never split a UTF-16 surrogate pair when selecting the prefix.
      if (end > 0 && /[\uD800-\uDBFF]/.test(result.text.charAt(end - 1))) end--
      return result.text.slice(0, end) + OMITTED
    }
    result.set(excerpt(minimum))
    if (!fits(next)) continue
    // Keep as much real source as the exact serialized wire budget permits (UTF-8 + escaping).
    let low = minimum, high = result.text.length - OMITTED.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      result.set(excerpt(mid))
      if (fits(next)) low = mid
      else high = mid - 1
    }
    result.set(excerpt(low))
    return next
  }
  // Never discard the person's question or silently clip their source to make a request fit.
  throw new RangeError('Local context is full. Start a fresh task or select a smaller source passage; no further model request was sent.')
}
