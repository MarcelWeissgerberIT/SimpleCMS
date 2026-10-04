/**
 * Block glyphs lucide doesn't have, drawn on its 24px grid with its stroke so they sit
 * next to the stock icons in the slash menu: a toggle chevron in front of H1 / H2 / H3.
 */
import { createLucideIcon, type LucideIconNode } from 'lucide-react'

const toggleH = (digit: LucideIconNode[]): LucideIconNode[] => [
  ['path', { d: 'm2 9 3 3-3 3', key: 'th-chevron' }],
  ['path', { d: 'M8 12h6', key: 'th-bar' }],
  ['path', { d: 'M8 18V6', key: 'th-left' }],
  ['path', { d: 'M14 18V6', key: 'th-right' }],
  ...digit,
]

export const ToggleHeading1 = createLucideIcon('toggle-heading-1', toggleH([['path', { d: 'm17 12 3-2v8', key: 'th-1' }]]))
export const ToggleHeading2 = createLucideIcon('toggle-heading-2', toggleH([['path', { d: 'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1', key: 'th-2' }]]))
export const ToggleHeading3 = createLucideIcon(
  'toggle-heading-3',
  toggleH([
    ['path', { d: 'M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2', key: 'th-3a' }],
    ['path', { d: 'M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2', key: 'th-3b' }],
  ]),
)

/** Five columns (lucide stops at columns-4): the same frame, four dividers. */
export const Columns5 = createLucideIcon('columns-5', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'c5-frame' }],
  ['path', { d: 'M6.6 3v18', key: 'c5-1' }],
  ['path', { d: 'M10.2 3v18', key: 'c5-2' }],
  ['path', { d: 'M13.8 3v18', key: 'c5-3' }],
  ['path', { d: 'M17.4 3v18', key: 'c5-4' }],
])
