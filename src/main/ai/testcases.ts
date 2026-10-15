// AI test ideas: describe a recorded flow (and the screens it passed through) to the model,
// get back test cases as structured changes to that flow, and turn chosen ones into flows.

import type { ElementInfo, Flow, Project, Step, TestCategory, TestChange, TestIdea } from '@shared/types'
import { parseHierarchy, type UiNode } from '../hierarchy/tree'
import type { ChatMessage } from './client'

const CATEGORIES: TestCategory[] = ['positive', 'negative', 'boundary', 'edge', 'security', 'usability']

function label(e: ElementInfo | null | undefined): string {
  if (!e) return ''
  const id = e.resourceId.split(':id/').pop() ?? ''
  const name = e.text || e.contentDesc || id || e.class.split('.').pop() || ''
  return `"${name}"${id && id !== name ? ` (id ${id})` : ''} [${e.class.split('.').pop()}]`
}

/** One line per step, the way the model sees the flow. */
export function describeSteps(flow: Flow): string {
  return flow.steps
    .map((s, i) => {
      const p = s.params ?? {}
      const el = label(s.target?.element)
      const text = typeof p.text === 'string' ? p.text : ''
      const shown = s.secret ? '(password, hidden)' : /^\$\{(\w+)\}$/.test(text) ? `${text} = "${flow.variables[text.slice(2, -1)] ?? ''}"` : `"${text}"`
      const what: Record<Step['action'], string> = {
        launchApp: `launch app ${String(p.appPackage ?? '')}`,
        tap: `tap ${el}`,
        longPress: `long press ${el}`,
        type: `type ${shown} into ${el}`,
        swipe: `swipe ${String(p.direction ?? '')}`,
        scroll: `scroll ${String(p.scroll ?? p.direction ?? '')} ${el}`,
        pressKey: `press ${String(p.key ?? '')}`,
        wait: `wait ${String(p.ms ?? '')}ms`,
        assertVisible: `check ${el} is visible`,
        assertText: `check ${el} shows "${String(p.text ?? '')}"`
      }
      return `${i + 1}. [${s.id}] ${what[s.action]}`
    })
    .join('\n')
}

function nodeLine(n: UiNode): string | null {
  const id = n.resourceId.split(':id/').pop() ?? ''
  const cls = n.cls.split('.').pop() ?? n.cls
  const name = n.text || n.contentDesc
  if (/EditText/.test(cls)) return `- input ${id || name}${name && id ? ` (shows "${name}")` : ''}${n.password ? ' [password]' : ''}`
  if (n.clickable && (name || id)) return `- button/link "${name || id}"`
  if (n.checkable) return `- checkbox/switch "${name || id}"`
  if (name && name.length < 120) return `- text "${name}"`
  return null
}

/** Compact list of what was on screen at each recorded step (deduplicated, size-capped). */
export function describeScreens(flow: Flow, snapshotXml: (stepId: string) => string | null, maxScreens = 8, maxLines = 35): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of flow.steps) {
    if (out.length >= maxScreens) break
    const xml = snapshotXml(s.id)
    if (!xml) continue
    let lines: string[]
    try {
      lines = [...new Set(parseHierarchy(xml).all.map(nodeLine).filter((l): l is string => !!l))].slice(0, maxLines)
    } catch {
      continue
    }
    const sig = lines.join('|')
    if (!lines.length || seen.has(sig)) continue
    seen.add(sig)
    out.push(`Screen before step [${s.id}]:\n${lines.join('\n')}`)
  }
  return out.join('\n\n')
}

export function buildPrompt(project: Project, flow: Flow, screens: string, opts: { count: number; focus?: string }): ChatMessage[] {
  const system = `You are a senior mobile QA engineer. You design test cases for Android apps from a recorded user flow.
Each test case is a variation of the recorded flow, described as changes to its steps, so it can be replayed automatically.
Reply with JSON only, no prose, matching this shape:
{"testCases":[{
  "title": "short name",
  "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')},
  "priority": "high" | "medium" | "low",
  "description": "what this checks and why it matters",
  "expected": "what the app should do",
  "automatable": true | false,
  "changes": [ /* only when automatable */
    {"type":"setText","stepId":"stp_02","value":"text to type instead"},
    {"type":"removeStep","stepId":"stp_03"},
    {"type":"repeatStep","stepId":"stp_04","times":2},
    {"type":"stopAfter","stepId":"stp_04"},
    {"type":"pressKey","afterStepId":"stp_02","key":"back"|"home"|"enter"},
    {"type":"wait","afterStepId":"stp_02","ms":3000},
    {"type":"assertTextContains","afterStepId":"stp_04","text":"exact substring the app will show"}
  ],
  "manualSteps": ["only when not automatable: steps a tester follows"]
}]}
Rules:
- Use only step ids that exist in the flow.
- Use setText only on "type" steps.
- After an action that should fail (invalid input, missing field), add stopAfter on that action, because the later steps assume success.
- Only add assertTextContains when the screen text listed below makes the exact message certain; otherwise describe the expectation in "expected".
- Cover: the happy path variants, empty and invalid inputs, boundaries (length, special characters, unicode, whitespace), repeated taps, interruptions (back, home, waiting), and security (injection strings, password handling) where they apply.
- Mark cases that need things replay can't do (rotation, network off, other devices, notifications) as automatable false with manualSteps.
- No duplicates. Be specific to this app's fields and screens.`

  const user = `App: ${project.name} (${project.appPackage})
Flow: "${flow.name}"${flow.description ? `\nAbout: ${flow.description}` : ''}

Recorded steps:
${describeSteps(flow)}

${screens ? `What was on screen:\n${screens}\n\n` : ''}Write ${opts.count} test cases for this flow.${opts.focus ? `\nFocus on: ${opts.focus}` : ''}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max).trim() : ''
}

/** Validates the model's answer against the flow; drops changes that don't fit. */
export function parseIdeas(raw: unknown, flow: Flow): TestIdea[] {
  const list = Array.isArray(raw) ? raw : (raw as { testCases?: unknown })?.testCases
  if (!Array.isArray(list)) throw new Error('The AI answer did not contain a testCases list')
  const ids = new Set(flow.steps.map((s) => s.id))
  const typeIds = new Set(flow.steps.filter((s) => s.action === 'type').map((s) => s.id))
  const ideas: TestIdea[] = []

  list.forEach((item: Record<string, unknown>, i) => {
    if (!item || typeof item !== 'object') return
    const title = str(item.title, 160)
    if (!title) return
    const changes: TestChange[] = []
    for (const c of Array.isArray(item.changes) ? (item.changes as Record<string, unknown>[]) : []) {
      const stepId = str(c?.stepId)
      const after = str(c?.afterStepId)
      switch (c?.type) {
        case 'setText':
          if (typeIds.has(stepId) && typeof c.value === 'string') changes.push({ type: 'setText', stepId, value: c.value.slice(0, 5000) })
          break
        case 'removeStep':
          if (ids.has(stepId)) changes.push({ type: 'removeStep', stepId })
          break
        case 'repeatStep':
          if (ids.has(stepId)) changes.push({ type: 'repeatStep', stepId, times: Math.min(10, Math.max(2, Number(c.times) || 2)) })
          break
        case 'stopAfter':
          if (ids.has(stepId)) changes.push({ type: 'stopAfter', stepId })
          break
        case 'pressKey':
          if (ids.has(after) && ['back', 'home', 'enter'].includes(String(c.key)))
            changes.push({ type: 'pressKey', afterStepId: after, key: c.key as 'back' | 'home' | 'enter' })
          break
        case 'wait':
          if (ids.has(after)) changes.push({ type: 'wait', afterStepId: after, ms: Math.min(60000, Math.max(100, Number(c.ms) || 1000)) })
          break
        case 'assertTextContains':
          if (ids.has(after) && str(c.text)) changes.push({ type: 'assertTextContains', afterStepId: after, text: str(c.text, 300) })
          break
      }
    }
    const manualSteps = Array.isArray(item.manualSteps) ? (item.manualSteps as unknown[]).map((m) => str(m, 500)).filter(Boolean) : []
    const automatable = item.automatable !== false && changes.length > 0
    ideas.push({
      id: `idea_${String(i + 1).padStart(2, '0')}`,
      title,
      category: CATEGORIES.includes(item.category as TestCategory) ? (item.category as TestCategory) : 'edge',
      priority: ['high', 'medium', 'low'].includes(String(item.priority)) ? (item.priority as TestIdea['priority']) : 'medium',
      description: str(item.description),
      expected: str(item.expected),
      automatable,
      changes: automatable ? changes : [],
      manualSteps
    })
  })
  if (!ideas.length) throw new Error('The AI did not return any usable test cases')
  return ideas
}

/** Applies an idea's changes to a copy of the flow's steps. */
export function applyIdea(flow: Flow, idea: TestIdea): Step[] {
  let steps: Step[] = flow.steps.map((s) => structuredClone(s))
  let n = 0
  const newId = (): string => `stp_ai${String(++n).padStart(2, '0')}`
  const base = (): Pick<Step, 'waitBeforeMs' | 'timeoutMs'> => ({ waitBeforeMs: 0, timeoutMs: 10000 })
  const insertAfter = (afterId: string, step: Step): void => {
    const i = steps.findIndex((s) => s.id === afterId)
    if (i >= 0) steps.splice(i + 1, 0, step)
  }

  for (const c of idea.changes) {
    switch (c.type) {
      case 'setText': {
        const s = steps.find((x) => x.id === c.stepId)
        if (s) {
          s.params = { text: c.value }
          delete s.secret
        }
        break
      }
      case 'repeatStep': {
        const s = steps.find((x) => x.id === c.stepId)
        if (s) for (let k = 1; k < c.times; k++) insertAfter(s.id, { ...structuredClone(s), id: newId(), snapshot: undefined })
        break
      }
      case 'pressKey':
        insertAfter(c.afterStepId, { id: newId(), action: 'pressKey', params: { key: c.key }, ...base() })
        break
      case 'wait':
        insertAfter(c.afterStepId, { id: newId(), action: 'wait', params: { ms: c.ms }, ...base() })
        break
      case 'assertTextContains':
        insertAfter(c.afterStepId, {
          id: newId(),
          action: 'assertText',
          params: { text: c.text, contains: true },
          target: {
            locators: [{ strategy: 'uiautomator', value: `new UiSelector().textContains(${JSON.stringify(c.text)})` }],
            element: null,
            fallbackPoint: { xPct: 0.5, yPct: 0.5 }
          },
          ...base()
        })
        break
    }
  }
  // Removals and the cut-off last, so step ids used by inserts above still resolve.
  const removed = new Set(idea.changes.filter((c) => c.type === 'removeStep').map((c) => (c as { stepId: string }).stepId))
  steps = steps.filter((s) => !removed.has(s.id))
  const stop = idea.changes.find((c) => c.type === 'stopAfter') as { stepId: string } | undefined
  if (stop) {
    const i = steps.findIndex((s) => s.id === stop.stepId)
    if (i >= 0) {
      // Keep checks the idea inserted right after the cut-off step.
      let end = i + 1
      while (end < steps.length && steps[end].id.startsWith('stp_ai') && steps[end].action === 'assertText') end++
      steps = steps.slice(0, end)
    }
  }
  return steps
}

export { describeChange } from '@shared/ai-format'
