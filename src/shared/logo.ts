/**
 * The One mark: an orange instrument tag with a hanger hole and a bold "1".
 * Returned as an SVG string so both the vanilla landing and React can use it.
 */
export function logoMarkSvg(size = 24, opts: { title?: string } = {}): string {
  const title = opts.title ? `<title>${opts.title}</title>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-hidden="${opts.title ? 'false' : 'true'}">${title}<rect x="1" y="1" width="30" height="30" rx="3" fill="#FF4F00"/><circle cx="7" cy="7" r="2" fill="#121210"/><path d="M13 9.5 18.5 7H21v18h-4.2V12.2L13 13.8z" fill="#121210"/></svg>`
}
