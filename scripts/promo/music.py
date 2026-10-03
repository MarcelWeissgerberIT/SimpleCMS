#!/usr/bin/env python3
"""
Synthesises the promo soundtrack (48 kHz stereo WAV) — every sound is generated here, so the
music is original and free of licences.

    python3 scripts/promo/music.py cues.json out.wav

cues.json: {"length", "hammer", "hits": [t1, t2, t3], "drop", "end_card", "final"}  (seconds)

Sections:  1997 MIDI homepage jingle → tape stop → hammer impacts → ticking clock →
           120 BPM electro groove (kick, clap, hats, rolling bass, stabs, pad, arp) → final hit.
"""
import json
import sys

import numpy as np
from scipy import signal

SR = 48000
rng = np.random.default_rng(1997)


def t_axis(n):
    return np.arange(n) / SR


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def saw(freq, n, detune=0.0):
    """Band-limited sawtooth via additive synthesis."""
    t = t_axis(n)
    f = freq * (1 + detune)
    out = np.zeros(n)
    k = 1
    while f * k < 16000 and k < 80:
        out += np.sin(2 * np.pi * f * k * t) / k
        k += 1
    return out * (2 / np.pi)


def square(freq, n, duty=0.5):
    t = t_axis(n)
    out = np.zeros(n)
    k = 1
    while freq * k < 15000 and k < 60:
        out += np.sin(np.pi * k * duty) * np.cos(2 * np.pi * freq * k * t - np.pi * k * duty) * 2 / (np.pi * k)
        k += 1
    return out


def env_adsr(n, a=0.005, d=0.1, s=0.6, r=0.05):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([
        np.linspace(0, 1, max(1, a_n), endpoint=False),
        np.linspace(1, s, max(1, d_n), endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, max(1, r_n)),
    ])
    return np.pad(e, (0, max(0, n - len(e))))[:n]


def lp(x, cutoff, order=2):
    sos = signal.butter(order, min(cutoff, SR / 2 - 100) / (SR / 2), 'low', output='sos')
    return signal.sosfilt(sos, x)


def hp(x, cutoff, order=2):
    sos = signal.butter(order, cutoff / (SR / 2), 'high', output='sos')
    return signal.sosfilt(sos, x)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos')
    return signal.sosfilt(sos, x)


class Track:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.buf = np.zeros((self.n, 2))

    def add(self, x, at, gain=1.0, pan=0.0):
        i = int(at * SR)
        if i >= self.n or len(x) == 0:
            return
        x = x[: self.n - i]
        if x.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            x = np.stack([x * l, x * r], axis=1) * np.sqrt(2)
        self.buf[i : i + len(x)] += x * gain


def reverb_ir(seconds=1.8, damp=6000):
    n = int(seconds * SR)
    t = t_axis(n)
    ir = rng.standard_normal((n, 2)) * np.exp(-t * 4.2)[:, None]
    ir[:, 0] = lp(ir[:, 0], damp)
    ir[:, 1] = lp(ir[:, 1], damp)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]
    return ir / np.sqrt((ir ** 2).sum() / 2)


def convolve_stereo(x, ir):
    return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)


# ------------------------------------------------------------------ instruments
def kick(gain=1.0):
    n = int(0.42 * SR)
    t = t_axis(n)
    f = 46 + 110 * np.exp(-t * 38)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t * 260) * 0.25
    return np.tanh((body + click) * 1.6) * gain


def clap():
    n = int(0.32 * SR)
    t = t_axis(n)
    noise = bp(rng.standard_normal(n), 900, 4200)
    e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022]):
        i = int(off * SR)
        e[i:] += np.exp(-(t[: n - i]) * (60 if k < 2 else 18))
    return noise * e * 0.6


def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    t = t_axis(n)
    x = hp(rng.standard_normal(n), 7000)
    return x * np.exp(-t * (14 if open_ else 70)) * 0.32


def bass_note(freq, dur):
    n = int(dur * SR)
    raw = saw(freq, n) * 0.6 + np.sin(2 * np.pi * freq * t_axis(n)) * 0.7
    bright = lp(raw, 1400)
    dark = lp(raw, 320)
    t = t_axis(n)
    mix = bright * np.exp(-t * 30) + dark * (1 - np.exp(-t * 30))
    return np.tanh(mix * 1.4) * env_adsr(n, 0.003, 0.05, 0.75, 0.02) * 0.55


def pluck(freqs, dur, bright_hz=5200, decay=9.0):
    n = int(dur * SR)
    t = t_axis(n)
    out = np.zeros((n, 2))
    for f in freqs:
        for c, det in enumerate((-0.004, 0.004)):
            raw = saw(f, n, det) * 0.6 + square(f * 2, n, 0.3) * 0.15
            b = lp(raw, bright_hz)
            d = lp(raw, 700)
            e = np.exp(-t * decay)
            out[:, c] += (b * e + d * (1 - e) * 0.35) * np.exp(-t * 3.2)
    out *= env_adsr(n, 0.002, 0.02, 1, 0.03)[:, None]
    return out / max(1, len(freqs)) * 0.9


def pad(freqs, dur):
    n = int(dur * SR)
    out = np.zeros((n, 2))
    for f in freqs:
        for c, det in enumerate((-0.006, 0.006)):
            out[:, c] += lp(saw(f, n, det), 1100)
    out *= env_adsr(n, 0.45, 0.4, 0.8, 0.6)[:, None]
    return out / len(freqs) * 0.32


def arp_note(freq, dur):
    n = int(dur * SR)
    t = t_axis(n)
    x = lp(square(freq, n, 0.25), 3800) * np.exp(-t * 16) * env_adsr(n, 0.002, 0.01, 1, 0.01)
    return x * 0.22


# ------------------------------------------------------------------ 1997 jingle
def jingle(seconds):
    """Cheesy General-MIDI homepage tune through a cheap soundcard."""
    bpm = 132
    e8 = 60 / bpm / 2
    mel = [72, 76, 79, 84, 83, 79, 76, 79, 74, 77, 81, 77, 76, 72, 74, 71,
           72, 76, 79, 84, 86, 84, 83, 79, 81, 79, 77, 76, 74, 76, 72, 72]
    bass_seq = [48, 55, 48, 55, 50, 57, 47, 55]
    n = int(seconds * SR)
    out = np.zeros(n)
    t_i = 0
    k = 0
    while t_i * e8 < seconds:
        start = int(t_i * e8 * SR)
        note = mel[k % len(mel)]
        ln = int(e8 * 0.9 * SR)
        x = square(midi(note), ln, 0.25) * env_adsr(ln, 0.002, 0.04, 0.55, 0.02) * 0.3
        out[start : start + ln] += x[: max(0, n - start)][: len(out[start : start + ln])]
        if k % 2 == 0:
            bn = bass_seq[(k // 2) % len(bass_seq)]
            bl = int(e8 * 1.6 * SR)
            bx = square(midi(bn), bl, 0.5) * env_adsr(bl, 0.002, 0.08, 0.4, 0.04) * 0.22
            out[start : start + bl] += bx[: len(out[start : start + bl])]
        if k % 4 == 0:  # tinny drum machine
            ln2 = int(0.12 * SR)
            dk = np.sin(2 * np.pi * np.cumsum(90 + 200 * np.exp(-t_axis(ln2) * 40)) / SR) * np.exp(-t_axis(ln2) * 25) * 0.5
            out[start : start + ln2] += dk[: len(out[start : start + ln2])]
        if k % 4 == 2:
            ln2 = int(0.08 * SR)
            sn = bp(rng.standard_normal(ln2), 1500, 5000) * np.exp(-t_axis(ln2) * 40) * 0.35
            out[start : start + ln2] += sn[: len(out[start : start + ln2])]
        t_i += 1
        k += 1
    # cheap soundcard: 11 kHz sample-and-hold + band-limit + a little crunch
    hold = 4
    out = np.repeat(out[::hold], hold)[:n]
    out = bp(out, 180, 4200)
    return np.tanh(out * 1.8) * 0.55


def tape_stop(x, seconds):
    """Pitch/speed ramp down to zero over `seconds` (classic record stop)."""
    n = int(seconds * SR)
    src = x[-n:] if len(x) >= n else x
    speed = np.linspace(1, 0, n) ** 1.6
    pos = np.cumsum(speed)
    pos = np.clip(pos, 0, len(src) - 1)
    return np.interp(pos, np.arange(len(src)), src) * np.linspace(1, 0, n)


# ------------------------------------------------------------------ impacts
def impact(strength=1.0):
    n = int(2.6 * SR)
    t = t_axis(n)
    f = 34 + 70 * np.exp(-t * 9)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (2.2 / strength)) * 0.9
    thump = lp(rng.standard_normal(n), 380) * np.exp(-t * 16) * 1.2
    clang = np.zeros(n)
    for fr, dec, g in [(523, 3.5, 0.35), (1247, 5.0, 0.22), (2311, 7.0, 0.16), (3593, 9.0, 0.12), (5021, 12.0, 0.08)]:
        clang += np.sin(2 * np.pi * fr * (1 + 0.002 * strength) * t) * np.exp(-t * dec) * g
    crack = hp(rng.standard_normal(n), 2500) * np.exp(-t * 55) * 0.9
    debris = np.zeros(n)
    for _ in range(int(14 * strength)):
        at = rng.uniform(0.05, 0.9)
        ln = int(0.05 * SR)
        fr = rng.uniform(2500, 7500)
        ping = np.sin(2 * np.pi * fr * t_axis(ln)) * np.exp(-t_axis(ln) * 70) * rng.uniform(0.04, 0.1)
        i = int(at * SR)
        debris[i : i + ln] += ping
    x = (boom + thump) * strength + clang * (0.6 + 0.4 * strength) + crack * strength + debris
    return np.tanh(x * 1.3)


def whoosh(seconds):
    n = int(seconds * SR)
    t = t_axis(n)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    steps = 40
    for s in range(steps):
        a, b = s * n // steps, (s + 1) * n // steps
        fc = 300 + 5000 * (s / steps) ** 2
        out[a:b] = bp(noise[a:b], fc * 0.6, fc * 1.4)
    return out * np.sin(np.pi * t / seconds) ** 2 * 0.5


def tick():
    n = int(0.05 * SR)
    t = t_axis(n)
    return (np.sin(2 * np.pi * 3200 * t) * 0.5 + hp(rng.standard_normal(n), 4000) * 0.3) * np.exp(-t * 120) * 0.5


def riser(seconds):
    n = int(seconds * SR)
    t = t_axis(n)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    steps = 50
    for s in range(steps):
        a, b = s * n // steps, (s + 1) * n // steps
        fc = 400 + 7000 * (s / steps) ** 2
        out[a:b] = bp(noise[a:b], fc * 0.7, fc * 1.3)
    return out * (t / seconds) ** 2 * 0.45


# ------------------------------------------------------------------ arrangement
def render(cues, path):
    L = cues['length']
    S = cues['hammer']
    hits = cues['hits']
    drop = cues['drop']
    endc = cues['end_card']
    tr = Track(L + 0.5)
    ir = reverb_ir()

    # A — 1997 jingle, then a tape stop as the hammer appears
    j = jingle(S + 0.05)
    stop = tape_stop(j[: int(S * SR)], 0.45)
    j = j[: int((S - 0.45) * SR)]
    tr.add(j, 0.0, 1.0)
    tr.add(stop, S - 0.45, 1.0)

    # B — hammer: whoosh in, three impacts (the last one the biggest), tension drone between
    tr.add(whoosh(hits[0] - S + 0.05), S, 0.55)
    drone_len = hits[2] - S
    dn = int(drone_len * SR)
    dt = t_axis(dn)
    drone = (np.sin(2 * np.pi * 55 * dt) * 0.4 + lp(saw(55, dn), 300) * 0.3) * (dt / drone_len) * 0.6
    tr.add(drone, S, 0.6)
    tr.add(riser(hits[2] - hits[1]), hits[1], 0.5)
    hit_fx = Track(L + 0.5)
    for k, (t_hit, g) in enumerate(zip(hits, [0.7, 0.85, 1.25])):
        x = impact(g)
        tr.add(x, t_hit, 0.62)
        hit_fx.add(x, t_hit, 0.35)

    # C — the "classified" card: a ticking clock and a reversed swell into the drop
    t_c = hits[2] + 0.55
    while t_c < drop - 0.3:
        tr.add(tick(), t_c, 0.55, pan=0.2)
        t_c += 0.5
    tr.add(riser(drop - hits[2] - 0.2)[::1], hits[2] + 0.2, 0.35)

    # D — the groove (120 BPM, bars start at the drop)
    beat = 0.5
    bar = 4 * beat
    s16 = beat / 4
    prog = [  # Am – F – C – G
        (45, [57, 60, 64], [69, 72, 76, 81]),
        (41, [53, 57, 60], [65, 69, 72, 77]),
        (48, [55, 60, 64], [67, 72, 76, 79]),
        (43, [55, 59, 62], [67, 71, 74, 79]),
    ]
    end_groove = cues.get('final', L - 2.6)  # the last hit lands here (brand reveal)
    nbars = int((end_groove - drop) / bar + 0.999)
    bus = Track(L + 0.5)  # elements that get sidechained by the kick
    drums = Track(L + 0.5)
    verb_send = Track(L + 0.5)
    kick_times = []
    for b in range(nbars):
        t0 = drop + b * bar
        if t0 >= end_groove:
            break
        root, chord, arp = prog[b % 4]
        section_full = b >= 2
        section_arp = t0 >= endc - bar * 6
        for q in range(4):
            tb = t0 + q * beat
            if tb >= end_groove:
                break
            drums.add(kick(), tb, 0.95)
            kick_times.append(tb)
            if section_full and q in (1, 3):
                c = clap()
                drums.add(c, tb, 0.7)
                verb_send.add(c, tb, 0.35)
            if b >= 1:
                drums.add(hat(), tb + beat / 2, 0.55, pan=0.25)
            if section_full and q == 3 and b % 2 == 1:
                drums.add(hat(True), tb + beat / 2, 0.45, pan=-0.25)
        # rolling bass: 16ths, root & octave, skip the downbeat (kick owns it)
        for s in range(16):
            ts = t0 + s * s16
            if ts >= end_groove:
                break
            if s % 4 == 0:
                continue
            note = root + (12 if s % 4 == 2 else 0)
            bus.add(bass_note(midi(note), s16 * 0.92), ts, 0.85)
        # syncopated chord stabs
        if section_full:
            for s in (3, 6, 10, 13):
                ts = t0 + s * s16
                if ts < end_groove:
                    st = pluck([midi(n + 12) for n in chord], 0.38)
                    bus.add(st, ts, 0.55)
                    verb_send.add(st, ts, 0.25)
        # pad
        bus.add(pad([midi(n) for n in chord], bar + 0.6), t0, 0.7)
        # arp in the last section
        if section_arp:
            for s in range(16):
                ts = t0 + s * s16
                if ts < end_groove:
                    note = arp[(s * 3) % len(arp)] + (12 if s % 8 >= 6 else 0)
                    bus.add(np.stack([arp_note(midi(note), s16)] * 2, axis=1), ts, 0.75)
    # snare roll + riser into the end card
    roll_start = endc - bar
    k = 0
    while roll_start + k * s16 < endc - 0.02:
        tt = roll_start + k * s16
        drums.add(clap() * (0.25 + 0.75 * k / 16), tt, 0.45)
        k += 1
    tr.add(riser(bar), endc - bar, 0.4)
    # final chord + impact
    final = end_groove
    bus.add(pad([midi(n) for n in [57, 60, 64, 69]], 3.0), final, 1.0)
    fin = impact(1.1)
    tr.add(fin, final, 0.6)
    verb_send.add(np.stack([fin, fin], axis=1), final, 0.3)
    tr.add(kick(1.2), final, 0.9)

    # sidechain: duck the bus under every kick
    duck = np.ones(bus.n)
    dl = int(0.28 * SR)
    shape = 1 - 0.65 * np.exp(-t_axis(dl) * 14)
    for kt in kick_times:
        i = int(kt * SR)
        seg = duck[i : i + dl]
        duck[i : i + dl] = np.minimum(seg, shape[: len(seg)])
    bus.buf *= duck[:, None]

    mix = tr.buf + bus.buf + drums.buf
    mix += convolve_stereo(verb_send.buf + bus.buf * 0.18, ir) * 0.35
    mix += convolve_stereo(hit_fx.buf, ir) * 0.5
    # master: gentle glue + soft clip + fade out
    mix = np.tanh(mix * 0.9) / np.tanh(0.9)
    mix /= np.max(np.abs(mix)) + 1e-9
    mix *= 0.89
    fade = int(1.2 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    import wave

    pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    cues = json.load(open(sys.argv[1]))
    render(cues, sys.argv[2])
    print('wrote', sys.argv[2])
