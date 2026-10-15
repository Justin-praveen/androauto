import type { Flow, TestChange } from './types'

/** Human-readable change list for the UI and exports. */
export function describeChange(c: TestChange, flow: Flow): string {
  const n = (id: string): string => String(flow.steps.findIndex((s) => s.id === id) + 1)
  switch (c.type) {
    case 'setText':
      return `Step ${n(c.stepId)}: type "${c.value}" instead`
    case 'removeStep':
      return `Skip step ${n(c.stepId)}`
    case 'repeatStep':
      return `Do step ${n(c.stepId)} ${c.times} times`
    case 'stopAfter':
      return `Stop after step ${n(c.stepId)}`
    case 'pressKey':
      return `After step ${n(c.afterStepId)}: press ${c.key}`
    case 'wait':
      return `After step ${n(c.afterStepId)}: wait ${c.ms / 1000}s`
    case 'assertTextContains':
      return `After step ${n(c.afterStepId)}: check the screen shows "${c.text}"`
  }
}
