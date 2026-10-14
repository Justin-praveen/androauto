import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  AlertTriangle, ArrowLeft, Clock, Circle, CornerDownLeft, Eye, Hand, Home, Keyboard, Loader2, Lock, MousePointerClick,
  MoveVertical, Rocket, Send, Smartphone, Square, TextCursorInput, Trash2, Type, X
} from 'lucide-react'
import type { ElementInfo, MirrorFrame, RecordMode, Step, StepAction } from '@shared/types'
import { Badge, Button, Card, Checkbox, cx, Dialog, Field, Input } from '../components/ui'
import { api } from '../lib/api'
import { clock, describeStep, elementLabel, suggestVar } from '../lib/format'
import { useAction, useApp } from '../lib/state'

const ICONS: Record<StepAction, typeof Circle> = {
  launchApp: Rocket,
  tap: MousePointerClick,
  longPress: Hand,
  swipe: MoveVertical,
  scroll: MoveVertical,
  type: Type,
  pressKey: Keyboard,
  wait: Clock,
  assertVisible: Eye,
  assertText: TextCursorInput
}

export function RecorderPage() {
  const { project, device, recorder, go, toast } = useApp()
  const run = useAction()
  const [mode, setMode] = useState<RecordMode>(recorder.state === 'idle' ? 'phone' : recorder.mode)
  const [launchFirst, setLaunchFirst] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [assertKind, setAssertKind] = useState<'assertVisible' | 'assertText' | null>(null)

  const recording = recorder.state === 'recording'
  const starting = recorder.state === 'starting'
  const online = device?.state === 'device'
  const activeMode = recording || starting ? recorder.mode : mode

  useEffect(() => {
    if (!recording) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [recording])

  useEffect(() => {
    if (!recording) setAssertKind(null)
  }, [recording])

  if (!project) return null

  const start = (): Promise<unknown> =>
    run(async () => {
      if (!device) throw new Error('Connect a phone first')
      setBusy(true)
      try {
        await api.invoke('recorder:start', { serial: device.serial, projectId: project.id, mode, launchApp: launchFirst })
      } finally {
        setBusy(false)
      }
    })

  const stop = (): Promise<unknown> => run(() => api.invoke('recorder:stop'))

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Recorder</h1>
          <p className="mt-1 text-[13px] text-muted">
            {project.name} · {device ? device.model : 'no device'}
          </p>
        </div>
        {recorder.hierarchySource && (recording || starting) && (
          <Badge tone="accent">Reading screen via {recorder.hierarchySource === 'appium' ? 'Appium' : 'adb'}</Badge>
        )}
      </div>

      <Card className="mb-5 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex rounded-lg bg-sunken p-0.5">
          {(['phone', 'mirror'] as RecordMode[]).map((m) => (
            <button
              key={m}
              disabled={recording || starting}
              onClick={() => setMode(m)}
              className={cx(
                'h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium transition disabled:cursor-not-allowed',
                activeMode === m ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg'
              )}
              title={m === 'phone' ? 'Use the real phone in your hand' : 'Click on the mirror here; androauto performs the action'}
            >
              {m === 'phone' ? 'On phone' : 'In mirror'}
            </button>
          ))}
        </div>

        {!recording && !starting && (
          <>
            <Checkbox checked={launchFirst} onChange={setLaunchFirst} label="Launch app first" />
            <Button size="sm" variant="ghost" disabled={!online} onClick={() => run(() => api.invoke('devices:launch', device!.serial, project.id))}>
              <Rocket size={14} /> Launch now
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          {(recording || recorder.state === 'review') && (
            <span className="font-mono text-[13px] tabular-nums text-muted">
              {recording && recorder.startedAt ? clock(now - recorder.startedAt) : ''} · {recorder.steps.length} {recorder.steps.length === 1 ? 'step' : 'steps'}
            </span>
          )}
          {recording ? (
            <Button onClick={() => void stop()} className="border-rec/40 text-rec">
              <Square size={13} className="fill-current" /> Stop & save
            </Button>
          ) : (
            <Button variant="record" disabled={!online || busy || starting || recorder.state === 'review'} onClick={() => void start()}>
              {busy || starting ? <Loader2 size={14} className="animate-spin" /> : <Circle size={12} className="fill-white" />}
              Record
            </Button>
          )}
        </div>
      </Card>

      {recorder.message && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-[13px] text-warn">
          <AlertTriangle size={15} /> {recorder.message}
        </div>
      )}

      {!online ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Smartphone size={28} className="text-muted" />
          <div className="font-medium">Connect a phone to record</div>
          <p className="max-w-sm text-[13px] text-muted">Plug it in over USB with USB debugging on, or pair over Wi-Fi.</p>
          <Button onClick={() => go('devices')}>Open Devices</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(280px,420px)_1fr] gap-5">
          <MirrorPanel
            serial={device!.serial}
            screen={device!.screen}
            interactive={recording && recorder.mode === 'mirror'}
            recording={recording}
            assertKind={assertKind}
            onAssertDone={() => setAssertKind(null)}
            lastStep={recorder.steps[recorder.steps.length - 1]}
          />
          <StepsPanel
            recording={recording}
            mode={activeMode}
            steps={recorder.steps}
            assertKind={assertKind}
            setAssertKind={(k) => {
              if (recorder.mode !== 'mirror' && k) toast('Checks are added by clicking the element on the mirror; switch to "In mirror" to add them while recording', 'error')
              setAssertKind(recorder.mode === 'mirror' ? k : null)
            }}
          />
        </div>
      )}

      {recorder.state === 'review' && <SaveDialog />}
    </>
  )
}

function MirrorPanel({
  serial,
  screen,
  interactive,
  recording,
  assertKind,
  onAssertDone,
  lastStep
}: {
  serial: string
  screen: { w: number; h: number } | null
  interactive: boolean
  recording: boolean
  assertKind: 'assertVisible' | 'assertText' | null
  onAssertDone: () => void
  lastStep: Step | undefined
}) {
  const run = useAction()
  const [frame, setFrame] = useState<MirrorFrame | null>(null)
  const [hover, setHover] = useState<ElementInfo | null>(null)
  const [flash, setFlash] = useState<ElementInfo | null>(null)
  const [text, setText] = useState('')
  const imgRef = useRef<HTMLImageElement>(null)
  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const hoverReq = useRef(0)

  useEffect(() => {
    const off = api.on('mirror:frame', (f) => f.serial === serial && setFrame(f))
    void api.invoke('mirror:start', serial)
    return () => {
      off()
      void api.invoke('mirror:stop')
    }
  }, [serial])

  // Briefly highlight the element of each new step.
  useEffect(() => {
    const el = lastStep?.target?.element
    if (!el) return
    setFlash(el)
    const t = window.setTimeout(() => setFlash(null), 1400)
    return () => window.clearTimeout(t)
  }, [lastStep?.id, lastStep?.target?.element])

  const W = screen?.w ?? frame?.w ?? 1080
  const H = screen?.h ?? frame?.h ?? 2400

  const toDevice = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r) return null
    const x = Math.round(((e.clientX - r.left) / r.width) * W)
    const y = Math.round(((e.clientY - r.top) / r.height) * H)
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null
  }

  const onDown = (e: RPointerEvent): void => {
    if (!interactive) return
    const p = toDevice(e)
    if (p) down.current = { ...p, t: Date.now() }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const onUp = (e: RPointerEvent): void => {
    const start = down.current
    down.current = null
    if (!interactive || !start) return
    const end = toDevice(e) ?? start
    if (assertKind) {
      void run(() => api.invoke('recorder:addAssert', start.x, start.y, assertKind)).then(onAssertDone)
      return
    }
    void run(() => api.invoke('recorder:mirrorGesture', { from: start, to: end, durationMs: Date.now() - start.t }))
  }

  const onMove = useCallback(
    (e: RPointerEvent) => {
      if (!interactive) return
      const p = toDevice(e)
      if (!p) return setHover(null)
      const id = ++hoverReq.current
      window.setTimeout(() => {
        if (id !== hoverReq.current) return
        void api.invoke('mirror:elementAt', p.x, p.y).then((el) => id === hoverReq.current && setHover(el))
      }, 60)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interactive, W, H]
  )

  const box = (el: ElementInfo, cls: string) => {
    const [l, t, r, b] = el.bounds
    return (
      <div
        className={cx('pointer-events-none absolute rounded-[3px] border-2 transition-all duration-75', cls)}
        style={{ left: `${(l / W) * 100}%`, top: `${(t / H) * 100}%`, width: `${((r - l) / W) * 100}%`, height: `${((b - t) / H) * 100}%` }}
      />
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cx(
          'relative rounded-[28px] border-[6px] bg-black p-0 shadow-xl transition-colors',
          recording ? 'border-rec/70' : 'border-zinc-800 dark:border-zinc-700'
        )}
      >
        {frame ? (
          <div className="relative overflow-hidden rounded-[22px]">
            <img
              ref={imgRef}
              src={frame.dataUrl}
              alt="Phone screen"
              draggable={false}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerMove={onMove}
              onPointerLeave={() => {
                hoverReq.current++
                setHover(null)
              }}
              className={cx('block min-h-[360px] w-auto select-none', interactive ? 'max-h-[calc(100vh-360px)]' : 'max-h-[calc(100vh-310px)]', interactive ? (assertKind ? 'cursor-help' : 'cursor-crosshair') : 'cursor-default')}
            />
            {hover && interactive && box(hover, assertKind ? 'border-ok bg-ok/10' : 'border-accent bg-accent/10')}
            {flash && box(flash, 'border-rec bg-rec/15')}
            {hover && interactive && (
              <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-black/75 px-2.5 py-1.5 text-[11px] text-white backdrop-blur">
                <div className="truncate font-medium">{elementLabel(hover)}</div>
                <div className="truncate font-mono opacity-70">{hover.resourceId || hover.class}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[480px] w-[230px] items-center justify-center text-sm text-zinc-400">
            <Loader2 size={16} className="mr-2 animate-spin" /> Connecting…
          </div>
        )}
      </div>

      {interactive ? (
        <div className="w-full max-w-[340px] space-y-2">
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => run(() => api.invoke('recorder:mirrorKey', 'back'))}>
              <ArrowLeft size={14} /> Back
            </Button>
            <Button size="sm" className="flex-1" onClick={() => run(() => api.invoke('recorder:mirrorKey', 'home'))}>
              <Home size={14} /> Home
            </Button>
            <Button size="sm" className="flex-1" onClick={() => run(() => api.invoke('recorder:mirrorKey', 'enter'))}>
              <CornerDownLeft size={14} /> Enter
            </Button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!text) return
              void run(async () => {
                await api.invoke('recorder:mirrorText', text)
                setText('')
              })
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type into the focused field" className="h-8 text-[13px]" />
            <Button size="sm" type="submit" variant="primary" disabled={!text}>
              <Send size={14} />
            </Button>
          </form>
        </div>
      ) : (
        <p className="max-w-[320px] text-center text-xs text-muted">
          {recording ? 'Use your phone. Steps appear on the right as you go.' : 'Live view of your phone.'}
        </p>
      )}
    </div>
  )
}

function StepsPanel({
  recording,
  mode,
  steps,
  assertKind,
  setAssertKind
}: {
  recording: boolean
  mode: RecordMode
  steps: Step[]
  assertKind: 'assertVisible' | 'assertText' | null
  setAssertKind: (k: 'assertVisible' | 'assertText' | null) => void
}) {
  const run = useAction()
  const listRef = useRef<HTMLDivElement>(null)
  const [waitOpen, setWaitOpen] = useState(false)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [steps.length])

  return (
    <Card className="flex min-h-[480px] flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="text-sm font-semibold">Steps</div>
        {recording && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-rec">
            <span className="pulse h-2 w-2 rounded-full bg-rec" /> Recording
          </span>
        )}
      </div>

      <div ref={listRef} className="max-h-[calc(100vh-380px)] min-h-0 flex-1 overflow-y-auto py-1">
        {steps.length === 0 ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 px-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
              <MousePointerClick size={20} />
            </div>
            <div className="font-medium">{recording ? 'Waiting for your first action' : 'Ready to record'}</div>
            <p className="max-w-sm text-[13px] text-muted">
              {recording
                ? mode === 'phone'
                  ? 'Tap, swipe and type on the phone. Each action becomes a step here.'
                  : 'Click and drag on the mirror. androauto performs it on the phone and records the element.'
                : 'Hit Record, run through the flow, then Stop & save and give it a name.'}
            </p>
          </div>
        ) : (
          steps.map((s, i) => <StepRow key={s.id} step={s} n={i + 1} canDelete={recording} />)
        )}
      </div>

      {recording && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {assertKind ? (
            <>
              <span className="text-[13px] text-ok">Click an element on the mirror to check it</span>
              <Button size="sm" variant="ghost" onClick={() => setAssertKind(null)}>
                <X size={14} /> Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setAssertKind('assertVisible')} title={mode === 'phone' ? 'Available in "In mirror" mode' : undefined}>
                <Eye size={14} /> Check visible
              </Button>
              <Button size="sm" onClick={() => setAssertKind('assertText')} title={mode === 'phone' ? 'Available in "In mirror" mode' : undefined}>
                <TextCursorInput size={14} /> Check text
              </Button>
              <div className="relative">
                <Button size="sm" onClick={() => setWaitOpen(!waitOpen)}>
                  <Clock size={14} /> Add wait
                </Button>
                {waitOpen && (
                  <div className="absolute bottom-10 left-0 z-10 flex gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
                    {[1, 2, 5, 10].map((sec) => (
                      <button
                        key={sec}
                        className="h-7 cursor-pointer rounded-md px-2.5 text-[13px] hover:bg-sunken"
                        onClick={() => {
                          setWaitOpen(false)
                          void run(() => api.invoke('recorder:addWait', sec * 1000))
                        }}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function StepRow({ step, n, canDelete }: { step: Step; n: number; canDelete: boolean }) {
  const run = useAction()
  const Icon = ICONS[step.action]
  const d = describeStep(step)
  const loc = step.target?.locators[0]
  return (
    <div className="group flex items-center gap-3 px-5 py-2.5 hover:bg-sunken/60">
      <span className="w-5 text-right font-mono text-xs tabular-nums text-muted">{n}</span>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          <span className="font-medium">{d.verb}</span> <span>{d.detail}</span>
          {d.extra && <span className="text-muted"> {d.extra}</span>}
        </div>
        {loc && (
          <div className="truncate font-mono text-[11px] text-muted" title={step.target!.locators.map((l) => `${l.strategy}: ${l.value}`).join('\n')}>
            {loc.strategy} · {loc.value}
          </div>
        )}
      </div>
      {step.secret && (
        <span title="Password field: you'll enter the value when saving">
          <Lock size={14} className="text-muted" />
        </span>
      )}
      {step.warning && (
        <span title={step.warning}>
          <AlertTriangle size={14} className="text-warn" />
        </span>
      )}
      {canDelete && (
        <button
          className="cursor-pointer rounded-md p-1 text-muted opacity-0 transition hover:bg-bad/10 hover:text-bad group-hover:opacity-100"
          onClick={() => run(() => api.invoke('recorder:deleteStep', step.id))}
          title="Delete step"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

function SaveDialog() {
  const { recorder, toast, go, reloadProjects } = useApp()
  const run = useAction()
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [description, setDescription] = useState('')
  const typed = recorder.steps.filter((s) => s.action === 'type')
  const [vars, setVars] = useState<Record<string, { on: boolean; name: string }>>(() =>
    Object.fromEntries(typed.map((s) => [s.id, { on: !!s.secret, name: suggestVar(s) }]))
  )
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const missingSecret = typed.some((s) => s.secret && !secrets[s.id])
  const canSave = name.trim() && !missingSecret

  const save = (): Promise<unknown> =>
    run(async () => {
      const flow = await api.invoke('recorder:save', {
        name,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        variables: Object.fromEntries(Object.entries(vars).filter(([id, v]) => v.on || typed.find((s) => s.id === id)?.secret).map(([id, v]) => [id, v.name])),
        secretValues: secrets
      })
      toast(`Saved "${flow.name}" with ${flow.steps.length} steps`, 'ok')
      await reloadProjects()
      go('flows')
    })

  return (
    <Dialog
      open
      onClose={() => setConfirmDiscard(true)}
      title="Save flow"
      description={`${recorder.steps.length} steps recorded`}
      width="max-w-xl"
      footer={
        confirmDiscard ? (
          <>
            <span className="mr-auto self-center text-[13px] text-bad">Discard this recording?</span>
            <Button onClick={() => setConfirmDiscard(false)}>Keep</Button>
            <Button className="!border-bad/40 !text-bad" onClick={() => run(() => api.invoke('recorder:discard'))}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setConfirmDiscard(true)}>
              Discard
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
              Save flow
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <Field label="Flow name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Login with valid user" onKeyDown={(e) => e.key === 'Enter' && canSave && void save()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tags" hint="Comma separated">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="smoke, auth" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        {typed.length > 0 && (
          <div>
            <div className="mb-1 text-[13px] font-medium">Typed values</div>
            <p className="mb-3 text-xs text-muted">Turn values into variables to change them per run. Passwords are stored outside the flow file.</p>
            <div className="divide-y divide-line rounded-lg border border-line">
              {typed.map((s) => {
                const v = vars[s.id]
                const d = describeStep(s)
                return (
                  <div key={s.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      {s.secret ? <Lock size={13} className="text-muted" /> : <Type size={13} className="text-muted" />}
                      <span className="truncate">
                        {s.secret ? 'Password' : d.detail} <span className="text-muted">{d.extra}</span>
                      </span>
                    </div>
                    {s.secret ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="password"
                          value={secrets[s.id] ?? ''}
                          onChange={(e) => setSecrets({ ...secrets, [s.id]: e.target.value })}
                          placeholder="Value you typed (required)"
                          className="h-8 text-[13px]"
                        />
                        <Input
                          value={v.name}
                          onChange={(e) => setVars({ ...vars, [s.id]: { ...v, name: e.target.value } })}
                          className="h-8 font-mono text-[13px]"
                          title="Variable name"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Checkbox checked={v.on} onChange={(on) => setVars({ ...vars, [s.id]: { ...v, on } })} label={<span className="text-[13px]">Make a variable</span>} />
                        {v.on && (
                          <Input
                            value={v.name}
                            onChange={(e) => setVars({ ...vars, [s.id]: { ...v, name: e.target.value } })}
                            className="h-8 flex-1 font-mono text-[13px]"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
