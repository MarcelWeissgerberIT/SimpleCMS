/**
 * Slot angles for slotted screw heads (toggle switches, screwed plates): whole degrees in steps of 15
 * (−90 … 75), derived from `seed` with FNV-1a. The same seed always gives the same screws (never
 * Math.random during render); different seeds look hand-fastened. Pure — no React, no DOM (specs import it).
 */
export function screwAngles(seed: string, n: number): number[] {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h >>>= 0
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const byte = (h >>> ((i % 4) * 8)) & 0xff
    out.push(Math.floor((byte * 12) / 256) * 15 - 90)
  }
  return out
}
