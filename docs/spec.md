# androauto: Architecture and UI Spec (v1)

androauto is a desktop tool for testing Android apps without writing automation code. You create a project, connect a phone over ADB, launch the app, hit **Record**, perform a flow, hit **Stop**, name it, and replay it whenever you want. AI comes later to make replay resilient and flows easier to write.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Electron** | Needs local access to `adb`, the Appium server and the file system. A browser app can't spawn processes. Ships as one installer for Windows, macOS and Linux. |
| UI | **React + TypeScript + Vite**, **Tailwind CSS + shadcn/ui** | Clean, modern components out of the box, light and dark themes, fast to build. |
| Backend | **Node.js (TypeScript)** running in the Electron main process | Appium itself is Node, and the best Appium client (**WebdriverIO**) is Node. One language end to end; no Python runtime to bundle. |
| Device control | **Appium 2 + UiAutomator2 driver** for locating elements and replay; **raw `adb`** for gesture capture, screenshots, screen mirroring, install and launch | Decided in the project chat. Appium gives stable element locators; ADB gives low-level event capture Appium can't. |
| Screen mirror | **scrcpy** server (bundled), streamed into the app | Low-latency live view of the phone inside the recorder. |
| Storage | **SQLite** (`better-sqlite3`) for the index, **JSON files** for flows, a folder per run for screenshots | Flows stay human-readable, diffable and easy to share or commit to git. |
| AI (phase 4) | **Claude API** (`@anthropic-ai/sdk`) called from the backend | Self-healing locators, plain-English flows, failure explanations. |

Python was considered for the backend. It was rejected because every key dependency (Appium, WebdriverIO, scrcpy client libs, Electron) is in the Node ecosystem, and AI calls are plain HTTPS either way.

---

## 2. Components

```
┌──────────────────────────── Electron app ────────────────────────────┐
│  Renderer (React UI)                                                  │
│   Projects · Devices · Recorder · Flow Library · Run Reports         │
│                    ▲  typed IPC (tRPC over Electron IPC)              │
│  Main process (Node backend)                                          │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│   │ DeviceManager│ │ Recorder     │ │ Player       │ │ AI Service  │ │
│   │ adb devices, │ │ getevent     │ │ WebdriverIO  │ │ (phase 4)   │ │
│   │ install,     │ │ + hierarchy  │ │ step runner, │ │ heal, NL→   │ │
│   │ launch,mirror│ │ snapshots →  │ │ waits,       │ │ flow,       │ │
│   │              │ │ Steps        │ │ screenshots  │ │ explain     │ │
│   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └─────────────┘ │
│          │  ┌─────────────┴────────────────┴──┐  ┌──────────────────┐ │
│          │  │ AppiumManager (spawns local     │  │ Store (SQLite +  │ │
│          │  │ Appium server, one session per  │  │ JSON flows +     │ │
│          │  │ device)                         │  │ run artifacts)   │ │
│          │  └─────────────┬───────────────────┘  └──────────────────┘ │
└──────────┼────────────────┼───────────────────────────────────────────┘
           ▼ adb (USB / Wi-Fi)▼
        ┌──────────── Android phone ────────────┐
        │  App under test · UiAutomator2 server │
        └───────────────────────────────────────┘
```

- **DeviceManager**: polls `adb devices -l`, reads model, Android version, screen size and density, supports pairing over Wi-Fi (`adb pair` / `adb connect`), installs APKs, launches the app (`am start -n pkg/activity`), clears app data, starts the scrcpy mirror.
- **AppiumManager**: starts a bundled Appium server on a free port at app launch, checks that the UiAutomator2 driver is installed, opens and closes sessions per device.
- **Recorder**: turns what you do on the phone into a list of steps (section 4).
- **Player**: runs a flow step by step and writes a run report (section 5).
- **Store**: owns the files on disk and the SQLite index.
- **AI Service**: an interface defined now, implemented in phase 4, so the recorder and player already pass it the context it needs.

---

## 3. Data model

### On disk
```
~/androauto/
  androauto.db                      # SQLite index: projects, flows, runs
  projects/<project-id>/
    project.json
    flows/<flow-slug>.json          # the flow itself (source of truth)
    flows/<flow-slug>/snapshots/    # per-step screenshot + UI hierarchy XML from recording
    runs/<run-id>/                  # report.json + screenshots per step
```

### Project
```jsonc
{
  "id": "prj_8f2c",
  "name": "Shop App",
  "appPackage": "com.example.shop",
  "appActivity": ".MainActivity",     // auto-detected from the APK or the running app
  "apkPath": "/path/to/shop.apk",     // optional: install before each run
  "launchOptions": { "clearDataBeforeRun": false, "grantPermissions": true },
  "createdAt": "2026-10-14T19:20:00Z"
}
```

### Device (cached in SQLite, refreshed live)
```jsonc
{ "serial": "R5CT1234", "model": "Pixel 7", "android": "14", "sdk": 34,
  "screen": { "w": 1080, "h": 2400, "density": 420 }, "connection": "usb" }
```

### Flow
```jsonc
{
  "id": "flw_31ab",
  "projectId": "prj_8f2c",
  "name": "Login with valid user",
  "description": "",
  "tags": ["smoke", "auth"],
  "version": 3,                        // bumped on every edit
  "recordedOn": { "serial": "R5CT1234", "model": "Pixel 7", "screen": { "w": 1080, "h": 2400 } },
  "startState": { "launchApp": true, "clearData": false },
  "variables": { "username": "demo@example.com", "password": "${secret:shop_pw}" },
  "steps": [ /* Step[] */ ]
}
```

### Step
```jsonc
{
  "id": "stp_01",
  "action": "tap",            // tap | longPress | swipe | scroll | type | pressKey | launchApp | wait | assertVisible | assertText
  "target": {
    "locators": [             // tried in order at replay; best first
      { "strategy": "id",              "value": "com.example.shop:id/login_btn" },
      { "strategy": "accessibility id","value": "Log in" },
      { "strategy": "uiautomator",     "value": "new UiSelector().text(\"Log in\")" },
      { "strategy": "xpath",           "value": "//android.widget.Button[@text='Log in']" }
    ],
    "element": { "class": "android.widget.Button", "text": "Log in", "resourceId": "com.example.shop:id/login_btn",
                 "contentDesc": "Log in", "bounds": [96, 1820, 984, 1964] },
    "fallbackPoint": { "xPct": 0.5, "yPct": 0.789 }   // percent of screen, so it works on other resolutions
  },
  "params": { "text": "${username}" },              // for type; swipe uses { from, to, durationMs }
  "waitBeforeMs": 0,
  "timeoutMs": 10000,
  "snapshot": "snapshots/stp_01"                    // screenshot + hierarchy at record time; the AI uses this later
}
```

### Run
```jsonc
{
  "id": "run_9c0d", "flowId": "flw_31ab", "flowVersion": 3, "device": "R5CT1234",
  "status": "failed",            // queued | running | passed | failed | aborted
  "startedAt": "...", "durationMs": 18450,
  "steps": [
    { "stepId": "stp_01", "status": "passed", "locatorUsed": "id", "durationMs": 610, "screenshot": "stp_01.png" },
    { "stepId": "stp_02", "status": "failed", "error": "Element not found after 10s",
      "screenshot": "stp_02.png", "hierarchy": "stp_02.xml" }
  ]
}
```

---

## 4. Recording approach

The hard part of a recorder is knowing **which element** you touched, not just where. androauto records in two modes; both produce the same steps.

### Mode A: Record on the phone (default, matches how you described it)
You use the real phone in your hand; the app shows a live mirror and the steps appearing as you go.

1. **Capture gestures** with `adb shell getevent -lt` on the touchscreen input device (found from `getevent -p`). Raw `ABS_MT_POSITION_X/Y` values are scaled to screen pixels using the device's reported axis ranges.
2. **Classify** each touch sequence: down and up within ~10 px and under 500 ms is a **tap**; held over 500 ms is a **long press**; moved further is a **swipe** or **scroll** (direction and distance kept). Hardware keys (`KEY_BACK`, `KEY_HOME`) become **pressKey** steps.
3. **Resolve the element**: the recorder keeps a rolling UI hierarchy snapshot (Appium `getPageSource`, refreshed whenever the screen settles). On touch-down it uses the **latest snapshot taken before the touch**, finds the deepest clickable node whose bounds contain the point, and generates the locator list (resource-id, then content-desc, then text, then a short XPath), plus the percent-based fallback point. Using the pre-touch snapshot avoids recording elements from the screen that appears after the tap.
4. **Capture typing**: the soft keyboard's taps are ignored (keyboard bounds come from `dumpsys input_method`). When the next snapshot shows a changed value in the focused `EditText`, the recorder emits one **type** step with the final text. Password fields get flagged so you can turn the value into a secret variable on save.
5. **Save**: on Stop, a dialog asks for the flow name, tags and description, and offers to turn typed values into variables.

Known limits: `getevent` needs no root but its device naming varies by vendor (handled by probing `getevent -p` for `ABS_MT_POSITION_X`). Very fast sequences can outrun hierarchy refreshes; those steps fall back to coordinates and are marked with a warning icon so you can fix them.

**Upgrade path (after v1):** a small helper APK with an `AccessibilityService` reports click and text-change events together with the exact node, which removes the timing problem entirely. The step format doesn't change.

### Mode B: Record in the mirror
You click on the phone mirror inside androauto. Because androauto performs the action itself through Appium, it knows the exact element before the action happens. This is the most reliable mode and also gives the **inspector**: hover any element to see its attributes and add an **assert** step with a right-click.

### Editing after recording
Every step can be reordered, deleted, re-recorded from that point, given a different locator, a longer timeout, or a wait. Asserts can be inserted anywhere.

---

## 5. Replay approach

1. Open an Appium session on the chosen device with the project's package and activity (`appium:noReset` according to `clearDataBeforeRun`).
2. For each step: wait `waitBeforeMs`, then try each locator in order with an implicit wait until `timeoutMs`. The first match wins and its strategy is recorded in the run. If all locators fail, use the fallback point only for steps without an assert, and mark the step **passed with warning**.
3. Perform the action (W3C actions for tap, long press and swipe; `setValue` for type; `pressKeyCode` for keys).
4. Take a screenshot after every step; on failure also save the UI hierarchy (this is what the AI uses to explain and heal).
5. Stop at the first failure by default (setting: continue on failure). Write `report.json` and update the run list live in the UI.

Batch runs (several flows or several devices) queue runs and execute one session per device in parallel.

---

## 6. AI hooks (phase 4, designed in now)

| Feature | Input it needs (already captured above) | Output |
|---|---|---|
| **Self-healing locators** | Failed step's recorded element + snapshot, current hierarchy XML + screenshot | Best matching element and a new locator; the run continues and the flow gets a "healed" suggestion you accept or reject |
| **Plain-English flows** | Project's app, current screen hierarchy, a sentence like "log in and add the first item to cart" | Draft steps, executed one at a time with live confirmation |
| **Failure explanations** | Run report, failing step's screenshots before and after, logcat excerpt | A short reason ("Login button is hidden behind a permission dialog") and a suggested fix |
| **Step naming** | Each recorded step's element | Readable labels like "Tap **Log in**" instead of raw IDs |

---

## 7. Screens

Layout: a left sidebar (project switcher, then Flows, Recorder, Runs, Devices, Settings), a top bar showing the connected device and Appium status, and the main area. Neutral palette with one accent color, generous spacing, light and dark themes.

### 7.1 Projects (home)
```
┌───────────────────────────────────────────────────────────────────────┐
│ androauto                                         ● Pixel 7  ● Appium │
├───────────────────────────────────────────────────────────────────────┤
│  Projects                                          [ + New project ]  │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │
│  │ 🛍 Shop App       │  │ 🏦 Bank App       │  │  + Create        │     │
│  │ com.example.shop │  │ com.example.bank │  │    a project     │     │
│  │ 12 flows · 92% ✓ │  │ 4 flows · 100% ✓ │  │                  │     │
│  │ Last run 2h ago  │  │ Last run 1d ago  │  │                  │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘

New project dialog:  Name · Pick APK or pick an installed app from the
connected phone (auto-fills package + activity) · Launch options
```

### 7.2 Devices
```
┌ Devices ──────────────────────────────────────────── [ + Pair over Wi-Fi ] ┐
│  ● Pixel 7        Android 14   1080×2400   USB     [ Mirror ] [ Use ✓ ]    │
│  ● Galaxy S23     Android 14   1080×2340   Wi-Fi   [ Mirror ] [ Use   ]    │
│  ○ emulator-5554  offline                                                  │
│                                                                            │
│  Setup checklist:  ✓ adb found  ✓ USB debugging on  ✓ Appium running      │
│                    ✓ UiAutomator2 driver installed                         │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Recorder
```
┌ Recorder · Shop App ────────────────────────────────────────────────────┐
│  Device: Pixel 7 ▾   Mode: (●) On phone  ( ) In mirror                  │
│  [ ▶ Launch app ]   [ ● Record ]   [ ■ Stop & save ]     00:42 · 6 steps │
├──────────────────────────┬──────────────────────────────────────────────┤
│  ┌────────────────────┐  │  Steps                                       │
│  │                    │  │  1  🚀 Launch Shop App                       │
│  │   live phone       │  │  2  👆 Tap  "Log in"                         │
│  │   mirror           │  │  3  ⌨ Type  "demo@example.com"  in Email     │
│  │  (highlights the   │  │  4  ⌨ Type  ••••••  in Password  🔒           │
│  │   element touched) │  │  5  👆 Tap  "Sign in"                        │
│  │                    │  │  6  ↕ Scroll down  on product list  ⚠        │
│  │                    │  │                                              │
│  └────────────────────┘  │  [ + Add assert ]  [ + Add wait ]            │
└──────────────────────────┴──────────────────────────────────────────────┘

Stop & save dialog:  Flow name* · Tags · Description ·
"Turn typed values into variables" (checked for passwords)
```

### 7.4 Flow library
```
┌ Flows · Shop App ─────────────────────────────── [ Search… ] [ ● Record new ] ┐
│  Tags: [all] [smoke] [auth] [checkout]                [ ▶ Run selected (2) ]  │
│  ☐ Name                         Steps  Last run         Status                │
│  ☑ Login with valid user          5    2h ago · 18s     ✓ Passed             │
│  ☑ Add first item to cart         9    2h ago · 31s     ✗ Failed at step 7   │
│  ☐ Checkout with saved card      14    yesterday        ✓ Passed             │
│  ☐ Search "shoes"                 6    never            —                    │
└───────────────────────────────────────────────────────────────────────────────┘
Row actions: Run · Edit · Duplicate · Export JSON · Delete
```

### 7.5 Flow editor
```
┌ Login with valid user · v3 ──────────────────────── [ ▶ Run ] [ Save ] ┐
│  Steps (drag to reorder)                │  Step 2 · Tap                 │
│  1  Launch Shop App                     │  ┌───────────────┐            │
│  2▸ Tap "Log in"                ◀ sel.  │  │ screenshot    │            │
│  3  Type ${username} in Email           │  │ from record   │            │
│  4  Type ${password} in Password        │  └───────────────┘            │
│  5  Tap "Sign in"                       │  Locators (in order)          │
│  6  Assert visible "Welcome"            │   1 id  …:id/login_btn        │
│                                         │   2 a11y  "Log in"            │
│  [ ● Re-record from step 2 ]            │   3 xpath //Button[@text=…]   │
│                                         │  Timeout 10s · Wait before 0s │
└─────────────────────────────────────────┴───────────────────────────────┘
```

### 7.6 Run report
```
┌ Run · Add first item to cart · Pixel 7 · ✗ Failed · 31s ───── [ Re-run ] ┐
│  ✓ 1 Launch   ✓ 2 Tap   ✓ 3 Tap   ✓ 4 Scroll   ✓ 5 Tap   ✓ 6 Tap   ✗ 7   │
│  ┌──────────────┐  Step 7 · Tap "Add to cart"                             │
│  │ screenshot   │  Element not found after 10s (tried id, a11y, xpath)    │
│  │ at failure   │  ✨ AI (phase 4): "Button now reads 'Add to bag'.        │
│  └──────────────┘     Update locator?"   [ Accept fix ]  [ Ignore ]       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Build plan (matches the remaining threads)

1. **Thread 2: device connection and recording**. Electron + React shell with the sidebar layout, DeviceManager, AppiumManager, Projects and Devices screens, Recorder (both modes), save flows to JSON.
2. **Thread 3: replay and reports**. Player, Flow library, Flow editor, Run report, batch runs.
3. **Thread 4: AI**. AI Service behind the hooks in section 6, starting with self-healing locators and step naming.

## 9. Open questions (defaults chosen, change any)

- **iOS support**: out of scope; the data model doesn't block adding it later.
- **Emulators**: work the same as phones through adb; no special handling in v1.
- **CI / command line**: a `androauto run <flow>` CLI reusing the Player is easy to add after thread 3.
- **Secrets**: stored in the OS keychain (`keytar`), referenced as `${secret:name}` in flows.
