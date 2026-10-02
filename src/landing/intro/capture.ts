/**
 * Snapshot of the visible spreadsheet window into a canvas (texture for the smash).
 * html2canvas-pro is loaded lazily. The capture covers exactly the viewport at
 * scale = min(devicePixelRatio, 2) so it maps 1:1 onto the WebGL drawing buffer.
 */
export function captureScale(): number {
  return Math.min(window.devicePixelRatio || 1, 2)
}

export async function captureViewport(target: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro')
  const w = window.innerWidth
  const h = window.innerHeight
  const canvas = await html2canvas(target, {
    scale: captureScale(),
    backgroundColor: '#c0c0c0',
    logging: false,
    useCORS: true,
    x: 0,
    y: 0,
    width: w,
    height: h,
    windowWidth: w,
    windowHeight: h,
    scrollX: 0,
    scrollY: 0,
    // Never clone the (big) site underneath or our ephemeral overlays.
    ignoreElements: (el) => el.id === 'site' || el.hasAttribute('data-html2canvas-ignore') || el.tagName === 'CANVAS',
    onclone: (doc) => {
      // The rumble jitter is a transient offset — capture the window at rest.
      const win = doc.querySelector<HTMLElement>('.x97-win')
      if (win) win.style.transform = ''
      // The "Not Responding" wash is re-applied (and faded out) in the shader.
      doc.querySelector('.x97')?.classList.remove('x97--hung')
    },
  })
  return canvas
}
