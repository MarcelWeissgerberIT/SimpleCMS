/**
 * Pasted transcripts (Zoom, Google Meet, Microsoft Teams exports, or plain notes) → segments.
 *  - WebVTT / SRT: one segment per cue, "<v Ada>" voice tags become "Ada: …"
 *  - timestamped lines: "00:01:23 Ada: …", "[12:04] …", "(1:02:03) …", "Ada 12:04" header lines
 *  - anything else: one segment per non-empty line, without a time
 */
import type { TranscriptSegment } from '../../../editor'

const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?`
const CUE = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`)
const LEADING = new RegExp(String.raw`^\s*[[(]?${TIME}[\])]?\s*[-–—:|]?\s*`)
/** Teams / Zoom style: a speaker line ending in a time ("Ada Lovelace   12:04", "[Ada] 14:02:11"), the words on the next line. */
const SPEAKER_HEAD = new RegExp(String.raw`^\s*\[?(\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,3})\]?\s+[[(]?${TIME}[\])]?\s*$`, 'u')

function ms(h: string | undefined, m: string, s: string): number {
  return ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000
}

const clean = (s: string) =>
  s
    .replace(/<v\s+([^>]+)>/gi, '$1: ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function parseCues(lines: string[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = CUE.exec(lines[i])
    if (!m) continue
    const text: string[] = []
    while (i + 1 < lines.length && lines[i + 1].trim()) text.push(lines[++i])
    const line = clean(text.join(' '))
    if (line) out.push({ t: ms(m[1], m[2], m[3]), text: line })
  }
  return out
}

function parseLines(lines: string[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  let last = 0
  let speaker: { name: string; t: number } | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || /^WEBVTT/i.test(line) || /^\d+$/.test(line)) continue
    const head = SPEAKER_HEAD.exec(line)
    if (head && !LEADING.test(line)) {
      speaker = { name: head[1].trim(), t: ms(head[2], head[3], head[4]) }
      last = speaker.t
      continue
    }
    const lead = LEADING.exec(line)
    if (lead) {
      last = ms(lead[1], lead[2], lead[3])
      const text = clean(line.slice(lead[0].length))
      if (text) out.push({ t: last, text })
      speaker = null
      continue
    }
    const text = clean(line)
    if (!text) continue
    if (speaker) {
      out.push({ t: speaker.t, text: `${speaker.name}: ${text}` })
      speaker = null
    } else out.push({ t: last, text })
  }
  return out
}

/** Segments of a pasted transcript (empty when there is no text). */
export function parseTranscript(input: string): TranscriptSegment[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const cues = lines.some((l) => CUE.test(l)) ? parseCues(lines) : []
  return cues.length ? cues : parseLines(lines)
}
