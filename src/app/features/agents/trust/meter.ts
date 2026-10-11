/**
 * Per-field trust — the meter's two fills. Each is its LED colour mixed with the ink, so the shapes cut into a segment
 * (the spot check's foot, the wrong one's slit, the undone hatch) stay ≥ 3 : 1 against the plate whatever a workspace
 * look makes of `--led-ok` / `--led-on` (a green signal turns "fine" ink; any signal is "working"). trust.css writes
 * exactly these mixes; tests/e2e/look-engine.spec.ts reads them from there and checks every look. Pure.
 */
export const METER_MIX = { ok: 0.9, wrong: 0.9 } as const

/** The CSS of a fill: `color-mix(in oklab, var(--led-ok) 78%, var(--ink))`. */
export const meterMix = (led: 'led-ok' | 'led-on', p: number): string => `color-mix(in oklab, var(--${led}) ${Math.round(p * 100)}%, var(--ink))`
