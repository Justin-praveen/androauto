import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Download, Hand, Loader2, Play, Plus, Settings2, Sparkles } from 'lucide-react'
import { describeChange } from '@shared/ai-format'
import type { AiSettingsView, Flow, TestCategory, TestIdea, TestIdeas } from '@shared/types'
import { Badge, Button, Card, cx, Empty, Input, Select } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useStartRun } from '../lib/run'
import { cleanError, useAction, useApp } from '../lib/state'

const CATEGORY_TONE: Record<TestCategory, 'ok' | 'bad' | 'warn' | 'accent' | 'neutral'> = {
  positive: 'ok',
  negative: 'bad',
  boundary: 'warn',
  edge: 'accent',
  security: 'bad',
  usability: 'neutral'
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

export function toCsv(flow: Flow, ideas: TestIdea[]): string {
  const rows = [['ID', 'Title', 'Category', 'Priority', 'Type', 'Description', 'Steps', 'Expected']]
  for (const i of ideas) {
    const steps = i.automatable ? i.changes.map((c) => describeChange(c, flow)) : i.manualSteps
    rows.push([i.id, i.title, i.category, i.priority, i.automatable ? 'Automated' : 'Manual', i.description, steps.join('\n'), i.expected])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function IdeasPage() {
  const { project, ideasFlowId, go, toast, reloadProjects } = useApp()
  const run = useAction()
  const startRun = useStartRun()
  const [flow, setFlow] = useState<Flow | null>(null)
  const [data, setData] = useState<TestIdeas | null>(null)
  const [settings, setSettings] = useState<AiSettingsView | null>(null)
  const [count, setCount] = useState(12)
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cat, setCat] = useState<TestCategory | 'manual' | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!project || !ideasFlowId) return
    void api.invoke('flows:get', project.id, ideasFlowId).then(setFlow)
    void api.invoke('ai:ideas', project.id, ideasFlowId).then(setData)
    void api.invoke('ai:settings').then(setSettings)
  }, [project, ideasFlowId])

  const ideas = data?.ideas ?? []
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const i of ideas) {
      c[i.category] = (c[i.category] ?? 0) + 1
      if (!i.automatable) c.manual = (c.manual ?? 0) + 1
    }
    return c
  }, [ideas])
  const shown = ideas.filter((i) => !cat || (cat === 'manual' ? !i.automatable : i.category === cat))
  const selectable = shown.filter((i) => i.automatable && !i.createdFlowId)
  const chosen = ideas.filter((i) => picked.has(i.id))

  if (!project || !ideasFlowId) return null
  const configured = !!settings?.model && !!settings.baseUrl

  const generate = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const d = await api.invoke('ai:suggest', project.id, ideasFlowId, { count, focus })
      setData(d)
      setPicked(new Set())
      setCat(null)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  const create = (andRun: boolean): Promise<unknown> =>
    run(async () => {
      const made = await api.invoke('ai:createFlows', project.id, ideasFlowId, [...picked])
      setData(await api.invoke('ai:ideas', project.id, ideasFlowId))
      setPicked(new Set())
      await reloadProjects()
      toast(`Created ${made.length} ${made.length === 1 ? 'flow' : 'flows'} tagged "ai"`, 'ok')
      if (andRun && made.length) await startRun(made.map((f) => f.id))
    })

  const exportCsv = (): void => {
    if (!flow) return
    const a = document.createElement('a')
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + toCsv(flow, shown))}`
    a.download = `${flow.name.replace(/[^\w-]+/g, '-').toLowerCase()}-test-cases.csv`
    a.click()
  }

  const toggle = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  return (
    <>
      <button className="mb-4 flex cursor-pointer items-center gap-1.5 text-[13px] text-muted hover:text-fg" onClick={() => go('flows')}>
        <ArrowLeft size={14} /> Flows
      </button>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles size={18} className="text-accent" /> Test ideas
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {flow ? `From "${flow.name}" · ${flow.steps.length} steps` : ''}
            {data ? ` · ${data.model} · ${timeAgo(data.generatedAt)}` : ''}
            {data && flow && data.flowVersion !== flow.version ? ' · flow changed since' : ''}
          </p>
        </div>
        {ideas.length > 0 && (
          <Button size="sm" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
        )}
      </div>

      {!configured && settings && (
        <Card className="mb-5 flex items-center gap-4 border-warn/40 px-5 py-4">
          <Settings2 size={18} className="text-warn" />
          <div className="flex-1 text-[13px]">Connect your AI provider (OmniRoute or any OpenAI-compatible API) to generate test cases.</div>
          <Button size="sm" variant="primary" onClick={() => go('settings')}>
            Open Settings
          </Button>
        </Card>
      )}

      <Card className="mb-5 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="w-40 shrink-0">
          <Select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}>
            {[8, 12, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n} test cases
              </option>
            ))}
          </Select>
        </div>
        <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Anything to focus on? e.g. password rules, special characters" className="min-w-[240px] flex-1" disabled={busy} />
        <Button variant="primary" disabled={!configured || busy} onClick={() => void generate()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? 'Thinking…' : ideas.length ? 'Generate again' : 'Generate'}
        </Button>
      </Card>

      {busy && <p className="mb-4 text-[13px] text-muted">The AI is reading the flow and the screens it recorded. This can take up to a minute.</p>}
      {error && <div className="mb-4 rounded-lg border border-bad/30 bg-bad/10 px-4 py-2.5 text-[13px] text-bad">{error}</div>}

      {!ideas.length && !busy ? (
        <Empty icon={<Sparkles size={20} />} title="Turn one flow into many tests">
          The AI looks at each step and screen of this flow and suggests what else to check: empty and invalid inputs, limits, repeated taps, interruptions and security. Pick the ones you want and they become flows you can run.
        </Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {([null, 'positive', 'negative', 'boundary', 'edge', 'security', 'usability', 'manual'] as const).map((c) =>
              c && !counts[c] ? null : (
                <button
                  key={c ?? 'all'}
                  onClick={() => setCat(c)}
                  className={cx(
                    'h-7 cursor-pointer rounded-full border px-3 text-xs font-medium capitalize transition',
                    cat === c ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg'
                  )}
                >
                  {c ?? 'All'} <span className="opacity-60">{c ? counts[c] : ideas.length}</span>
                </button>
              )
            )}
            {selectable.length > 0 && (
              <button
                className="ml-auto cursor-pointer text-xs font-medium text-accent hover:underline"
                onClick={() => setPicked(new Set([...picked, ...selectable.map((i) => i.id)]))}
              >
                Select all automatable ({selectable.length})
              </button>
            )}
          </div>

          <div className="space-y-3 pb-24">
            {shown.map((i) => (
              <IdeaCard key={i.id} idea={i} flow={flow} checked={picked.has(i.id)} onToggle={() => toggle(i.id)} />
            ))}
          </div>
        </>
      )}

      {chosen.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-xl">
          <span className="text-sm font-medium">{chosen.length} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
          <Button size="sm" onClick={() => void create(false)}>
            <Plus size={14} /> Create {chosen.length} {chosen.length === 1 ? 'flow' : 'flows'}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void create(true)}>
            <Play size={14} className="fill-current" /> Create and run
          </Button>
        </div>
      )}
    </>
  )
}

function IdeaCard({ idea, flow, checked, onToggle }: { idea: TestIdea; flow: Flow | null; checked: boolean; onToggle: () => void }) {
  const created = !!idea.createdFlowId
  const canPick = idea.automatable && !created
  return (
    <Card className={cx('flex gap-4 p-4', checked && 'border-accent/60 bg-accent-soft/30')}>
      <div className="pt-0.5">
        {canPick ? (
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${idea.title}`} className="h-4 w-4 cursor-pointer accent-[var(--accent)]" />
        ) : created ? (
          <Check size={16} className="text-ok" />
        ) : (
          <Hand size={16} className="text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{idea.title}</span>
          <Badge tone={CATEGORY_TONE[idea.category]}>{idea.category}</Badge>
          {idea.priority === 'high' && <Badge tone="bad">high priority</Badge>}
          {idea.priority === 'low' && <Badge>low priority</Badge>}
          {!idea.automatable && <Badge>manual</Badge>}
          {created && <Badge tone="ok">flow created</Badge>}
        </div>
        {idea.description && <p className="mt-1 text-[13px] text-muted">{idea.description}</p>}
        <div className="mt-2.5 grid gap-3 text-[13px] md:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">{idea.automatable ? 'Changes to the flow' : 'Steps'}</div>
            <ol className="list-decimal space-y-0.5 pl-4">
              {(idea.automatable && flow ? idea.changes.map((c) => describeChange(c, flow)) : idea.manualSteps).map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ol>
          </div>
          {idea.expected && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Expected</div>
              <p>{idea.expected}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
