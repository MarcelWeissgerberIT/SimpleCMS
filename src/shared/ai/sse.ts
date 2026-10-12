/**
 * A Server-Sent Events parser (WHATWG event-stream interpretation), pure: the transport feeds it decoded text in
 * whatever pieces the network delivers (TextDecoder with `stream: true`), it dispatches whole events.
 *  - line ends LF, CRLF or CR (a CR at the end of one piece and an LF at the start of the next are one line end);
 *  - a byte-order mark at the very start is skipped;
 *  - lines starting with ':' are comments (OpenRouter's ": OPENROUTER PROCESSING" keep-alive) — skipped, reported;
 *  - fields `event`, `data` (several lines joined with "\n"), `id`, `retry` (read, not acted on); unknown fields ignored;
 *  - a blank line dispatches (nothing without data); `end()` dispatches a last event that had no blank line after it;
 *  - "[DONE]" is data like any other — the wire decides what it means.
 */

export interface SSEEvent {
  event?: string
  data: string
  id?: string
}

export interface SSEParser {
  feed(text: string): void
  end(): void
}

export function createSSEParser(onEvent: (e: SSEEvent) => void, onComment?: (text: string) => void): SSEParser {
  let buf = ''
  let started = false
  /** the previous piece ended with a CR: an LF at the start of this one belongs to it */
  let skipLF = false
  let data: string[] = []
  let hasData = false
  let event: string | undefined
  let id: string | undefined

  const dispatch = () => {
    if (hasData) onEvent({ ...(event !== undefined ? { event } : {}), data: data.join('\n'), ...(id !== undefined ? { id } : {}) })
    data = []
    hasData = false
    event = undefined
  }

  const line = (l: string) => {
    if (l === '') return dispatch()
    if (l.startsWith(':')) {
      onComment?.(l.slice(1).replace(/^ /, ''))
      return
    }
    const at = l.indexOf(':')
    const field = at < 0 ? l : l.slice(0, at)
    let value = at < 0 ? '' : l.slice(at + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') {
      data.push(value)
      hasData = true
    } else if (field === 'event') event = value
    else if (field === 'id') {
      if (!value.includes('\0')) id = value
    }
    // 'retry' and unknown fields: nothing to do
  }

  return {
    feed(text: string) {
      if (!text) return
      let t = text
      if (!started) {
        started = true
        if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
      }
      if (skipLF && t.startsWith('\n')) t = t.slice(1)
      skipLF = false
      buf += t
      let i = 0
      for (;;) {
        const cr = buf.indexOf('\r', i)
        const lf = buf.indexOf('\n', i)
        if (cr < 0 && lf < 0) break
        const at = cr < 0 ? lf : lf < 0 ? cr : Math.min(cr, lf)
        line(buf.slice(i, at))
        if (buf[at] === '\r') {
          if (at + 1 < buf.length) i = buf[at + 1] === '\n' ? at + 2 : at + 1
          else {
            // the CR ends this piece: its LF may come with the next one
            skipLF = true
            i = at + 1
          }
        } else i = at + 1
      }
      buf = buf.slice(i)
    },
    end() {
      if (buf) line(buf)
      buf = ''
      dispatch()
    },
  }
}
