import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chat, extractJson, type FetchLike } from '../src/main/ai/client'
import { AiService } from '../src/main/ai/service'
import { applyIdea, buildPrompt, describeChange, describeScreens, describeSteps, parseIdeas } from '../src/main/ai/testcases'
import { Store } from '../src/main/store'
import type { Flow, Step, TestIdea } from '../src/shared/types'
import { fixture } from './helpers'

const el = (text: string, id: string, cls = 'android.widget.EditText') => ({ class: cls, text, resourceId: `com.example.shop:id/${id}`, contentDesc: '', bounds: [0, 0, 1, 1] as [number, number, number, number] })
const tgt = (e: ReturnType<typeof el>) => ({ locators: [{ strategy: 'id' as const, value: e.resourceId }], element: e, fallbackPoint: { xPct: 0.5, yPct: 0.5 } })
const st = (id: string, action: Step['action'], extra: Partial<Step> = {}): Step => ({ id, action, waitBeforeMs: 0, timeoutMs: 10000, ...extra })

const flow: Flow = {
  id: 'flw_login', projectId: 'prj_x', name: 'Login', description: '', tags: ['smoke'], version: 1, recordedOn: null,
  startState: { launchApp: true, clearData: false },
  variables: { username: 'demo@example.com', password: '${secret:shop_password}' },
  steps: [
    st('stp_01', 'launchApp', { params: { appPackage: 'com.example.shop' } }),
    st('stp_02', 'type', { target: tgt(el('Email', 'email')), params: { text: '${username}' }, snapshot: 'login/snapshots/stp_02' }),
    st('stp_03', 'type', { target: tgt(el('Password', 'password')), params: { text: '${password}' }, secret: true }),
    st('stp_04', 'tap', { target: tgt(el('Log in', 'login_btn', 'android.widget.Button')) }),
    st('stp_05', 'assertVisible', { target: tgt(el('Welcome back', 'title', 'android.widget.TextView')) })
  ],
  createdAt: '', updatedAt: ''
}

const AI_REPLY = `Here you go:
\`\`\`json
{"testCases":[
 {"title":"Empty email","category":"negative","priority":"high","description":"Submit without an email","expected":"Shows 'Email is required'","automatable":true,
  "changes":[{"type":"setText","stepId":"stp_02","value":""},{"type":"stopAfter","stepId":"stp_04"},{"type":"assertTextContains","afterStepId":"stp_04","text":"required"}]},
 {"title":"Double tap login","category":"edge","priority":"medium","description":"","expected":"Logs in once","automatable":true,
  "changes":[{"type":"repeatStep","stepId":"stp_04","times":2},{"type":"setText","stepId":"stp_04","value":"nope"},{"type":"removeStep","stepId":"stp_99"}]},
 {"title":"Rotate during login","category":"usability","priority":"low","description":"","expected":"Fields keep values","automatable":false,"changes":[],"manualSteps":["Type email","Rotate the phone"]},
 {"title":"Bad category","category":"chaos","priority":"urgent","automatable":true,"changes":[{"type":"pressKey","afterStepId":"stp_02","key":"back"}]},
 {"description":"no title"}
]}
\`\`\`
Hope that helps {not json}`

describe('AI client', () => {
  it('extracts JSON from fenced, wrapped or bare answers', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('sure! {"a":"}{"} trailing')).toEqual({ a: '}{' })
    expect((extractJson(AI_REPLY) as { testCases: unknown[] }).testCases).toHaveLength(5)
    expect(() => extractJson('{"a":[1,2')).toThrow(/cut off/)
    expect(() => extractJson('nothing here')).toThrow(/no JSON/)
  })

  it('calls an OpenAI-compatible endpoint with the key and model', async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = []
    const fetchFn: FetchLike = async (url, init) => {
      seen.push({ url, headers: init.headers, body: init.body ?? '' })
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) }
    }
    const out = await chat({ baseUrl: 'http://localhost:20128/v1/', model: 'cc/claude-sonnet', temperature: 0.4, apiKey: 'sk-1' }, [{ role: 'user', content: 'hi' }], fetchFn)
    expect(out).toBe('OK')
    expect(seen[0].url).toBe('http://localhost:20128/v1/chat/completions')
    expect(seen[0].headers.Authorization).toBe('Bearer sk-1')
    expect(JSON.parse(seen[0].body)).toMatchObject({ model: 'cc/claude-sonnet', stream: false })
  })

  it('explains auth and server errors', async () => {
    const fail = (status: number, body: string): FetchLike => async () => ({ ok: false, status, text: async () => body })
    const s = { baseUrl: 'http://x/v1', model: 'm', temperature: 0, apiKey: '' }
    await expect(chat(s, [], fail(401, '{"error":{"message":"bad key"}}'))).rejects.toThrow(/rejected the API key \(401\): bad key/)
    await expect(chat(s, [], fail(500, 'boom'))).rejects.toThrow(/AI server error 500: boom/)
    await expect(chat({ ...s, model: '' }, [])).rejects.toThrow(/Pick a model/)
  })
})

describe('test ideas', () => {
  it('describes the flow and screens for the model', () => {
    const steps = describeSteps(flow)
    expect(steps).toContain('2. [stp_02] type ${username} = "demo@example.com" into "Email" (id email) [EditText]')
    expect(steps).toContain('3. [stp_03] type (password, hidden) into')
    const screens = describeScreens(flow, (id) => (id === 'stp_02' ? fixture('login-dump.xml') : null))
    expect(screens).toContain('Screen before step [stp_02]')
    expect(screens).toContain('- input password (shows "Password") [password]')
    expect(screens).toContain('- button/link "Log in"')
    const msgs = buildPrompt({ id: 'prj_x', name: 'Shop', appPackage: 'com.example.shop', appActivity: '', launchOptions: { clearDataBeforeRun: false, grantPermissions: true }, createdAt: '' }, flow, screens, { count: 12, focus: 'password rules' })
    expect(msgs[1].content).toContain('Write 12 test cases')
    expect(msgs[1].content).toContain('Focus on: password rules')
  })

  it('keeps only valid ideas and changes', () => {
    const ideas = parseIdeas(extractJson(AI_REPLY), flow)
    expect(ideas.map((i) => i.title)).toEqual(['Empty email', 'Double tap login', 'Rotate during login', 'Bad category'])
    expect(ideas[1].changes).toEqual([{ type: 'repeatStep', stepId: 'stp_04', times: 2 }]) // setText on a tap and an unknown step dropped
    expect(ideas[2]).toMatchObject({ automatable: false, manualSteps: ['Type email', 'Rotate the phone'] })
    expect(ideas[3]).toMatchObject({ category: 'edge', priority: 'medium' })
    expect(() => parseIdeas({ testCases: [] }, flow)).toThrow(/usable/)
  })

  it('applies changes to make a runnable variant', () => {
    const ideas = parseIdeas(extractJson(AI_REPLY), flow)
    const empty = applyIdea(flow, ideas[0])
    expect(empty.map((s) => `${s.id}:${s.action}`)).toEqual(['stp_01:launchApp', 'stp_02:type', 'stp_03:type', 'stp_04:tap', 'stp_ai01:assertText'])
    expect(empty[1].params).toEqual({ text: '' })
    expect(empty[4].params).toEqual({ text: 'required', contains: true })
    expect(empty[4].target!.locators[0].value).toBe('new UiSelector().textContains("required")')
    const dbl = applyIdea(flow, ideas[1])
    expect(dbl.map((s) => s.id)).toEqual(['stp_01', 'stp_02', 'stp_03', 'stp_04', 'stp_ai01', 'stp_05'])
    expect(flow.steps[1].params).toEqual({ text: '${username}' }) // original untouched
    const removed = applyIdea(flow, { ...ideas[0], changes: [{ type: 'removeStep', stepId: 'stp_03' }, { type: 'wait', afterStepId: 'stp_03', ms: 2000 }] } as TestIdea)
    expect(removed.map((s) => s.action)).toEqual(['launchApp', 'type', 'wait', 'tap', 'assertVisible'])
    expect(describeChange(ideas[0].changes[0], flow)).toBe('Step 2: type "" instead')
  })

  it('generates, saves and turns ideas into flows', async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), 'androauto-ai-')))
    const p = store.createProject({ name: 'Shop', appPackage: 'com.example.shop', appActivity: '' })
    const saved = store.createFlow({ ...flow, projectId: p.id }, new Map())
    let prompt = ''
    const fetchFn: FetchLike = async (_url, init) => {
      prompt = JSON.parse(init.body!).messages[1].content
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: AI_REPLY } }] }) }
    }
    const ai = new AiService(store, fetchFn)
    expect(ai.settings()).toMatchObject({ baseUrl: 'http://localhost:20128/v1', hasApiKey: false })
    ai.saveSettings({ model: 'combo-qa', apiKey: 'sk-2' })
    expect(ai.settings()).toMatchObject({ model: 'combo-qa', hasApiKey: true })
    ai.saveSettings({ temperature: 0.2 })
    expect(store.getAiSettings().apiKey).toBe('sk-2') // kept when not sent

    const ideas = await ai.suggest(p.id, saved.id, { count: 10 })
    expect(prompt).toContain('Write 10 test cases')
    expect(ideas).toMatchObject({ model: 'combo-qa', flowId: saved.id })
    expect(ai.ideas(p.id, saved.id)!.ideas).toHaveLength(4)

    const made = ai.createFlows(p.id, saved.id, ['idea_01', 'idea_03'])
    expect(made.map((f) => f.name)).toEqual(['Login · Empty email']) // the manual one is skipped
    expect(made[0].tags).toEqual(['smoke', 'ai', 'negative'])
    expect(made[0].description).toContain("Expected: Shows 'Email is required'")
    expect(ai.ideas(p.id, saved.id)!.ideas[0].createdFlowId).toBe(made[0].id)
    expect(ai.createFlows(p.id, saved.id, ['idea_01'])[0].name).toBe('Login · Empty email (2)')
  })
})
