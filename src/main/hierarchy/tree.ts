// Parses UI hierarchy XML from either `uiautomator dump` (<node class=...>) or Appium's
// UiAutomator2 page source (<android.widget.Button ...>) into one tree shape.

import { XMLParser } from 'fast-xml-parser'
import type { ElementInfo } from '@shared/types'

export type Bounds = [number, number, number, number]

export interface UiNode {
  cls: string
  text: string
  resourceId: string
  contentDesc: string
  pkg: string
  clickable: boolean
  longClickable: boolean
  scrollable: boolean
  focusable: boolean
  focused: boolean
  checkable: boolean
  password: boolean
  enabled: boolean
  bounds: Bounds
  children: UiNode[]
  parent: UiNode | null
  depth: number
}

export interface UiTree {
  root: UiNode
  rotation: number
  all: UiNode[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false
})

const ATTRS = ':@'

export function parseBounds(s: string | undefined): Bounds {
  const m = s?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : [0, 0, 0, 0]
}

export function parseHierarchy(xml: string): UiTree {
  const start = xml.indexOf('<')
  const doc = parser.parse(start > 0 ? xml.slice(start) : xml) as Record<string, unknown>[]
  const hierarchyEntry = doc.find((e) => 'hierarchy' in e)
  if (!hierarchyEntry) throw new Error('Not a UI hierarchy: missing <hierarchy> root')
  const hAttrs = (hierarchyEntry[ATTRS] ?? {}) as Record<string, string>
  const all: UiNode[] = []
  const root: UiNode = makeNode('hierarchy', {}, null, 0)
  root.bounds = [0, 0, Number(hAttrs.width ?? 0), Number(hAttrs.height ?? 0)]
  walk(hierarchyEntry.hierarchy as Record<string, unknown>[], root, all)
  if (!root.bounds[2] && root.children[0]) root.bounds = root.children[0].bounds
  return { root, rotation: Number(hAttrs.rotation ?? 0), all }
}

function walk(entries: Record<string, unknown>[], parent: UiNode, all: UiNode[]): void {
  for (const entry of entries) {
    const tag = Object.keys(entry).find((k) => k !== ATTRS && k !== '#text')
    if (!tag) continue
    const attrs = (entry[ATTRS] ?? {}) as Record<string, string>
    const node = makeNode(attrs.class || tag, attrs, parent, parent.depth + 1)
    parent.children.push(node)
    all.push(node)
    walk((entry[tag] as Record<string, unknown>[]) ?? [], node, all)
  }
}

function makeNode(cls: string, a: Record<string, string>, parent: UiNode | null, depth: number): UiNode {
  const bool = (k: string): boolean => a[k] === 'true'
  return {
    cls,
    text: a.text ?? '',
    resourceId: a['resource-id'] ?? '',
    contentDesc: a['content-desc'] ?? '',
    pkg: a.package ?? '',
    clickable: bool('clickable'),
    longClickable: bool('long-clickable'),
    scrollable: bool('scrollable'),
    focusable: bool('focusable'),
    focused: bool('focused'),
    checkable: bool('checkable'),
    password: bool('password'),
    enabled: a.enabled !== 'false',
    bounds: parseBounds(a.bounds),
    children: [],
    parent,
    depth
  }
}

export function contains(b: Bounds, x: number, y: number): boolean {
  return x >= b[0] && x < b[2] && y >= b[1] && y < b[3]
}

function area(b: Bounds): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
}

/**
 * Deepest node containing the point. Among overlapping siblings the later one wins, since
 * Android draws later children on top.
 */
export function deepestAt(tree: UiTree, x: number, y: number): UiNode | null {
  let best: UiNode | null = null
  const visit = (n: UiNode): void => {
    for (const c of n.children) {
      if (area(c.bounds) > 0 && contains(c.bounds, x, y)) {
        best = c
        visit(c)
      }
    }
  }
  visit(tree.root)
  return best
}

function isInteractive(n: UiNode): boolean {
  return n.clickable || n.longClickable || n.checkable || isEditText(n)
}

export function isEditText(n: UiNode): boolean {
  return /EditText|AutoCompleteTextView/.test(n.cls)
}

/**
 * The element a touch at (x, y) acts on: the nearest interactive ancestor of the deepest node,
 * which is what Android dispatches the click to. Also returns that deepest node (often the
 * label carrying the text).
 */
export function elementAt(tree: UiTree, x: number, y: number): { target: UiNode; leaf: UiNode } | null {
  const leaf = deepestAt(tree, x, y)
  if (!leaf) return null
  let n: UiNode | null = leaf
  while (n && n.parent) {
    if (isInteractive(n)) return { target: n, leaf }
    n = n.parent
  }
  return { target: leaf, leaf }
}

/** Nearest scrollable container under the point, for swipes and scrolls. */
export function scrollableAt(tree: UiTree, x: number, y: number): UiNode | null {
  let n: UiNode | null = deepestAt(tree, x, y)
  while (n && n.parent) {
    if (n.scrollable) return n
    n = n.parent
  }
  return null
}

export function focusedEditText(tree: UiTree): UiNode | null {
  return tree.all.find((n) => n.focused && isEditText(n)) ?? null
}

/** First non-empty text inside a node (a button's label is often a child TextView). */
export function descendantText(n: UiNode): string {
  if (n.text) return n.text
  for (const c of n.children) {
    const t = descendantText(c)
    if (t) return t
  }
  return ''
}

export function toElementInfo(n: UiNode): ElementInfo {
  return {
    class: n.cls,
    text: n.text || descendantText(n),
    resourceId: n.resourceId,
    contentDesc: n.contentDesc,
    bounds: n.bounds,
    ...(n.password ? { password: true } : {})
  }
}
