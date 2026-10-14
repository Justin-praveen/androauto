import { Ban, CheckCircle2, CircleDashed, Loader2, MinusCircle, TriangleAlert, XCircle } from 'lucide-react'
import type { RunStatus, StepStatus } from '@shared/types'
import { cx } from './ui'

const RUN: Record<RunStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  queued: { label: 'Queued', cls: 'text-muted', Icon: CircleDashed },
  running: { label: 'Running', cls: 'text-accent', Icon: Loader2 },
  passed: { label: 'Passed', cls: 'text-ok', Icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'text-bad', Icon: XCircle },
  aborted: { label: 'Stopped', cls: 'text-muted', Icon: Ban }
}

export function RunStatusLabel({ status, className }: { status: RunStatus; className?: string }) {
  const { label, cls, Icon } = RUN[status]
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-medium', cls, className)}>
      <Icon size={15} className={status === 'running' ? 'animate-spin' : undefined} />
      {label}
    </span>
  )
}

const STEP: Record<StepStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
  pending: { cls: 'text-muted/60', Icon: CircleDashed },
  running: { cls: 'text-accent', Icon: Loader2 },
  passed: { cls: 'text-ok', Icon: CheckCircle2 },
  warning: { cls: 'text-warn', Icon: TriangleAlert },
  failed: { cls: 'text-bad', Icon: XCircle },
  skipped: { cls: 'text-muted/60', Icon: MinusCircle }
}

export function StepStatusIcon({ status, size = 15 }: { status: StepStatus; size?: number }) {
  const { cls, Icon } = STEP[status]
  return <Icon size={size} className={cx(cls, 'shrink-0', status === 'running' && 'animate-spin')} />
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
