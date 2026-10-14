import { useCallback, useEffect, useMemo, useState } from 'react'
import { Circle, ListChecks, Play, Search, Trash2 } from 'lucide-react'
import type { FlowSummary } from '@shared/types'
import { Badge, Button, cx, Dialog, Empty, Input, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useAction, useApp } from '../lib/state'

export function FlowsPage() {
  const { project, go, recorder, reloadProjects } = useApp()
  const run = useAction()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [del, setDel] = useState<FlowSummary | null>(null)

  const load = useCallback(async () => {
    if (project) setFlows(await api.invoke('flows:list', project.id))
  }, [project])

  useEffect(() => {
    void load()
  }, [load, recorder.state])

  const tags = useMemo(() => [...new Set(flows.flatMap((f) => f.tags))].sort(), [flows])
  const shown = flows.filter((f) => (!tag || f.tags.includes(tag)) && f.name.toLowerCase().includes(q.toLowerCase()))

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

      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
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
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Steps</th>
                <th className="px-5 py-3 font-medium">Tags</th>
                <th className="px-5 py-3 font-medium">Recorded</th>
                <th className="w-28 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className="group border-b border-line last:border-0 hover:bg-sunken/60">
                  <td className="px-5 py-3.5 font-medium">{f.name}</td>
                  <td className="px-5 py-3.5 text-muted">{f.stepCount}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {f.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-muted">{timeAgo(f.updatedAt)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1 opacity-60 transition group-hover:opacity-100">
                      <Button size="icon" variant="ghost" disabled title="Replay comes in the next update">
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
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
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
