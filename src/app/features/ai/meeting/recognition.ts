/**
 * The browser's speech recognition (Web Speech API: `SpeechRecognition` / `webkitSpeechRecognition`),
 * continuous with interim results. Engines stop on their own (silence, network hiccups, about a
 * minute of audio in Chrome): while recording is wanted, a stopped engine is restarted at once;
 * only repeated quick failures end the run with an error.
 *
 * Audio never passes through this app: the browser captures and recognises it (Chrome sends it
 * to Google's servers for that). We only receive text.
 */

export type SpeechErrorCode = 'denied' | 'no-mic' | 'network' | 'language' | 'stalled' | 'unsupported'

interface SpeechAlternative {
  transcript: string
}
interface SpeechResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechAlternative
}
interface SpeechResultList {
  readonly length: number
  [index: number]: SpeechResult
}
interface SpeechEvent {
  resultIndex: number
  results: SpeechResultList
}
interface SpeechErrorEvent {
  error: string
}
interface SpeechRec {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((e: SpeechEvent) => void) | null
  onerror: ((e: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechCtor = new () => SpeechRec

export function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return !!speechCtor()
}

/** Who recognises the audio, for the privacy line (best guess from the user agent). */
export function speechVendor(): 'google' | 'microsoft' | 'apple' | 'browser' {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Edg\//.test(ua)) return 'microsoft'
  if (/Chrome\/|CriOS\//.test(ua)) return 'google'
  if (/Safari\//.test(ua) && /Apple/.test(typeof navigator !== 'undefined' ? navigator.vendor : '')) return 'apple'
  return 'browser'
}

/** Engine error → our code. null: benign (silence, our own abort) — the run goes on. */
function mapError(error: string): SpeechErrorCode | 'transient' | null {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied'
    case 'audio-capture':
      return 'no-mic'
    case 'language-not-supported':
      return 'language'
    case 'network':
      return 'transient'
    case 'no-speech':
    case 'aborted':
    case 'bad-grammar':
      return null
    default:
      return 'transient'
  }
}

export interface RecognizerHandlers {
  /** The engine listens (after the microphone permission) — called once per start(). */
  onStart: () => void
  /** A finished phrase. */
  onFinal: (text: string) => void
  /** The phrase being spoken right now ('' = none). */
  onInterim: (text: string) => void
  /** The run ended for good: stop() was called (error null) or a fatal error. */
  onEnd: (error: SpeechErrorCode | null) => void
}

/** Restarts without a result in a row before we give up. */
const MAX_QUICK_RESTARTS = 6

export class Recognizer {
  private rec: SpeechRec | null = null
  private wanted = false
  private announced = false
  private fatal: SpeechErrorCode | null = null
  private lastTransient = false
  private quick = 0
  private heard = false
  private startedAt = 0
  private timer: number | undefined
  private lang: string
  private h: RecognizerHandlers

  constructor(lang: string, handlers: RecognizerHandlers) {
    this.lang = lang
    this.h = handlers
  }

  start(): void {
    this.wanted = true
    this.announced = false
    this.fatal = null
    this.quick = 0
    this.spawn()
  }

  /** Stop listening; phrases in flight still arrive as finals before onEnd. */
  stop(): void {
    this.wanted = false
    window.clearTimeout(this.timer)
    if (this.rec) {
      try {
        this.rec.stop()
      } catch {
        this.finish(null)
      }
    } else this.finish(null)
  }

  /** Drop everything now (block deleted, page gone). */
  abort(): void {
    this.wanted = false
    window.clearTimeout(this.timer)
    const rec = this.rec
    this.rec = null
    if (rec) {
      rec.onend = rec.onresult = rec.onerror = rec.onstart = null
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
    }
  }

  private finish(error: SpeechErrorCode | null) {
    this.rec = null
    this.h.onInterim('')
    this.h.onEnd(error)
  }

  private spawn() {
    const Ctor = speechCtor()
    if (!Ctor) return this.finish('unsupported')
    let rec: SpeechRec
    try {
      rec = new Ctor()
    } catch {
      return this.finish('unsupported')
    }
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    let finalUpTo = 0
    this.heard = false
    rec.onstart = () => {
      if (this.announced) return
      this.announced = true
      this.h.onStart()
    }
    rec.onresult = (e) => {
      this.heard = true
      this.quick = 0
      let interim = ''
      for (let i = Math.min(e.resultIndex, finalUpTo); i < e.results.length; i++) {
        const r = e.results[i]
        const text = (r?.[0]?.transcript ?? '').trim()
        if (r.isFinal) {
          if (i >= finalUpTo) {
            finalUpTo = i + 1
            if (text) this.h.onFinal(text)
          }
        } else if (text) interim = interim ? `${interim} ${text}` : text
      }
      this.h.onInterim(interim)
    }
    rec.onerror = (e) => {
      const code = mapError(e.error)
      if (code === 'transient') this.lastTransient = true
      else if (code) this.fatal = code
    }
    rec.onend = () => {
      if (this.rec !== rec) return
      this.rec = null
      this.h.onInterim('')
      if (this.fatal) return this.finish(this.fatal)
      if (!this.wanted) return this.finish(null)
      // the engine stopped by itself: start again (back off when it keeps failing right away)
      const quickEnd = !this.heard && Date.now() - this.startedAt < 2500
      this.quick = quickEnd ? this.quick + 1 : 0
      if (this.quick >= MAX_QUICK_RESTARTS) return this.finish(this.lastTransient ? 'network' : 'stalled')
      this.timer = window.setTimeout(() => this.wanted && this.spawn(), this.quick ? 250 * this.quick : 40)
    }
    this.rec = rec
    this.startedAt = Date.now()
    this.lastTransient = false
    try {
      rec.start()
    } catch {
      this.rec = null
      this.finish('unsupported')
    }
  }
}
