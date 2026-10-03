/**
 * A tiny SVG element tree: the chart scene is built once as plain data and then turned into
 * an SVG string (exports, downloads), a ProseMirror DOMOutputSpec (the `chart` node's HTML)
 * or React elements (the live renderer) — one renderer, three outputs.
 */
import { createElement, type ReactElement, type ReactNode } from 'react'

export type Attrs = Record<string, string | number | undefined | null | false>

export interface VNode {
  tag: string
  attrs: Attrs
  children: Array<VNode | string>
}

export function h(tag: string, attrs: Attrs = {}, ...children: Array<VNode | string | null | undefined | false | Array<VNode | string | null | undefined | false>>): VNode {
  const out: Array<VNode | string> = []
  const push = (c: unknown) => {
    if (Array.isArray(c)) c.forEach(push)
    else if (typeof c === 'string') out.push(c)
    else if (c && typeof c === 'object') out.push(c as VNode)
  }
  children.forEach(push)
  return { tag, attrs, children: out }
}

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const fmtNum = (v: number) => String(Math.round(v * 100) / 100)

function attrValue(v: Attrs[string]): string | null {
  if (v === undefined || v === null || v === false) return null
  return typeof v === 'number' ? fmtNum(v) : v
}

export function toSvgString(node: VNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => {
      const s = attrValue(v)
      return s === null ? '' : ` ${k}="${escAttr(s)}"`
    })
    .join('')
  if (!node.children.length) return `<${node.tag}${attrs}/>`
  return `<${node.tag}${attrs}>${node.children.map((c) => (typeof c === 'string' ? escText(c) : toSvgString(c))).join('')}</${node.tag}>`
}

export const SVG_NS = 'http://www.w3.org/2000/svg'

type DomSpec = [string, Record<string, string>, ...unknown[]]

/** ProseMirror DOMOutputSpec (the root carries the SVG namespace, children inherit it). */
export function toDomSpec(node: VNode, root = true): DomSpec {
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(node.attrs)) {
    const s = attrValue(v)
    if (s !== null && k !== 'xmlns') attrs[k] = s
  }
  return [root ? `${SVG_NS} ${node.tag}` : node.tag, attrs, ...node.children.map((c) => (typeof c === 'string' ? c : toDomSpec(c, false)))]
}

const camel = (k: string) => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())

export interface ReactOptions {
  /** index of the active (hovered / focused) data point: marks of other indexes get data-dim */
  active?: number | null
  /** extra class for bar marks (a host view's own hooks, e.g. the database chart view) */
  markClass?: string
}

/** SVG attributes as React props (class → className, stroke-width → strokeWidth …). */
export function reactProps(attrs: Attrs): Record<string, string> {
  const props: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) {
    const s = attrValue(v)
    if (s === null || k === 'xmlns') continue
    if (k === 'class') props.className = s
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role') props[k] = s
    else props[camel(k)] = s
  }
  return props
}

/** React elements; marks carrying data-i dim when another index is active. */
export function toReact(node: VNode, opts: ReactOptions = {}, key?: string | number): ReactElement {
  const props: Record<string, unknown> = { ...reactProps(node.attrs), key }
  if (opts.markClass && typeof props.className === 'string' && props.className.split(' ').includes('ch-bar')) props.className += ` ${opts.markClass}`
  if (opts.active !== undefined && opts.active !== null && node.attrs['data-i'] !== undefined) props['data-dim'] = String(node.attrs['data-i']) !== String(opts.active)
  const kids: ReactNode[] = node.children.map((c, i) => (typeof c === 'string' ? c : toReact(c, opts, i)))
  return createElement(node.tag, props, ...kids)
}
