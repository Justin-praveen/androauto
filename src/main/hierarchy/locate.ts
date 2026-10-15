// Finds an element in a UI snapshot from a recorded Locator (spec section 5, step 2).
// Works on both hierarchy sources: the tree is rebuilt as an Appium-style DOM (tags are class
// names) so XPath written for Appium also works on `uiautomator dump` output.

import { DOMImplementation, type Element as XElement } from '@xmldom/xmldom'
import xpath from 'xpath'
import type { Locator } from '@shared/types'
import type { UiNode, UiTree } from './tree'

const domCache = new WeakMap<UiTree, { doc: Document; byEl: Map<unknown, UiNode> }>()

function toDom(tree: UiTree): { doc: Document; byEl: Map<unknown, UiNode> } {
  const cached = domCache.get(tree)
  if (cached) return cached
  const doc = new DOMImplementation().createDocument(null, 'hierarchy', null)
  const byEl = new Map<unknown, UiNode>()
  const add = (parent: XElement, n: UiNode, index: number): void => {
    const tag = /^[A-Za-z_][\w.-]*$/.test(n.cls) ? n.cls : 'node'
    const el = doc.createElement(tag)
    const attrs: Record<string, string> = {
      index: String(index),
      class: n.cls,
      package: n.pkg,
      text: n.text,
      'resource-id': n.resourceId,
      'content-desc': n.contentDesc,
      clickable: String(n.clickable),
      'long-clickable': String(n.longClickable),
      scrollable: String(n.scrollable),
      focusable: String(n.focusable),
      focused: String(n.focused),
      checkable: String(n.checkable),
      password: String(n.password),
      enabled: String(n.enabled),
      bounds: `[${n.bounds[0]},${n.bounds[1]}][${n.bounds[2]},${n.bounds[3]}]`
    }
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    parent.appendChild(el)
    byEl.set(el, n)
    n.children.forEach((c, i) => add(el, c, i))
  }
  const root = doc.documentElement as unknown as XElement
  tree.root.children.forEach((c, i) => add(root, c, i))
  const result = { doc: doc as unknown as Document, byEl }
  domCache.set(tree, result)
  return result
}

function byXpath(tree: UiTree, expr: string): UiNode[] {
  const { doc, byEl } = toDom(tree)
  const nodes = xpath.select(expr, doc as unknown as Node)
  if (!Array.isArray(nodes)) return []
  return nodes.map((n) => byEl.get(n)).filter((n): n is UiNode => !!n)
}

interface SelectorPart {
  method: string
  arg: string | number | boolean
}

/** Parses `new UiSelector().text("x").instance(1)` into its method calls. */
export function parseUiSelector(src: string): SelectorPart[] {
  const body = src.trim().replace(/^new\s+UiSelector\(\)/, '')
  const parts: SelectorPart[] = []
  const re = /\.(\w+)\(\s*("(?:[^"\\]|\\.)*"|-?\d+|true|false)\s*\)/g
  let m: RegExpExecArray | null
  let consumed = 0
  while ((m = re.exec(body))) {
    if (m.index !== consumed) throw new Error(`Unsupported UiSelector: ${src}`)
    consumed = re.lastIndex
    const raw = m[2]
    const arg = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw === 'true' || raw === 'false' ? raw === 'true' : Number(raw)
    parts.push({ method: m[1], arg })
  }
  if (consumed !== body.length) throw new Error(`Unsupported UiSelector: ${src}`)
  return parts
}

function bySelector(tree: UiTree, src: string): UiNode[] {
  const parts = parseUiSelector(src)
  let instance: number | null = null
  const preds: ((n: UiNode) => boolean)[] = []
  for (const { method, arg } of parts) {
    const s = String(arg)
    switch (method) {
      case 'text': preds.push((n) => n.text === s); break
      case 'textContains': preds.push((n) => n.text.includes(s)); break
      case 'textStartsWith': preds.push((n) => n.text.startsWith(s)); break
      case 'textMatches': { const r = new RegExp(`^(?:${s})$`); preds.push((n) => r.test(n.text)); break }
      case 'className': preds.push((n) => n.cls === s); break
      case 'resourceId': preds.push((n) => n.resourceId === s); break
      case 'resourceIdMatches': { const r = new RegExp(`^(?:${s})$`); preds.push((n) => r.test(n.resourceId)); break }
      case 'description': preds.push((n) => n.contentDesc === s); break
      case 'descriptionContains': preds.push((n) => n.contentDesc.includes(s)); break
      case 'clickable': preds.push((n) => n.clickable === arg); break
      case 'scrollable': preds.push((n) => n.scrollable === arg); break
      case 'enabled': preds.push((n) => n.enabled === arg); break
      case 'focused': preds.push((n) => n.focused === arg); break
      case 'instance': instance = Number(arg); break
      default: throw new Error(`Unsupported UiSelector method: ${method}`)
    }
  }
  const matches = tree.all.filter((n) => preds.every((p) => p(n)))
  return instance === null ? matches : matches[instance] ? [matches[instance]] : []
}

/** All nodes the locator matches, in document order. */
export function findAll(tree: UiTree, loc: Locator): UiNode[] {
  switch (loc.strategy) {
    case 'id':
      return tree.all.filter((n) => n.resourceId === loc.value || n.resourceId.endsWith(`:id/${loc.value}`))
    case 'accessibility id':
      return tree.all.filter((n) => n.contentDesc === loc.value)
    case 'uiautomator':
      return bySelector(tree, loc.value)
    case 'xpath':
      return byXpath(tree, loc.value)
  }
}

/** First locator (in order) that matches; ignores locators that fail to parse. */
export function locate(tree: UiTree, locators: Locator[]): { node: UiNode; locator: Locator } | null {
  for (const locator of locators) {
    try {
      const node = findAll(tree, locator)[0]
      if (node) return { node, locator }
    } catch {
      // A malformed locator (e.g. hand-edited) shouldn't stop the next one from being tried.
    }
  }
  return null
}

export function center(n: UiNode): { x: number; y: number } {
  const [l, t, r, b] = n.bounds
  return { x: Math.round((l + r) / 2), y: Math.round((t + b) / 2) }
}
