/**
 * Tiny WebAudio synth for the smash — no audio files. Every sound is synthesized:
 * whoosh (swept noise), metallic clang (inharmonic partials), crack (filtered noise
 * crackle), low boom, glass shatter and a pre-impact rumble.
 * Browsers only allow audio after a user gesture: `unlock()` is called on the first
 * pointerdown/keydown; `ready()` resolves false when audio cannot run. Never throws.
 */
type Ctx = AudioContext

export class Sfx {
  private ctx: Ctx | null = null
  private out: GainNode | null = null
  private wet: GainNode | null = null
  private noise: AudioBuffer | null = null
  private rumbleNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null

  /** Create/resume the context inside a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) this.init()
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    } catch {
      /* no audio */
    }
  }

  /** True when sound can actually play (context running). Waits at most `timeoutMs`. */
  async ready(timeoutMs = 160): Promise<boolean> {
    try {
      if (!this.ctx) {
        const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
        if (!ua?.hasBeenActive) return false
        this.init()
      }
      const ctx = this.ctx
      if (!ctx) return false
      if (ctx.state !== 'running') {
        await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))])
      }
      return ctx.state === 'running'
    } catch {
      return false
    }
  }

  get on(): boolean {
    return !!this.ctx && this.ctx.state === 'running'
  }

  private init() {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    comp.attack.value = 0.002
    comp.release.value = 0.2
    const out = ctx.createGain()
    out.gain.value = 0.75
    out.connect(comp).connect(ctx.destination)
    this.out = out
    // Synthetic room reverb.
    const conv = ctx.createConvolver()
    const len = Math.floor(ctx.sampleRate * 1.6)
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    conv.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = 0.22
    wet.connect(conv).connect(out)
    this.wet = wet
    const nlen = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate)
    const nd = this.noise.getChannelData(0)
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1
  }

  private safe(fn: (ctx: Ctx, out: GainNode, wet: GainNode, noise: AudioBuffer) => void) {
    if (!this.on || !this.ctx || !this.out || !this.wet || !this.noise) return
    try {
      fn(this.ctx, this.out, this.wet, this.noise)
    } catch {
      /* ignore */
    }
  }

  private noiseSrc(ctx: Ctx, noise: AudioBuffer, t0: number, dur: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.start(t0, Math.random() * 1.2, dur + 0.05)
    return src
  }

  whoosh(dur = 0.3, panFrom = 0.6, panTo = -0.3, gainAmt = 0.5): void {
    this.safe((ctx, out, _wet, noise) => {
      const t0 = ctx.currentTime
      const src = this.noiseSrc(ctx, noise, t0, dur)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 0.9
      bp.frequency.setValueAtTime(260, t0)
      bp.frequency.exponentialRampToValueAtTime(2600, t0 + dur * 0.8)
      bp.frequency.exponentialRampToValueAtTime(900, t0 + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(gainAmt, t0 + dur * 0.78)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      const p = ctx.createStereoPanner()
      p.pan.setValueAtTime(panFrom, t0)
      p.pan.linearRampToValueAtTime(panTo, t0 + dur)
      src.connect(bp).connect(g).connect(p).connect(out)
    })
  }

  clang(power = 1): void {
    this.safe((ctx, out, wet, noise) => {
      const t0 = ctx.currentTime
      const f0 = 290 + Math.random() * 40
      const ratios = [1, 2.76, 5.4, 8.93, 13.34, 17.2]
      ratios.forEach((r, i) => {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.01)
        const g = ctx.createGain()
        const amp = (0.32 / (1 + i * 0.7)) * power
        const decay = 1.4 / (1 + i * 0.9)
        g.gain.setValueAtTime(amp, t0)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
        o.connect(g)
        g.connect(out)
        g.connect(wet)
        o.start(t0)
        o.stop(t0 + decay + 0.05)
      })
      // transient
      const src = this.noiseSrc(ctx, noise, t0, 0.05)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 2500
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.7 * power, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05)
      src.connect(hp).connect(g).connect(out)
      // body thump
      const th = ctx.createOscillator()
      th.frequency.setValueAtTime(140, t0)
      th.frequency.exponentialRampToValueAtTime(48, t0 + 0.16)
      const tg = ctx.createGain()
      tg.gain.setValueAtTime(0.7 * power, t0)
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
      th.connect(tg).connect(out)
      th.start(t0)
      th.stop(t0 + 0.25)
    })
  }

  crack(power = 1, count = 10, spread = 0.16): void {
    this.safe((ctx, out, wet, noise) => {
      const t0 = ctx.currentTime
      for (let i = 0; i < count; i++) {
        const t = t0 + Math.random() * spread
        const dur = 0.006 + Math.random() * 0.02
        const src = this.noiseSrc(ctx, noise, t, dur)
        const hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 1600 + Math.random() * 3600
        const g = ctx.createGain()
        g.gain.setValueAtTime((0.25 + Math.random() * 0.45) * power, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        const p = ctx.createStereoPanner()
        p.pan.value = Math.random() * 1.4 - 0.7
        src.connect(hp).connect(g).connect(p)
        p.connect(out)
        p.connect(wet)
      }
    })
  }

  boom(): void {
    this.safe((ctx, out, wet, noise) => {
      const t0 = ctx.currentTime
      const o = ctx.createOscillator()
      o.frequency.setValueAtTime(82, t0)
      o.frequency.exponentialRampToValueAtTime(30, t0 + 1.2)
      const shaper = ctx.createWaveShaper()
      const curve = new Float32Array(1024)
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1
        curve[i] = Math.tanh(2.6 * x)
      }
      shaper.curve = curve
      const g = ctx.createGain()
      g.gain.setValueAtTime(1.1, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5)
      o.connect(shaper).connect(g).connect(out)
      o.start(t0)
      o.stop(t0 + 1.6)
      const src = this.noiseSrc(ctx, noise, t0, 0.9)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(900, t0)
      lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.8)
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.9, t0)
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
      src.connect(lp).connect(ng)
      ng.connect(out)
      ng.connect(wet)
    })
  }

  shatter(): void {
    this.safe((ctx, out, wet, noise) => {
      const t0 = ctx.currentTime
      const src = this.noiseSrc(ctx, noise, t0, 0.8)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 2200
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.55, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8)
      src.connect(hp).connect(g)
      g.connect(out)
      g.connect(wet)
      for (let i = 0; i < 46; i++) {
        const t = t0 + 0.05 + Math.pow(Math.random(), 1.6) * 1.5
        const o = ctx.createOscillator()
        o.type = Math.random() < 0.5 ? 'sine' : 'triangle'
        o.frequency.value = 2400 + Math.random() * 5200
        const og = ctx.createGain()
        const d = 0.03 + Math.random() * 0.12
        og.gain.setValueAtTime(0.04 + Math.random() * 0.1, t)
        og.gain.exponentialRampToValueAtTime(0.0001, t + d)
        const p = ctx.createStereoPanner()
        p.pan.value = Math.random() * 2 - 1
        o.connect(og).connect(p)
        p.connect(out)
        p.connect(wet)
        o.start(t)
        o.stop(t + d + 0.02)
      }
    })
  }

  rumble(on: boolean): void {
    if (!on) {
      const r = this.rumbleNodes
      this.rumbleNodes = null
      if (r && this.ctx) {
        try {
          const t = this.ctx.currentTime
          r.gain.gain.cancelScheduledValues(t)
          r.gain.gain.setTargetAtTime(0, t, 0.03)
          r.src.stop(t + 0.2)
        } catch {
          /* ignore */
        }
      }
      return
    }
    if (this.rumbleNodes) return
    this.safe((ctx, out, _wet, noise) => {
      const t0 = ctx.currentTime
      const src = ctx.createBufferSource()
      src.buffer = noise
      src.loop = true
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 90
      lp.Q.value = 4
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.5, t0 + 2)
      src.connect(lp).connect(g).connect(out)
      src.start(t0)
      this.rumbleNodes = { src, gain: g }
    })
  }

  /** Let tails ring out, then release the context. */
  dispose(): void {
    this.rumble(false)
    const ctx = this.ctx
    this.ctx = null
    if (ctx) window.setTimeout(() => void ctx.close().catch(() => {}), 2600)
  }
}
