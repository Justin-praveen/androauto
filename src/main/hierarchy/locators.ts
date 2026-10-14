// Builds the ordered locator list for a recorded element (spec section 4, step 3):
// resource-id, then content-desc, then text (UiSelector), then a short XPath.

import type { Locator } from '@shared/types'
import type { UiNode, UiTree } from './tree'

function count(tree: UiTree, pred: (n: UiNode) => boolean): number {
  let c = 0
  for (const n of tree.all) if (pred(n)) c++
  return c
}

function indexAmong(tree: UiTree, node: UiNode, pred: (n: UiNode) => boolean): number {
  let i = 0
  for (const n of tree.all) {
    if (n === node) return i
    if (pred(n)) i++
  }
  return -1
}

function q(s: string): string {
  return JSON.stringify(s)
}

/** XPath string literal that survives both quote kinds. */
export function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`
  if (!s.includes('"')) return `"${s}"`
  return `concat('${s.split("'").join(`', "'", '`)}')`
}

export function buildLocators(tree: UiTree, target: UiNode, leaf?: UiNode): Locator[] {
  const out: Locator[] = []
  const add = (l: Locator): void => {
    if (!out.some((o) => o.strategy === l.strategy && o.value === l.value)) out.push(l)
  }

  const sameId = (n: UiNode): boolean => n.resourceId === target.resourceId
  const sameDesc = (n: UiNode): boolean => n.contentDesc === target.contentDesc
  const idUnique = !!target.resourceId && count(tree, sameId) === 1
  const descUnique = !!target.contentDesc && count(tree, sameDesc) === 1

  if (idUnique) add({ strategy: 'id', value: target.resourceId })
  if (descUnique) add({ strategy: 'accessibility id', value: target.contentDesc })

  // Text: on the target itself, or on the label inside it.
  const textNode = target.text ? target : leaf && leaf.text && isInside(leaf, target) ? leaf : null
  if (textNode) {
    const sameText = (n: UiNode): boolean => n.text === textNode.text
    const sameTextCls = (n: UiNode): boolean => sameText(n) && n.cls === textNode.cls
    if (count(tree, sameText) === 1) {
      add({ strategy: 'uiautomator', value: `new UiSelector().text(${q(textNode.text)})` })
    } else if (count(tree, sameTextCls) === 1) {
      add({ strategy: 'uiautomator', value: `new UiSelector().className(${q(textNode.cls)}).text(${q(textNode.text)})` })
    } else {
      const i = indexAmong(tree, textNode, sameText)
      add({ strategy: 'uiautomator', value: `new UiSelector().text(${q(textNode.text)}).instance(${i})` })
    }
  }

  // Repeated ids (list rows) still make a usable selector with an instance index.
  if (target.resourceId && !idUnique) {
    const i = indexAmong(tree, target, sameId)
    add({ strategy: 'uiautomator', value: `new UiSelector().resourceId(${q(target.resourceId)}).instance(${i})` })
  }

  add({ strategy: 'xpath', value: shortXpath(tree, target, textNode) })
  return out
}

function isInside(n: UiNode, ancestor: UiNode): boolean {
  for (let p: UiNode | null = n; p; p = p.parent) if (p === ancestor) return true
  return false
}

/** Shortest XPath that is unique in this tree, falling back to an indexed one. */
export function shortXpath(tree: UiTree, target: UiNode, textNode: UiNode | null): string {
  const cls = target.cls
  const candidates: { xp: string; pred: (n: UiNode) => boolean }[] = []
  if (target.resourceId)
    candidates.push({
      xp: `//${cls}[@resource-id=${xpathLiteral(target.resourceId)}]`,
      pred: (n) => n.cls === cls && n.resourceId === target.resourceId
    })
  if (target.text)
    candidates.push({ xp: `//${cls}[@text=${xpathLiteral(target.text)}]`, pred: (n) => n.cls === cls && n.text === target.text })
  if (target.contentDesc)
    candidates.push({
      xp: `//${cls}[@content-desc=${xpathLiteral(target.contentDesc)}]`,
      pred: (n) => n.cls === cls && n.contentDesc === target.contentDesc
    })
  if (textNode && textNode !== target && target.resourceId)
    candidates.push({
      xp: `//${cls}[@resource-id=${xpathLiteral(target.resourceId)}][.//*[@text=${xpathLiteral(textNode.text)}]]`,
      pred: (n) => n.cls === cls && n.resourceId === target.resourceId && hasDescendantText(n, textNode.text)
    })
  if (textNode && textNode !== target)
    candidates.push({
      xp: `//${cls}[.//*[@text=${xpathLiteral(textNode.text)}]]`,
      pred: (n) => n.cls === cls && hasDescendantText(n, textNode.text)
    })

  for (const c of candidates) if (count(tree, c.pred) === 1) return c.xp
  const first = candidates[0] ?? { xp: `//${cls}`, pred: (n: UiNode) => n.cls === cls }
  return `(${first.xp})[${indexAmong(tree, target, first.pred) + 1}]`
}

function hasDescendantText(n: UiNode, text: string): boolean {
  return n.children.some((c) => c.text === text || hasDescendantText(c, text))
}
