import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Device, Step } from '../src/shared/types'
import { buildFlow } from '../src/main/recorder/save'
import { slugify, Store } from '../src/main/store'

const device: Device = { serial: 'R5CT1234', state: 'device', model: 'Pixel 7', android: '14', sdk: 34, screen: { w: 1080, h: 2400, density: 420 }, connection: 'usb' }

const steps: Step[] = [
  { id: 'stp_01', action: 'launchApp', params: { appPackage: 'com.example.shop', appActivity: '.Main' }, waitBeforeMs: 0, timeoutMs: 10000 },
  { id: 'stp_02', action: 'type', params: { text: 'demo@example.com' }, waitBeforeMs: 0, timeoutMs: 10000, snapshot: 'snapshots/stp_02' },
  { id: 'stp_03', action: 'type', params: { text: '', masked: 6 }, secret: true, waitBeforeMs: 0, timeoutMs: 10000 },
  { id: 'stp_04', action: 'tap', waitBeforeMs: 0, timeoutMs: 10000, snapshot: 'snapshots/stp_04' }
]

describe('Store and saving flows', () => {
  let store: Store
  beforeEach(() => {
    store = new Store(mkdtempSync(join(tmpdir(), 'androauto-')))
  })

  it('creates, lists and updates projects', () => {
    const p = store.createProject({ name: ' Shop App ', appPackage: 'com.example.shop', appActivity: '.MainActivity' })
    expect(p).toMatchObject({ name: 'Shop App', launchOptions: { clearDataBeforeRun: false, grantPermissions: true } })
    expect(store.listProjects()).toMatchObject([{ id: p.id, flowCount: 0 }])
    expect(store.updateProject(p.id, { launchOptions: { clearDataBeforeRun: true } }).launchOptions).toEqual({ clearDataBeforeRun: true, grantPermissions: true })
    expect(() => store.createProject({ name: '', appPackage: 'x', appActivity: '' })).toThrow(/name/)
    expect(() => store.getProject('../etc')).toThrow(/Bad project id/)
  })

  it('saves a flow with variables, secrets and snapshots', () => {
    const p = store.createProject({ name: 'Shop App', appPackage: 'com.example.shop', appActivity: '.MainActivity' })
    const { flow, secrets } = buildFlow(p, device, steps, {
      name: 'Login with valid user',
      description: '',
      tags: ['Smoke', 'auth', 'smoke', ''],
      variables: { stp_02: 'username' },
      secretValues: { stp_03: 'hunter2' }
    })
    expect(flow.variables).toEqual({ username: 'demo@example.com', password: '${secret:shop_app_password}' })
    expect(secrets).toEqual({ shop_app_password: 'hunter2' })
    expect(flow.steps[1].params).toEqual({ text: '${username}' })
    expect(flow.steps[2].params).toEqual({ text: '${password}' })
    expect(flow.tags).toEqual(['smoke', 'auth'])
    expect(flow.startState.launchApp).toBe(true)
    expect(steps[1].params!.text).toBe('demo@example.com') // input not mutated

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const saved = store.createFlow(flow, new Map([['stp_02', { xml: '<hierarchy/>', png }], ['stp_04', { xml: '<hierarchy/>' }]]))
    for (const [k, v] of Object.entries(secrets)) store.setSecret(k, v)

    const dir = join(store.root, 'projects', p.id, 'flows')
    const file = JSON.parse(readFileSync(join(dir, 'login-with-valid-user.json'), 'utf8'))
    expect(file).toMatchObject({ id: saved.id, version: 1, name: 'Login with valid user' })
    expect(file.steps[1].snapshot).toBe('login-with-valid-user/snapshots/stp_02')
    expect(existsSync(join(dir, 'login-with-valid-user/snapshots/stp_02.png'))).toBe(true)
    expect(existsSync(join(dir, 'login-with-valid-user/snapshots/stp_04.xml'))).toBe(true)
    expect(JSON.stringify(file)).not.toContain('hunter2')
    expect(store.getSecret('shop_app_password')).toBe('hunter2')

    expect(store.listFlows(p.id)).toMatchObject([{ id: saved.id, stepCount: 4 }])
    expect(store.getFlow(p.id, saved.id).name).toBe('Login with valid user')
    expect(() => store.createFlow({ ...flow, name: 'login with VALID user' }, new Map())).toThrow(/already exists/)
    store.deleteFlow(p.id, saved.id)
    expect(store.listFlows(p.id)).toEqual([])
  })

  it('validates names and secret values', () => {
    const p = store.createProject({ name: 'A', appPackage: 'a', appActivity: '' })
    const req = { name: 'x', description: '', tags: [], variables: {}, secretValues: {} }
    expect(() => buildFlow(p, device, steps, { ...req, name: ' ' })).toThrow(/name is required/)
    expect(() => buildFlow(p, device, steps, req)).toThrow(/password field/)
    expect(() => buildFlow(p, device, steps, { ...req, variables: { stp_02: 'bad name' }, secretValues: { stp_03: 'x' } })).toThrow(/not a valid variable/)
    expect(() => buildFlow(p, device, [], req)).toThrow(/Nothing was recorded/)
  })

  it('slugifies names', () => {
    expect(slugify('Add first item to cart!')).toBe('add-first-item-to-cart')
    expect(slugify('???')).toBe('flow')
  })
})
