import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, History, ImageOff, Loader2, RotateCcw, Square } from 'lucide-react'
import type { BatchStatus, Flow, MirrorFrame, Run, RunSummary } from '@shared/types'
import { duration, RunStatusLabel, StepStatusIcon } from '../components/status'
import { Button, Card, cx, Empty, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { describeStep, timeAgo } from '../lib/format'
import { useStartRun } from '../lib/run'
import { useAction, useApp } from '../lib/state'

export function RunsPage() {
  const { runId } = useApp()
  return runId ? <RunReport runId={runId} /> : <RunsOverview />
}

function RunsOverview() {
  const { project, batch, openRun, go } = useApp()
  const [history, setHistory] = useState<RunSummary[] | null>(null)
  const active = batch && batch.projectId === project?.id ? batch : null

  useEffect(() => {
    if (project) void api.invoke('runs:list', project.id).then(setHistory)
    // Refresh whenever a flow in the batch finishes.
  }, [project, active?.state, active?.runs.filter((r) => r.status !== 'queued' && r.status !== 'running').length])

  if (!project) return null
  return (
    <>
      <PageHeader title="Runs" subtitle={`Replays of ${project.name}'s flows, with a pass or fail result for each.`} />
      {active && <BatchCard batch={active} />}

      <h2 className="mt-8 mb-3 text-sm font-semibold">History</h2>
      {history && history.length === 0 ? (
        <Empty icon={<History size={20} />} title="No runs yet">
          Open Flows, tick the flows you want and hit Run selected, or Run all.
          <div className="mt-4">
            <Button onClick={() => go('flows')}>Open Flows</Button>
          </div>
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-5 py-3 font-medium">Flow</th>
                <th className="px-5 py-3 font-medium">Result</th>
                <th className="px-5 py-3 font-medium">Device</th>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {history?.map((r) => (
                <tr key={r.id} onClick={() => openRun(r.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken/60">
                  <td className="px-5 py-3 font-medium">{r.flowName}</td>
                  <td className="px-5 py-3">
                    <RunStatusLabel status={r.status} className="text-[13px]" />
                    {r.failedStep && <span className="ml-1.5 text-xs text-muted">at step {r.failedStep}</span>}
                  </td>
                  <td className="px-5 py-3 text-muted">{r.deviceModel}</td>
                  <td className="px-5 py-3 text-muted">{r.startedAt ? timeAgo(r.startedAt) : '—'}</td>
                  <td className="px-5 py-3 text-right font-mono text-[13px] text-muted">{duration(r.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

function BatchCard({ batch }: { batch: BatchStatus }) {
  const { openRun } = useApp()
  const run = useAction()
  const running = batch.state === 'running'
  const counts = useMemo(() => {
    const c = { passed: 0, failed: 0, aborted: 0, left: 0 }
    for (const r of batch.runs) {
      if (r.status === 'passed') c.passed++
      else if (r.status === 'failed') c.failed++
      else if (r.status === 'aborted') c.aborted++
      else c.left++
    }
    return c
  }, [batch])
  const total = batch.runs.length
  const elapsed = (batch.finishedAt ?? Date.now()) - batch.startedAt

  return (
    <div className={cx('grid items-start gap-5', running ? 'grid-cols-[1fr_220px]' : 'grid-cols-1')}>
      <Card>
        <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
          <div className="flex-1">
            <div className="text-[13px] text-muted">{running ? `Running ${Math.min(batch.current + 1, total)} of ${total}` : batch.state === 'aborted' ? 'Stopped' : 'Finished'}</div>
            <div className="mt-0.5 flex items-baseline gap-3 text-lg font-semibold">
              <span className="text-ok">{counts.passed} passed</span>
              <span className={counts.failed ? 'text-bad' : 'text-muted'}>{counts.failed} failed</span>
              {counts.aborted > 0 && <span className="text-muted">{counts.aborted} stopped</span>}
              {running && counts.left > 0 && <span className="text-muted">{counts.left} to go</span>}
            </div>
          </div>
          {!running && <span className="font-mono text-[13px] text-muted">{duration(elapsed)}</span>}
          {running && (
            <Button size="sm" className="border-bad/40 text-bad" onClick={() => run(() => api.invoke('runs:abort'))}>
              <Square size={12} className="fill-current" /> Stop
            </Button>
          )}
        </div>
        <div className="flex h-1.5 overflow-hidden bg-sunken">
          {batch.runs.map((r) => (
            <div
              key={r.id}
              className={cx(
                'h-full flex-1 border-r border-panel last:border-0 transition-colors',
                r.status === 'passed' && 'bg-ok',
                r.status === 'failed' && 'bg-bad',
                r.status === 'running' && 'bg-accent pulse',
                r.status === 'aborted' && 'bg-muted/40'
              )}
            />
          ))}
        </div>
        <div className="divide-y divide-line">
          {batch.runs.map((r) => (
            <BatchRow key={r.id} run={r} onOpen={r.status !== 'queued' && r.status !== 'running' ? () => openRun(r.id) : undefined} />
          ))}
        </div>
      </Card>
      {running && <LiveScreen serial={batch.serial} />}
    </div>
  )
}

function BatchRow({ run, onOpen }: { run: Run; onOpen?: () => void }) {
  const done = run.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
  const failed = run.steps.findIndex((s) => s.status === 'failed')
  return (
    <div onClick={onOpen} className={cx('flex items-center gap-4 px-5 py-3', onOpen && 'cursor-pointer hover:bg-sunken/60')}>
      <RunStatusLabel status={run.status} className="w-24 text-[13px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{run.flowName}</div>
        {run.error && <div className="truncate text-xs text-bad">Step {failed + 1}: {run.error}</div>}
      </div>
      <div className="flex gap-0.5">
        {run.steps.map((s) => (
          <span
            key={s.stepId}
            className={cx(
              'h-2 w-2 rounded-full',
              s.status === 'passed' && 'bg-ok',
              s.status === 'warning' && 'bg-warn',
              s.status === 'failed' && 'bg-bad',
              s.status === 'running' && 'bg-accent pulse',
              (s.status === 'pending' || s.status === 'skipped') && 'bg-line'
            )}
          />
        ))}
      </div>
      <span className="w-16 text-right font-mono text-xs text-muted">
        {run.status === 'running' ? `${done}/${run.steps.length}` : run.durationMs ? duration(run.durationMs) : ''}
      </span>
    </div>
  )
}

function LiveScreen({ serial }: { serial: string }) {
  const [frame, setFrame] = useState<MirrorFrame | null>(null)
  useEffect(() => {
    const off = api.on('mirror:frame', (f) => f.serial === serial && setFrame(f))
    void api.invoke('mirror:start', serial)
    return () => {
      off()
      void api.invoke('mirror:stop')
    }
  }, [serial])
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-[22px] border-[5px] border-zinc-800 bg-black dark:border-zinc-700">
        {frame ? (
          <img src={frame.dataUrl} alt="Phone screen" className="block max-h-[420px] w-auto rounded-[17px]" />
        ) : (
          <div className="flex h-[400px] w-[180px] items-center justify-center">
            <Loader2 size={16} className="animate-spin text-zinc-500" />
          </div>
        )}
      </div>
      <span className="text-xs text-muted">Live</span>
    </div>
  )
}

function RunReport({ runId }: { runId: string }) {
  const { project, batch, openRun } = useApp()
  const startRun = useStartRun()
  const [saved, setSaved] = useState<Run | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [error, setError] = useState('')

  // While it is part of the live batch, show the live copy.
  const live = batch?.runs.find((r) => r.id === runId) ?? null
  const run = live && (live.status === 'running' || !saved) ? live : saved

  useEffect(() => {
    if (!project) return
    setSaved(null)
    setError('')
    api
      .invoke('runs:get', project.id, runId)
      .then((r) => {
        setSaved(r)
        return api.invoke('flows:get', project.id, r.flowId).then(setFlow, () => setFlow(null))
      })
      .catch(() => !live && setError('This run report could not be read.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, runId, live?.status])

  useEffect(() => {
    if (!run || sel !== null) return
    const failed = run.steps.findIndex((s) => s.status === 'failed')
    const lastDone = run.steps.map((s) => s.status).lastIndexOf('passed')
    setSel(failed >= 0 ? failed : Math.max(0, lastDone))
  }, [run, sel])

  const step = run && sel !== null ? run.steps[sel] : null
  useEffect(() => {
    setImg(null)
    if (!project || !step?.screenshot) return
    void api.invoke('runs:image', project.id, runId, step.screenshot).then(setImg, () => setImg(null))
  }, [project, runId, step?.screenshot])

  if (!project) return null
  if (error) return <Empty icon={<ImageOff size={20} />} title={error} />
  if (!run)
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> Loading…
      </div>
    )

  const flowStep = (id: string) => flow?.steps.find((s) => s.id === id)
  const fs = step ? flowStep(step.stepId) : undefined
  const d = fs ? describeStep(fs) : null

  return (
    <>
      <button className="mb-4 flex cursor-pointer items-center gap-1.5 text-[13px] text-muted hover:text-fg" onClick={() => openRun(null)}>
        <ArrowLeft size={14} /> All runs
      </button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{run.flowName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <RunStatusLabel status={run.status} />
            <span>{run.deviceModel}</span>
            {run.startedAt && <span>{timeAgo(run.startedAt)}</span>}
            {run.durationMs > 0 && <span className="font-mono">{duration(run.durationMs)}</span>}
          </div>
        </div>
        <Button onClick={() => void startRun([run.flowId])} disabled={batch?.state === 'running'}>
          <RotateCcw size={14} /> Re-run
        </Button>
      </div>

      {run.status === 'failed' && run.error && (
        <div className="mb-5 rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-[13px] text-bad">
          Failed at step {run.steps.findIndex((s) => s.status === 'failed') + 1}: {run.error}
        </div>
      )}

      <div className="grid grid-cols-[1fr_minmax(260px,360px)] gap-5">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-3.5 text-sm font-semibold">Steps</div>
          <div className="max-h-[calc(100vh-330px)] overflow-y-auto py-1">
            {run.steps.map((r, i) => {
              const s = flowStep(r.stepId)
              const dd = s ? describeStep(s) : { verb: r.stepId, detail: '' }
              return (
                <button
                  key={r.stepId}
                  onClick={() => setSel(i)}
                  className={cx('flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left', sel === i ? 'bg-accent-soft' : 'hover:bg-sunken/60')}
                >
                  <span className="w-5 text-right font-mono text-xs tabular-nums text-muted">{i + 1}</span>
                  <StepStatusIcon status={r.status} />
                  <span className={cx('min-w-0 flex-1 truncate text-sm', r.status === 'skipped' && 'text-muted')}>
                    <span className="font-medium">{dd.verb}</span> {dd.detail}
                    {dd.extra && <span className="text-muted"> {dd.extra}</span>}
                  </span>
                  {r.durationMs !== undefined && <span className="font-mono text-xs text-muted">{duration(r.durationMs)}</span>}
                </button>
              )
            })}
          </div>
        </Card>

        <div className="space-y-3">
          <div className="flex justify-center rounded-xl border border-line bg-sunken p-3">
            {img ? (
              <img src={img} alt="Screen after this step" className="max-h-[calc(100vh-420px)] min-h-[280px] w-auto rounded-lg border border-line" />
            ) : (
              <div className="flex h-[360px] flex-col items-center justify-center gap-2 text-[13px] text-muted">
                <ImageOff size={18} /> {step?.status === 'skipped' || step?.status === 'pending' ? 'Not run' : 'No screenshot'}
              </div>
            )}
          </div>
          {step && (
            <Card className="space-y-2 p-4 text-[13px]">
              <div className="flex items-center gap-2">
                <StepStatusIcon status={step.status} />
                <span className="font-medium">
                  Step {sel! + 1}
                  {d ? ` · ${d.verb} ${d.detail}` : ''}
                </span>
              </div>
              {step.locatorUsed && (
                <div className="text-muted">
                  Found by <span className="font-mono text-fg">{step.locatorUsed}</span>
                </div>
              )}
              {step.warning && <div className="text-warn">{step.warning}</div>}
              {step.error && <div className="text-bad">{step.error}</div>}
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
