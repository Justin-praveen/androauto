// In-memory backend for previewing the UI in a browser without Electron or a phone.

import type { AndroautoBridge, EventApi, InvokeApi } from '@shared/api'
import type { AiSettingsView, BatchStatus, Device, ElementInfo, Flow, Project, RecorderStatus, Run, Step, TestIdea, TestIdeas } from '@shared/types'

type Handler = (...args: never[]) => unknown

const W = 1080
const H = 2400

const ELEMENTS: ElementInfo[] = [
  { class: 'android.widget.TextView', text: 'Welcome back', resourceId: 'com.example.shop:id/title', contentDesc: '', bounds: [96, 360, 984, 470] },
  { class: 'android.widget.EditText', text: 'Email', resourceId: 'com.example.shop:id/email', contentDesc: '', bounds: [96, 620, 984, 764] },
  { class: 'android.widget.EditText', text: 'Password', resourceId: 'com.example.shop:id/password', contentDesc: '', bounds: [96, 820, 984, 964], password: true },
  { class: 'android.widget.Button', text: 'Log in', resourceId: 'com.example.shop:id/login_btn', contentDesc: 'Log in', bounds: [96, 1080, 984, 1224] },
  { class: 'android.widget.TextView', text: 'Forgot password?', resourceId: 'com.example.shop:id/forgot', contentDesc: '', bounds: [340, 1290, 740, 1380] }
]

function screenSvg(): string {
  const rects = ELEMENTS.map((e) => {
    const [l, t, r, b] = e.bounds
    const isBtn = e.class.endsWith('Button')
    const isField = e.class.endsWith('EditText')
    const fill = isBtn ? '#4f46e5' : isField ? '#f3f4f6' : 'none'
    const color = isBtn ? '#fff' : isField ? '#9ca3af' : e.text === 'Welcome back' ? '#111827' : '#4f46e5'
    const size = e.text === 'Welcome back' ? 72 : 44
    return `<rect x="${l}" y="${t}" width="${r - l}" height="${b - t}" rx="28" fill="${fill}"/>
      <text x="${isField ? l + 40 : (l + r) / 2}" y="${(t + b) / 2 + size / 3}" font-size="${size}" font-family="sans-serif" font-weight="${isBtn || size > 50 ? 600 : 400}" fill="${color}" text-anchor="${isField ? 'start' : 'middle'}">${e.text}</text>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect width="${W}" height="96" fill="#eef2ff"/>
    <text x="60" y="64" font-size="36" font-family="sans-serif" fill="#374151">9:41</text>
    <circle cx="540" cy="230" r="70" fill="#eef2ff"/><text x="540" y="252" font-size="64" text-anchor="middle" font-family="sans-serif" fill="#4f46e5">🛍</text>
    ${rects}
    <rect x="360" y="2340" width="360" height="12" rx="6" fill="#d1d5db"/>
  </svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

export function createMockBridge(): AndroautoBridge {
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const emit = <K extends keyof EventApi>(ch: K, p: EventApi[K]): void => listeners.get(ch)?.forEach((cb) => cb(p))

  const now = new Date().toISOString()
  const projects: Project[] = [
    { id: 'prj_demo1', name: 'Shop App', appPackage: 'com.example.shop', appActivity: '.MainActivity', launchOptions: { clearDataBeforeRun: false, grantPermissions: true }, createdAt: now },
    { id: 'prj_demo2', name: 'Bank App', appPackage: 'com.example.bank', appActivity: '.LaunchActivity', launchOptions: { clearDataBeforeRun: true, grantPermissions: true }, createdAt: now }
  ]
  const flows: Flow[] = [
    mkFlow('flw_a1', 'prj_demo1', 'Login with saved account', ['smoke', 'auth'], 5),
    mkFlow('flw_a2', 'prj_demo1', 'Add first item to cart', ['checkout'], 9),
    mkFlow('flw_a3', 'prj_demo1', 'Search "shoes"', [], 6)
  ]
  const devices: Device[] = [
    { serial: 'R5CT1234', state: 'device', model: 'Pixel 7', android: '14', sdk: 34, screen: { w: W, h: H, density: 420 }, connection: 'usb' },
    { serial: '192.168.1.20:41235', state: 'device', model: 'Galaxy S23', android: '14', sdk: 34, screen: { w: 1080, h: 2340, density: 450 }, connection: 'wifi' },
    { serial: 'emulator-5554', state: 'offline', model: 'emulator-5554', android: '', sdk: 0, screen: null, connection: 'emulator' }
  ]

  let status: RecorderStatus = { state: 'idle', mode: 'phone', serial: null, projectId: null, startedAt: null, steps: [], hierarchySource: null }
  let counter = 0
  let mirrorTimer: number | undefined
  let scriptTimer: number | undefined
  const frame = screenSvg()
  const runs: Run[] = []
  let aiSettings: AiSettingsView = { baseUrl: 'http://localhost:20128/v1', model: 'cc/claude-sonnet-4', temperature: 0.4, hasApiKey: true }
  const ideasByFlow = new Map<string, TestIdeas>()
  const demoIdeas = (): TestIdea[] => {
    const mk = (id: number, title: string, category: TestIdea['category'], priority: TestIdea['priority'], description: string, expected: string, changes: TestIdea['changes'], manualSteps: string[] = []): TestIdea => ({
      id: `idea_${String(id).padStart(2, '0')}`, title, category, priority, description, expected, automatable: changes.length > 0, changes, manualSteps
    })
    return [
      mk(1, 'Empty email', 'negative', 'high', 'Submit the form with the email left blank.', 'An "Email is required" message shows and the user stays on the login screen.', [{ type: 'setText', stepId: 'stp_1', value: '' }, { type: 'stopAfter', stepId: 'stp_3' }, { type: 'assertTextContains', afterStepId: 'stp_3', text: 'required' }]),
      mk(2, 'Invalid email format', 'negative', 'high', 'Use an address without an @ sign.', 'An invalid email message shows; no login request is made.', [{ type: 'setText', stepId: 'stp_1', value: 'demo.example.com' }, { type: 'stopAfter', stepId: 'stp_3' }]),
      mk(3, 'Wrong password', 'negative', 'high', 'Valid email with an incorrect password.', 'An "Incorrect password" error shows and the password field is cleared.', [{ type: 'setText', stepId: 'stp_2', value: 'wrong-pass-123' }, { type: 'stopAfter', stepId: 'stp_3' }]),
      mk(4, 'Email with spaces around it', 'boundary', 'medium', 'Leading and trailing spaces should be trimmed.', 'Login succeeds as with the plain address.', [{ type: 'setText', stepId: 'stp_1', value: '  demo@example.com  ' }]),
      mk(5, 'Very long email (255 chars)', 'boundary', 'medium', 'Checks the field length limit.', 'The field stops at its limit or shows a clear error; the app does not crash.', [{ type: 'setText', stepId: 'stp_1', value: `${'a'.repeat(243)}@example.com` }, { type: 'stopAfter', stepId: 'stp_3' }]),
      mk(6, 'Double tap Log in', 'edge', 'medium', 'Tapping twice quickly must not send two logins.', 'One login happens and the home screen shows once.', [{ type: 'repeatStep', stepId: 'stp_3', times: 2 }]),
      mk(7, 'Back during login', 'edge', 'low', 'Press back right after typing the email.', 'The keyboard closes and the typed email is kept.', [{ type: 'pressKey', afterStepId: 'stp_1', key: 'back' }]),
      mk(8, 'SQL injection in email', 'security', 'high', "Classic ' OR 1=1 -- string in the email field.", 'Rejected as an invalid email; no server error is shown.', [{ type: 'setText', stepId: 'stp_1', value: "' OR 1=1 --" }, { type: 'stopAfter', stepId: 'stp_3' }]),
      mk(9, 'Rotate the phone mid-login', 'usability', 'low', 'Typed values should survive a configuration change.', 'Email and password stay filled after rotating.', [], ['Type the email and password', 'Rotate the phone to landscape', 'Check both fields still have their values']),
      mk(10, 'Login with valid user', 'positive', 'high', 'The recorded happy path.', 'The home screen shows "Welcome back".', [{ type: 'assertTextContains', afterStepId: 'stp_3', text: 'Welcome' }])
    ]
  }
  let batch: BatchStatus | null = null
  let batchTimer: number | undefined
  const summary = (r: Run) => {
    const { steps, ...rest } = r
    const f = steps.findIndex((x) => x.status === 'failed')
    return { ...rest, stepCount: steps.length, failedStep: f >= 0 ? f + 1 : null }
  }
  const tickBatch = (): void => {
    if (!batch) return
    const run = batch.runs[batch.current]
    if (!run) {
      batch.state = 'done'
      batch.finishedAt = Date.now()
      window.clearInterval(batchTimer)
    } else {
      if (run.status === 'queued') {
        run.status = 'running'
        run.startedAt = new Date().toISOString()
      }
      const i = run.steps.findIndex((x) => x.status === 'pending' || x.status === 'running')
      const failAt = /cart/i.test(run.flowName) ? Math.min(6, run.steps.length - 1) : -1
      if (i >= 0 && run.steps[i].status === 'pending') run.steps[i].status = 'running'
      else if (i >= 0) {
        const st = run.steps[i]
        st.durationMs = 400 + Math.round(Math.random() * 900)
        st.screenshot = 'shot.png'
        if (i === failAt) {
          st.status = 'failed'
          st.error = 'Element not found after 10s (tried id, xpath)'
          run.steps.slice(i + 1).forEach((x) => (x.status = 'skipped'))
        } else {
          st.status = 'passed'
          st.locatorUsed = 'id'
        }
      }
      if (run.steps.every((x) => x.status !== 'pending' && x.status !== 'running')) {
        const failed = run.steps.some((x) => x.status === 'failed')
        run.status = failed ? 'failed' : 'passed'
        run.error = run.steps.find((x) => x.status === 'failed')?.error
        run.durationMs = run.steps.reduce((a, x) => a + (x.durationMs ?? 0), 0)
        runs.unshift(structuredClone(run))
        batch.current++
      }
    }
    emit('runs:status', structuredClone(batch))
  }

  const setStatus = (s: Partial<RecorderStatus>): RecorderStatus => {
    status = { ...status, ...s }
    emit('recorder:status', status)
    return status
  }
  const el = (x: number, y: number): ElementInfo | null =>
    ELEMENTS.find((e) => x >= e.bounds[0] && x < e.bounds[2] && y >= e.bounds[1] && y < e.bounds[3]) ?? null
  const step = (s: Omit<Step, 'id' | 'waitBeforeMs' | 'timeoutMs'>): Step => ({
    id: `stp_${String(++counter).padStart(2, '0')}`, waitBeforeMs: 0, timeoutMs: 10000, ...s
  })
  const target = (e: ElementInfo | null, x: number, y: number): Step['target'] => ({
    locators: e ? [{ strategy: 'id', value: e.resourceId }, { strategy: 'xpath', value: `//${e.class}[@text='${e.text}']` }] : [],
    element: e,
    fallbackPoint: { xPct: x / W, yPct: y / H }
  })
  const add = (s: Omit<Step, 'id' | 'waitBeforeMs' | 'timeoutMs'>): RecorderStatus => setStatus({ steps: [...status.steps, step(s)] })

  const handlers: Record<keyof InvokeApi, Handler> = {
    'projects:list': () => projects.map((p) => ({ ...p, flowCount: flows.filter((f) => f.projectId === p.id).length })),
    'projects:create': (input: { name: string; appPackage: string; appActivity: string }) => {
      const p: Project = { id: `prj_${Math.random().toString(16).slice(2, 8)}`, ...input, launchOptions: { clearDataBeforeRun: false, grantPermissions: true }, createdAt: new Date().toISOString() }
      projects.unshift(p)
      return p
    },
    'projects:update': (id: string, patch: Partial<Project>) => Object.assign(projects.find((p) => p.id === id)!, patch),
    'projects:delete': (id: string) => void projects.splice(projects.findIndex((p) => p.id === id), 1),
    'flows:list': (projectId: string) =>
      flows.filter((f) => f.projectId === projectId).map((f) => {
        const r = runs.find((x) => x.flowId === f.id)
        return {
          id: f.id, projectId: f.projectId, name: f.name, tags: f.tags, version: f.version, updatedAt: f.updatedAt, stepCount: f.steps.length,
          ...(r ? { lastRun: { id: r.id, status: r.status, startedAt: r.startedAt, durationMs: r.durationMs, failedStep: summary(r).failedStep } } : {})
        }
      }),
    'flows:get': (_p: string, id: string) => flows.find((f) => f.id === id),
    'flows:delete': (_p: string, id: string) => void flows.splice(flows.findIndex((f) => f.id === id), 1),
    'devices:list': () => devices,
    'devices:setup': () => ({
      adb: { ok: true, detail: 'Android Debug Bridge version 1.0.41' },
      appium: { ok: true, detail: 'Running on 127.0.0.1:4723' },
      uiautomator2: { ok: true, detail: 'uiautomator2 4.2.1' }
    }),
    'devices:pair': () => 'Successfully paired',
    'devices:connect': (hp: string) => `connected to ${hp}`,
    'devices:apps': () => [
      { package: 'com.example.bank', activity: '.LaunchActivity' },
      { package: 'com.example.shop', activity: '.MainActivity' },
      { package: 'com.example.notes', activity: null }
    ],
    'devices:launch': () => undefined,
    'appium:start': () => handlers['devices:setup'](),
    'mirror:start': (serial: string) => {
      window.clearInterval(mirrorTimer)
      const d = devices.find((x) => x.serial === serial)
      const send = (): void => emit('mirror:frame', { serial, dataUrl: frame, w: d?.screen?.w ?? W, h: d?.screen?.h ?? H, at: Date.now() })
      send()
      mirrorTimer = window.setInterval(send, 2000)
    },
    'mirror:stop': () => window.clearInterval(mirrorTimer),
    'mirror:elementAt': (x: number, y: number) => el(x, y),
    'recorder:start': (o: { serial: string; projectId: string; mode: 'phone' | 'mirror'; launchApp: boolean }) => {
      counter = 0
      const p = projects.find((x) => x.id === o.projectId)!
      const steps = o.launchApp ? [step({ action: 'launchApp', params: { appPackage: p.appPackage, appActivity: p.appActivity } })] : []
      setStatus({ state: 'recording', mode: o.mode, serial: o.serial, projectId: o.projectId, startedAt: Date.now(), steps, hierarchySource: 'appium', message: undefined })
      if (o.mode === 'phone') {
        // Pretend the user is using the phone.
        const script: (() => void)[] = [
          () => add({ action: 'tap', target: target(ELEMENTS[1], 540, 690) }),
          () => add({ action: 'type', target: target(ELEMENTS[1], 540, 690), params: { text: 'demo@example.com' } }),
          () => add({ action: 'tap', target: target(ELEMENTS[2], 540, 890) }),
          () => add({ action: 'type', target: target(ELEMENTS[2], 540, 890), params: { text: '', masked: 8 }, secret: true }),
          () => add({ action: 'tap', target: target(ELEMENTS[3], 540, 1150) }),
          () => add({ action: 'scroll', target: target(null, 540, 1700), params: { direction: 'up', scroll: 'down' }, warning: 'No element at this point: uses coordinates' })
        ]
        let i = 0
        window.clearInterval(scriptTimer)
        scriptTimer = window.setInterval(() => (i < script.length ? script[i++]() : window.clearInterval(scriptTimer)), 1400)
      }
      return status
    },
    'recorder:stop': () => {
      window.clearInterval(scriptTimer)
      return setStatus({ state: status.steps.length ? 'review' : 'idle' })
    },
    'recorder:status': () => status,
    'recorder:deleteStep': (id: string) => setStatus({ steps: status.steps.filter((s) => s.id !== id) }),
    'recorder:addWait': (ms: number) => add({ action: 'wait', params: { ms } }),
    'recorder:mirrorGesture': (g: { from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }) => {
      const moved = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y)
      if (moved < 12) return add({ action: g.durationMs >= 500 ? 'longPress' : 'tap', target: target(el(g.from.x, g.from.y), g.from.x, g.from.y) })
      return add({ action: 'swipe', params: { direction: Math.abs(g.to.y - g.from.y) > Math.abs(g.to.x - g.from.x) ? (g.to.y > g.from.y ? 'down' : 'up') : g.to.x > g.from.x ? 'right' : 'left' } })
    },
    'recorder:mirrorText': (text: string) => add({ action: 'type', target: target(ELEMENTS[1], 540, 690), params: { text } }),
    'recorder:mirrorKey': (key: string) => add({ action: 'pressKey', params: { key } }),
    'recorder:addAssert': (x: number, y: number, kind: 'assertVisible' | 'assertText') => {
      const e = el(x, y)
      if (!e) throw new Error('No element at that point')
      return add({ action: kind, target: target(e, x, y), ...(kind === 'assertText' ? { params: { text: e.text } } : {}) })
    },
    'recorder:save': (req: { name: string; tags: string[] }) => {
      if (!req.name.trim()) throw new Error('Flow name is required')
      const f = mkFlow(`flw_${Math.random().toString(16).slice(2, 6)}`, status.projectId!, req.name, req.tags, 0)
      f.steps = status.steps
      flows.unshift(f)
      setStatus({ state: 'idle', steps: [], serial: status.serial })
      return f
    },
    'runs:start': (o: { projectId: string; flowIds: string[]; serial: string }) => {
      const d = devices.find((x) => x.serial === o.serial)!
      batch = {
        id: 'bat_demo', projectId: o.projectId, serial: o.serial, state: 'running', startedAt: Date.now(), finishedAt: null, current: 0,
        runs: o.flowIds.map((id, i) => {
          const f = flows.find((x) => x.id === id)!
          return {
            id: `run_${Date.now().toString(36)}${i}`, projectId: o.projectId, flowId: f.id, flowName: f.name, flowVersion: f.version,
            device: d.serial, deviceModel: d.model, status: 'queued' as const, startedAt: '', durationMs: 0,
            steps: f.steps.map((s) => ({ stepId: s.id, status: 'pending' as const }))
          }
        })
      }
      window.clearInterval(batchTimer)
      batchTimer = window.setInterval(tickBatch, 350)
      emit('runs:status', structuredClone(batch))
      return structuredClone(batch)
    },
    'runs:abort': () => {
      if (batch?.state === 'running') {
        window.clearInterval(batchTimer)
        batch.state = 'aborted'
        batch.finishedAt = Date.now()
        batch.runs.forEach((r) => {
          if (r.status === 'queued' || r.status === 'running') {
            r.status = 'aborted'
            r.steps.forEach((x) => x.status === 'pending' || x.status === 'running' ? (x.status = 'skipped') : null)
            runs.unshift(structuredClone(r))
          }
        })
        emit('runs:status', structuredClone(batch))
      }
      return batch
    },
    'runs:status': () => batch,
    'runs:list': (projectId: string) => runs.filter((r) => r.projectId === projectId).map(summary),
    'runs:get': (_p: string, id: string) => {
      const r = runs.find((x) => x.id === id) ?? batch?.runs.find((x) => x.id === id)
      if (!r) throw new Error('Run not found')
      return r
    },
    'runs:image': () => frame,
    'ai:settings': () => aiSettings,
    'ai:saveSettings': (patch: Partial<AiSettingsView> & { apiKey?: string }) => {
      const { apiKey, ...rest } = patch
      aiSettings = { ...aiSettings, ...rest, hasApiKey: apiKey === undefined ? aiSettings.hasApiKey : !!apiKey }
      return aiSettings
    },
    'ai:models': () => ['cc/claude-sonnet-4', 'cc/claude-opus-4', 'gemini/gemini-2.5-pro', 'openrouter/qwen3-coder', 'qa-combo'],
    'ai:test': () => 'OK',
    'ai:suggest': async (_p: string, flowId: string) => {
      await new Promise((r) => setTimeout(r, 1500))
      const f = flows.find((x) => x.id === flowId)!
      const d: TestIdeas = { flowId, flowVersion: f.version, model: aiSettings.model, generatedAt: new Date().toISOString(), ideas: demoIdeas() }
      ideasByFlow.set(flowId, d)
      return d
    },
    'ai:ideas': (_p: string, flowId: string) => ideasByFlow.get(flowId) ?? null,
    'ai:createFlows': (projectId: string, flowId: string, ids: string[]) => {
      const src = flows.find((x) => x.id === flowId)!
      const d = ideasByFlow.get(flowId)!
      return d.ideas
        .filter((i) => ids.includes(i.id) && i.automatable)
        .map((i) => {
          const f = mkFlow(`flw_${Math.random().toString(16).slice(2, 6)}`, projectId, `${src.name} · ${i.title}`, ['ai', i.category], src.steps.length)
          flows.push(f)
          i.createdFlowId = f.id
          return f
        })
    },
    'recorder:discard': () => {
      window.clearInterval(scriptTimer)
      return setStatus({ state: 'idle', steps: [] })
    }
  }

  return {
    invoke: (async (ch: keyof InvokeApi, ...args: never[]) => {
      await new Promise((r) => setTimeout(r, 60))
      return handlers[ch](...args)
    }) as AndroautoBridge['invoke'],
    on: (ch, cb) => {
      const set = listeners.get(ch) ?? new Set()
      set.add(cb as (p: unknown) => void)
      listeners.set(ch, set)
      return () => set.delete(cb as (p: unknown) => void)
    }
  }
}

function mkFlow(id: string, projectId: string, name: string, tags: string[], n: number): Flow {
  const t = new Date(Date.now() - Math.random() * 86400000 * 3).toISOString()
  return {
    id, projectId, name, description: '', tags, version: 1, recordedOn: null,
    startState: { launchApp: true, clearData: false }, variables: {},
    steps: Array.from({ length: n }, (_, i) => ({
      id: `stp_${i + 1}`, action: 'tap' as const, waitBeforeMs: 0, timeoutMs: 10000,
      target: { locators: [], fallbackPoint: { xPct: 0.5, yPct: 0.5 }, element: { class: 'android.widget.Button', text: ['Log in', 'Shoes', 'Add to cart', 'Cart', 'Checkout', 'Size 9', 'Add to bag', 'Pay', 'Done'][i % 9], resourceId: '', contentDesc: '', bounds: [0, 0, 1, 1] as [number, number, number, number] } }
    })),
    createdAt: t, updatedAt: t
  }
}
