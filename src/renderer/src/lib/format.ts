import type { ElementInfo, Step } from '@shared/types'

export function elementLabel(e: ElementInfo | null | undefined): string {
  if (!e) return ''
  if (e.text) return e.text
  if (e.contentDesc) return e.contentDesc
  if (e.resourceId) return e.resourceId.split(':id/').pop() ?? e.resourceId
  return e.class.split('.').pop() ?? e.class
}

/** Readable one-liner for a step, e.g. Tap "Log in". */
export function describeStep(s: Step): { verb: string; detail: string; extra?: string } {
  const label = elementLabel(s.target?.element)
  const quoted = label ? `"${label}"` : s.target ? `at ${Math.round(s.target.fallbackPoint.xPct * 100)}%, ${Math.round(s.target.fallbackPoint.yPct * 100)}%` : ''
  const p = s.params ?? {}
  switch (s.action) {
    case 'launchApp':
      return { verb: 'Launch', detail: String(p.appPackage ?? 'app') }
    case 'tap':
      return { verb: 'Tap', detail: quoted }
    case 'longPress':
      return { verb: 'Long press', detail: quoted }
    case 'type': {
      const field = s.target?.element ? fieldName(s.target.element) : ''
      const text = s.secret ? '•'.repeat(Number(p.masked) || 6) : `"${String(p.text ?? '')}"`
      return { verb: 'Type', detail: text, extra: field ? `in ${field}` : undefined }
    }
    case 'swipe':
      return { verb: 'Swipe', detail: String(p.direction ?? '') }
    case 'scroll':
      return { verb: 'Scroll', detail: String(p.scroll ?? p.direction ?? ''), extra: label ? `on ${label}` : undefined }
    case 'pressKey':
      return { verb: 'Press', detail: String(p.key ?? '').replace(/^./, (c) => c.toUpperCase()) }
    case 'wait':
      return { verb: 'Wait', detail: `${(Number(p.ms) / 1000).toFixed(1)}s` }
    case 'assertVisible':
      return { verb: 'Check visible', detail: quoted }
    case 'assertText':
      return { verb: 'Check text', detail: `"${String(p.text ?? '')}"`, extra: label && label !== p.text ? `in ${label}` : undefined }
  }
}

function fieldName(e: ElementInfo): string {
  if (e.resourceId) return e.resourceId.split(':id/').pop() ?? ''
  return e.contentDesc || 'field'
}

/** Suggested variable name for a typed value, from its field id. */
export function suggestVar(s: Step): string {
  const id = s.target?.element?.resourceId?.split(':id/').pop() ?? ''
  const base = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')
  return base || (s.secret ? 'password' : 'text')
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
