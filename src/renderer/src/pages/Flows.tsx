import { useCallback, useEffect, useMemo, useState } from 'react'
import { Circle, ListChecks, Play, Search, Trash2 } from 'lucide-react'
import type { FlowSummary } from '@shared/types'
import { duration, RunStatusLabel } from '../components/status'
import { Badge, Button, cx, Dialog, Empty, Input, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useStartRun } from '../lib/run'
import { useAction, useApp } from '../lib/state'

export function FlowsPage() {
  const { project, go, recorder, reloadProjects, batch, device, openRun } = useApp()
  const run = useAction()
  const startRun = useStartRun()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [del, setDel] = useState<FlowSummary | null>(null)

  const load = useCallback(async () => {
    if (project) setFlows(await api.invoke('flows:list', project.id))
  }, [project])

  const running = batch?.state === 'running'
  useEffect(() => {
    void load()
  }, [load, recorder.state, running])

  const tags = useMemo(() => [...new Set(flows.flatMap((f) => f.tags))].sort(), [flows])
  const shown = flows.filter((f) => (!tag || f.tags.includes(tag)) && f.name.toLowerCase().includes(q.toLowerCase()))
  const picked = shown.filter((f) => selected.has(f.id))
  const allPicked = shown.length > 0 && picked.length === shown.length
  const canRun = !running && device?.state === 'device' && recorder.state === 'idle'
  const runTitle = running ? 'A run is in progress' : device?.state !== 'device' ? 'Connect a phone first' : recorder.state !== 'idle' ? 'Finish the recording first' : undefined
  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  if (!project) return null
  return (
    <>
      <PageHeader
        title="Flows"
        subtitle={
          <>
            {project.name} · <span className="font-mono">{project.appPackage}</span>
          </>
        }
        actions={
          <>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flows" className="w-56 pl-9" />
            </div>
            <Button variant="record" onClick={() => go('recorder')}>
              <Circle size={12} className="fill-white" /> Record new
            </Button>
          </>
        }
      />

      {flows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
          {[null, ...tags].map((t) => (
            <button
              key={t ?? 'all'}
              onClick={() => setTag(t)}
              className={cx(
                'h-7 cursor-pointer rounded-full border px-3 text-xs font-medium transition',
                tag === t ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg'
              )}
            >
              {t ?? 'All'}
            </button>
          ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!canRun || picked.length === 0} title={runTitle} onClick={() => void startRun(picked.map((f) => f.id))}>
              <Play size={14} /> Run selected{picked.length ? ` (${picked.length})` : ''}
            </Button>
            <Button size="sm" variant="primary" disabled={!canRun || shown.length === 0} title={runTitle} onClick={() => void startRun(shown.map((f) => f.id))}>
              <Play size={14} className="fill-current" /> Run all{tag || q ? ` shown (${shown.length})` : ''}
            </Button>
          </div>
        </div>
      )}

      {flows.length === 0 ? (
        <Empty icon={<ListChecks size={20} />} title="No flows yet">
          Open the Recorder, hit Record and use the app on your phone. When you stop, name the flow and it shows up here.
          <div className="mt-4">
            <Button variant="record" onClick={() => go('recorder')}>
              <Circle size={12} className="fill-white" /> Record a flow
            </Button>
          </div>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="w-10 py-3 pl-5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allPicked}
                    onChange={() => setSelected(allPicked ? new Set() : new Set(shown.map((f) => f.id)))}
                    className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                  />
                </th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Steps</th>
                <th className="px-5 py-3 font-medium">Tags</th>
                <th className="px-5 py-3 font-medium">Last run</th>
                <th className="w-28 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className={cx('group border-b border-line last:border-0 hover:bg-sunken/60', selected.has(f.id) && 'bg-accent-soft/40')}>
                  <td className="py-3.5 pl-5">
                    <input type="checkbox" aria-label={`Select ${f.name}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} className="h-4 w-4 cursor-pointer accent-[var(--accent)]" />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-muted">Recorded {timeAgo(f.updatedAt)}</div>
                  </td>
                  <td className="px-5 py-3.5 text-muted">{f.stepCount}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {f.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {f.lastRun ? (
                      <button className="cursor-pointer text-left" onClick={() => openRun(f.lastRun!.id)} title="Open the report">
                        <RunStatusLabel status={f.lastRun.status} className="text-[13px]" />
                        <div className="text-xs text-muted">
                          {f.lastRun.failedStep ? `at step ${f.lastRun.failedStep} · ` : ''}
                          {timeAgo(f.lastRun.startedAt)} · {duration(f.lastRun.durationMs)}
                        </div>
                      </button>
                    ) : (
                      <span className="text-muted">Never run</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1 opacity-60 transition group-hover:opacity-100">
                      <Button size="icon" variant="ghost" disabled={!canRun} title={runTitle ?? 'Run this flow'} onClick={() => void startRun([f.id])}>
                        <Play size={15} />
                      </Button>
                      <Button size="icon" variant="danger" onClick={() => setDel(f)} title="Delete flow">
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    No flows match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!del}
        onClose={() => setDel(null)}
        title={`Delete "${del?.name}"?`}
        description="The flow file and its recorded screenshots are removed."
        footer={
          <>
            <Button onClick={() => setDel(null)}>Cancel</Button>
            <Button
              variant="primary"
              className="!bg-bad !text-white"
              onClick={() =>
                run(async () => {
                  await api.invoke('flows:delete', project.id, del!.id)
                  setDel(null)
                  await load()
                  await reloadProjects()
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This can't be undone.</p>
      </Dialog>
    </>
  )
}
