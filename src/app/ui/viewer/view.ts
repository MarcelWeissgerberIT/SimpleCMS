/**
 * The viewer's camera, pure: a scale and the content's top-left corner in stage pixels. Zoom keeps the point
 * under the pointer (or the pinch centre) still; panning stops `PAD` px past the content's edges, and an
 * axis the content fits on stays centred.
 */
export interface View {
  /** scale: 1 = the diagram's own size */
  s: number
  /** the content's top-left corner in stage px */
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8
/** Fit never blows a small diagram up past this. */
export const FIT_MAX = 2
/** Margin around the content (fit, pan limits). */
export const PAD = 32
/** One + / − step. */
export const STEP = 1.25

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s))

function clampAxis(t: number, content: number, stage: number): number {
  // fits (with its margins): centred
  if (content + 2 * PAD <= stage) return (stage - content) / 2
  return Math.min(PAD, Math.max(stage - content - PAD, t))
}

/** Keep the content reachable: the view moved back inside its limits. */
export function clampView(v: View, content: Size, stage: Size): View {
  const s = clampScale(v.s)
  return { s, x: clampAxis(v.x, content.w * s, stage.w), y: clampAxis(v.y, content.h * s, stage.h) }
}

/** The whole diagram, centred, never larger than FIT_MAX. */
export function fitView(content: Size, stage: Size): View {
  const s = clampScale(Math.min((stage.w - 2 * PAD) / content.w, (stage.h - 2 * PAD) / content.h, FIT_MAX))
  return clampView({ s, x: 0, y: 0 }, content, stage)
}

/** Zoom to `s` around the stage point (px, py): that point of the diagram stays where it is. */
export function zoomAt(v: View, s: number, px: number, py: number, content: Size, stage: Size): View {
  const next = clampScale(s)
  const k = next / v.s
  return clampView({ s: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, content, stage)
}

/** 100 %: around the stage centre. */
export function actualSize(v: View, content: Size, stage: Size): View {
  return zoomAt(v, 1, stage.w / 2, stage.h / 2, content, stage)
}

export function panBy(v: View, dx: number, dy: number, content: Size, stage: Size): View {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, content, stage)
}

/** Centre the stage on the diagram point (cx, cy) (diagram px at scale 1). */
export function centreOn(v: View, cx: number, cy: number, content: Size, stage: Size): View {
  return clampView({ ...v, x: stage.w / 2 - cx * v.s, y: stage.h / 2 - cy * v.s }, content, stage)
}

/** Does everything show at once (no minimap needed)? */
export function fitsInStage(v: View, content: Size, stage: Size): boolean {
  return content.w * v.s <= stage.w + 0.5 && content.h * v.s <= stage.h + 0.5
}

/** Wheel delta → zoom factor (Ctrl / ⌘ + wheel, trackpad pinch). Lines count as 16 px; one notch ≈ 1.5×. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const d = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-120, Math.min(120, d)) * 0.004)
}

/** The part of the diagram the stage shows, in diagram px (for the minimap's rectangle). */
export function visibleRect(v: View, content: Size, stage: Size): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, -v.x / v.s)
  const y0 = Math.max(0, -v.y / v.s)
  const x1 = Math.min(content.w, (stage.w - v.x) / v.s)
  const y1 = Math.min(content.h, (stage.h - v.y) / v.s)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}
