import { describe, expect, it } from 'vitest'
import { buildLocators, xpathLiteral } from '../src/main/hierarchy/locators'
import { elementAt, focusedEditText, parseHierarchy, scrollableAt, toElementInfo } from '../src/main/hierarchy/tree'
import { fixture } from './helpers'

describe('hierarchy', () => {
  const tree = parseHierarchy(fixture('login-dump.xml'))

  it('parses uiautomator dump', () => {
    expect(tree.rotation).toBe(0)
    expect(tree.all.length).toBe(12)
    expect(tree.root.bounds).toEqual([0, 0, 1080, 2400])
  })

  it('resolves a tap on a label to its clickable button', () => {
    const hit = elementAt(tree, 540, 1890)!
    expect(hit.leaf.text).toBe('Log in')
    expect(hit.target.resourceId).toBe('com.example.shop:id/login_btn')
    expect(toElementInfo(hit.target)).toMatchObject({ class: 'android.widget.Button', text: 'Log in', contentDesc: 'Log in' })
  })

  it('builds locators best first', () => {
    const hit = elementAt(tree, 540, 1890)!
    expect(buildLocators(tree, hit.target, hit.leaf)).toEqual([
      { strategy: 'id', value: 'com.example.shop:id/login_btn' },
      { strategy: 'accessibility id', value: 'Log in' },
      { strategy: 'uiautomator', value: 'new UiSelector().text("Log in")' },
      { strategy: 'xpath', value: "//android.widget.Button[@resource-id='com.example.shop:id/login_btn']" }
    ])
  })

  it('uses instance selectors for repeated list rows', () => {
    const hit = elementAt(tree, 300, 1300)!
    const locs = buildLocators(tree, hit.target, hit.leaf)
    expect(locs.find((l) => l.strategy === 'id')).toBeUndefined()
    expect(locs).toContainEqual({ strategy: 'uiautomator', value: 'new UiSelector().text("Shirts")' })
    expect(locs).toContainEqual({ strategy: 'uiautomator', value: 'new UiSelector().resourceId("com.example.shop:id/row").instance(1)' })
    expect(locs[locs.length - 1]).toEqual({ strategy: 'xpath', value: "//android.widget.LinearLayout[@resource-id='com.example.shop:id/row'][.//*[@text='Shirts']]" })
  })

  it('finds scroll containers', () => {
    expect(scrollableAt(tree, 500, 1100)?.resourceId).toBe('com.example.shop:id/list')
    expect(scrollableAt(tree, 500, 400)).toBeNull()
  })

  it('parses Appium page source and quoted text', () => {
    const t = parseHierarchy(fixture('appium-source.xml'))
    expect(t.root.bounds).toEqual([0, 0, 1080, 2400])
    expect(elementAt(t, 500, 1900)!.target.text).toBe('Sign in')
    const field = focusedEditText(t)!
    expect(field.text).toBe(`it's "quoted"`)
    const xp = buildLocators(t, field).find((l) => l.strategy === 'xpath')!
    expect(xp.value).toBe("//android.widget.EditText[@resource-id='com.example.shop:id/note']")
    expect(xpathLiteral(`it's "q"`)).toBe(`concat('it', "'", 's "q"')`)
  })
})
