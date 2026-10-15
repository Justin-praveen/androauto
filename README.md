# androauto

Record a flow on your Android phone once, save it by name, and replay it as an automated test with a pass or fail result. No automation code to write.

This build has projects, device connection, the recorder, and replay with run reports. AI comes next.

## What you need

- **Node.js 20 or newer** (`node -v`)
- **adb** (Android platform-tools). Either on your PATH, or set `ANDROID_HOME` to your Android SDK. Check with `adb version`.
- **An Android phone** with Developer options and **USB debugging** turned on, connected over USB (accept the "Allow USB debugging" prompt), or paired over Wi-Fi from the Devices screen. An emulator works too.

## Run it

```bash
cd androauto
npm install          # also installs Appium locally
npm run appium:driver   # one time: installs the UiAutomator2 driver (optional, see below)
npm run dev          # opens the app
```

Then:

1. **Projects › New project.** With the phone connected, pick your app from the list (fills in package and activity), or type the package name.
2. **Devices.** Check the phone shows a green dot and the setup checklist is green.
3. **Recorder.** Choose a mode, tick *Launch app first*, hit **Record**, do your flow, hit **Stop & save**, name it. It appears under **Flows**.
4. **Flows.** Press ▶ on a row to play one flow, tick several and press **Run selected**, or press **Run all**. Flows run one after another on the selected phone.
5. **Runs.** Watch progress live, then see the result: how many passed and failed, and for each flow the step it failed at. Click a run for its report: every step with pass/fail, the screenshot after it, and the error.

### How replay works

Each step looks for its element with the recorded locators in order (id, accessibility label, text, XPath) and waits up to the step's timeout (10s) for it to appear. If none match, a tap falls back to the recorded screen position and is marked with a warning; a *Check* step fails. A flow stops at its first failed step and the remaining steps are skipped; the next flow still runs. Each flow starts by force-stopping and relaunching the app (or clearing its data if the project says so). Run reports are saved under `runs/` in the project folder.

### Two ways to record

- **On phone** (default): use the real phone in your hand. androauto reads touches with `adb shell getevent` and works out which element you touched from a screen snapshot taken just before. Typing shows up as one *Type* step per field with the final text. Password fields can't be read from the screen, so the save dialog asks you for the value and stores it outside the flow file.
- **In mirror**: click and drag on the live screen inside androauto. It looks up the element first, then performs the action on the phone. Use the Back, Home and Enter buttons and the text box under the mirror. This mode also lets you add **Check visible** and **Check text** steps by clicking an element.

### Appium is optional for recording

When Appium and the UiAutomator2 driver are installed, androauto starts Appium in the background and reads the screen through it (faster). Without them it falls back to `uiautomator dump` over adb, which is slower but needs nothing extra. The top of the Recorder says which one is in use. Replay uses the same choice.

## AI test cases

Record a flow once and let the AI suggest the other ways it should be tested: empty and invalid inputs, length limits, special characters, repeated taps, back/home interruptions, security strings, and so on.

1. **Settings › AI provider**: enter the base URL of any OpenAI-compatible API (OmniRoute's default is `http://localhost:20128/v1`; use your own if it runs elsewhere), your API key, and a model (**Load models** lists what the server offers). **Test connection** checks it.
2. On **Flows**, click ✨ on a flow, then **Generate**. You can pick how many test cases and add a focus such as "password rules".
3. Each test case shows its category, priority, the changes to the flow and the expected result. Cases replay can't do (rotation, network off) are marked *manual* with steps for a tester.
4. Tick the ones you want and click **Create flows** (or **Create and run**). Each becomes a new flow tagged `ai`, so it runs like any other. **Export CSV** saves the list for a test-case sheet.

The AI sees the step list and the screen text recorded with each step. Password values are never sent. The API key is stored in `~/androauto/settings.json` (readable only by you). Suggestions are saved in `projects/<id>/ai/<flow-id>.json`.

## Where things are saved

```
~/androauto/                       (change with ANDROAUTO_HOME)
  projects/<project-id>/project.json
  projects/<project-id>/flows/<flow-name>.json        the flow
  projects/<project-id>/flows/<flow-name>/snapshots/  screenshot + UI XML per step
  projects/<project-id>/runs/<run-id>/                report.json + a screenshot per step (+ UI XML on failure)
  secrets.json                                        password values (not in flows)
```

Flows are plain JSON in the format from `docs/spec.md`, so you can read them, diff them and commit them to git.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests (fake phone, no device needed) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `out/` |
| `npm run ui:preview` | The UI alone in a browser with demo data, no phone or Electron |

Environment variables: `ANDROAUTO_ADB` (path to adb), `ANDROAUTO_APPIUM` (path to appium), `ANDROAUTO_HOME` (data folder), `ANDROAUTO_NO_APPIUM=1` (don't start Appium).

## Troubleshooting

- **No devices found**: run `adb devices` in a terminal. If it says `unauthorized`, unlock the phone and accept the prompt.
- **"No touchscreen found"** when recording on phone: some vendors hide the input device. Use *In mirror* mode.
- **Steps with a ⚠ icon**: the element couldn't be identified (usually a very fast tap right after a screen change), so the step uses screen-percentage coordinates. Re-record that part slowly or use *In mirror* mode.
- **Keyboard taps recorded as steps**: the keyboard's position couldn't be read on your phone. Delete those steps (hover, trash icon).

## Known limits in this build

- Portrait orientation only for *On phone* recording.
- Multi-finger gestures (pinch) are skipped.
- The mirror refreshes a few times a second (screenshots over adb). A smoother scrcpy stream is planned.
- The keyboard's Enter key is not recorded in *On phone* mode; record that part *In mirror* and use the Enter button.

## Code map

```
src/shared/          types (spec section 3) and the IPC contract
src/main/adb/        adb wrapper and output parsers
src/main/hierarchy/  UI XML parsing, element-at-point, locator generation
src/main/recorder/   getevent parsing, gesture classification, recorder engine, save
src/main/player/     flow player (find element, act, screenshot) and the batch runner
src/main/ai/         OpenAI-compatible client, test-case prompt, parsing, idea-to-flow
src/main/            device manager, Appium manager, mirror, store, IPC, window
src/renderer/        React UI (Projects, Flows, Recorder, Runs, Devices)
tests/               vitest suites and fixtures
```

Differences from `docs/spec.md` in this first build, each easy to change later: flows are listed by scanning the JSON files rather than a SQLite index (no native module to compile on install); the mirror uses `screencap` rather than scrcpy; IPC is a typed `invoke` bridge rather than tRPC; replay performs actions with adb input commands and finds elements in UI snapshots (from Appium or adb) rather than through a WebdriverIO session, so it works without Appium too.
