import { useEffect, useState } from 'react'
import { Cable, Check, Loader2, Monitor, RefreshCw, Smartphone, Wifi, X } from 'lucide-react'
import type { Device, MirrorFrame } from '@shared/types'
import { Badge, Button, Card, cx, Dialog, Dot, Empty, Field, Input, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAction, useApp } from '../lib/state'

export function DevicesPage() {
  const { devices, serial, setSerial, setup, refreshSetup, recorder } = useApp()
  const run = useAction()
  const [pairOpen, setPairOpen] = useState(false)
  const [mirrorOf, setMirrorOf] = useState<Device | null>(null)
  const [startingAppium, setStartingAppium] = useState(false)

  const checks = setup
    ? [
        { label: 'adb found', ...setup.adb },
        { label: 'Phone connected with USB debugging on', ok: devices.some((d) => d.state === 'device'), detail: unauthorizedHint(devices) },
        { label: 'Appium running', ...setup.appium },
        { label: 'UiAutomator2 driver installed', ...setup.uiautomator2 }
      ]
    : []

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Phones and emulators visible to adb. Plug in over USB or pair over Wi-Fi."
        actions={
          <Button onClick={() => setPairOpen(true)}>
            <Wifi size={15} /> Pair over Wi-Fi
          </Button>
        }
      />

      {devices.length === 0 ? (
        <Empty icon={<Smartphone size={20} />} title="No devices found">
          Connect your phone with a USB cable, turn on Developer options and USB debugging, then accept the prompt on the phone.
        </Empty>
      ) : (
        <Card className="divide-y divide-line">
          {devices.map((d) => {
            const online = d.state === 'device'
            return (
              <div key={d.serial} className="flex items-center gap-4 px-5 py-4">
                <Dot tone={online ? 'ok' : d.state === 'unauthorized' ? 'warn' : 'muted'} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{d.model}</div>
                  <div className="truncate font-mono text-xs text-muted">{d.serial}</div>
                </div>
                <div className="hidden w-28 text-[13px] text-muted md:block">{d.android ? `Android ${d.android}` : '—'}</div>
                <div className="hidden w-24 text-[13px] text-muted md:block">{d.screen ? `${d.screen.w}×${d.screen.h}` : '—'}</div>
                <div className="w-24">
                  <Badge>
                    {d.connection === 'wifi' ? <Wifi size={12} /> : d.connection === 'usb' ? <Cable size={12} /> : <Monitor size={12} />}
                    {d.connection === 'wifi' ? 'Wi-Fi' : d.connection === 'usb' ? 'USB' : 'Emulator'}
                  </Badge>
                </div>
                {online ? (
                  <>
                    <Button size="sm" onClick={() => setMirrorOf(d)} disabled={recorder.state === 'recording'}>
                      Mirror
                    </Button>
                    <Button
                      size="sm"
                      variant={serial === d.serial ? 'primary' : 'secondary'}
                      onClick={() => setSerial(d.serial)}
                      disabled={recorder.state === 'recording'}
                      className="w-24 whitespace-nowrap"
                    >
                      {serial === d.serial ? (
                        <>
                          <Check size={14} /> In use
                        </>
                      ) : (
                        'Use'
                      )}
                    </Button>
                  </>
                ) : (
                  <span className="w-[164px] text-right text-[13px] text-muted">{d.state === 'unauthorized' ? 'Accept the prompt on the phone' : d.state}</span>
                )}
              </div>
            )
          })}
        </Card>
      )}

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Setup checklist</h2>
        <Button size="sm" variant="ghost" onClick={() => void run(refreshSetup)}>
          <RefreshCw size={14} /> Recheck
        </Button>
      </div>
      <Card className="divide-y divide-line">
        {!setup && (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Checking…
          </div>
        )}
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-3 px-5 py-3.5">
            <div className={cx('flex h-5 w-5 items-center justify-center rounded-full', c.ok ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>
              {c.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
            </div>
            <div className="flex-1 text-sm">{c.label}</div>
            <div className="max-w-[50%] truncate text-right text-xs text-muted" title={c.detail}>
              {c.detail}
            </div>
            {c.label === 'Appium running' && !c.ok && (
              <Button
                size="sm"
                disabled={startingAppium}
                onClick={() =>
                  run(async () => {
                    setStartingAppium(true)
                    try {
                      await api.invoke('appium:start')
                      await refreshSetup()
                    } finally {
                      setStartingAppium(false)
                    }
                  })
                }
              >
                {startingAppium && <Loader2 size={14} className="animate-spin" />} Start
              </Button>
            )}
          </div>
        ))}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Appium is optional for recording: without it, androauto reads the screen with adb, which is a little slower. Replay will use Appium.
      </p>

      <PairDialog open={pairOpen} onClose={() => setPairOpen(false)} />
      <MirrorDialog device={mirrorOf} onClose={() => setMirrorOf(null)} />
    </>
  )
}

function unauthorizedHint(devices: Device[]): string {
  if (devices.some((d) => d.state === 'unauthorized')) return 'A phone is waiting: tap Allow on its USB debugging prompt'
  if (!devices.length) return 'Plug in a phone and enable USB debugging'
  return `${devices.filter((d) => d.state === 'device').length} online`
}

function PairDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp()
  const run = useAction()
  const [pairAddr, setPairAddr] = useState('')
  const [code, setCode] = useState('')
  const [connectAddr, setConnectAddr] = useState('')
  const [busy, setBusy] = useState(false)

  const go = (fn: () => Promise<string>): Promise<unknown> =>
    run(async () => {
      setBusy(true)
      try {
        toast(await fn(), 'ok')
      } finally {
        setBusy(false)
      }
    })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pair over Wi-Fi"
      description="Android 11 and later. On the phone open Developer options › Wireless debugging."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="text-[13px] font-semibold">1. Pair (first time only)</div>
          <p className="text-xs text-muted">Tap “Pair device with pairing code” on the phone and enter what it shows.</p>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="IP address and port">
              <Input value={pairAddr} onChange={(e) => setPairAddr(e.target.value)} placeholder="192.168.1.20:37099" className="font-mono text-[13px]" />
            </Field>
            <Field label="Pairing code">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="482913" className="font-mono text-[13px]" />
            </Field>
          </div>
          <Button size="sm" disabled={busy || !pairAddr || !code} onClick={() => void go(() => api.invoke('devices:pair', pairAddr.trim(), code.trim()))}>
            Pair
          </Button>
        </section>
        <section className="space-y-3">
          <div className="text-[13px] font-semibold">2. Connect</div>
          <p className="text-xs text-muted">Use the IP address and port shown at the top of the Wireless debugging screen.</p>
          <Field label="IP address and port">
            <Input value={connectAddr} onChange={(e) => setConnectAddr(e.target.value)} placeholder="192.168.1.20:41235" className="font-mono text-[13px]" />
          </Field>
          <Button size="sm" variant="primary" disabled={busy || !connectAddr} onClick={() => void go(() => api.invoke('devices:connect', connectAddr.trim()))}>
            Connect
          </Button>
        </section>
      </div>
    </Dialog>
  )
}

function MirrorDialog({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const [frame, setFrame] = useState<MirrorFrame | null>(null)
  useEffect(() => {
    if (!device) return
    setFrame(null)
    const off = api.on('mirror:frame', (f) => f.serial === device.serial && setFrame(f))
    void api.invoke('mirror:start', device.serial)
    return () => {
      off()
      void api.invoke('mirror:stop')
    }
  }, [device])
  return (
    <Dialog open={!!device} onClose={onClose} title={device?.model ?? ''} description="Live screen" width="max-w-sm">
      <div className="flex justify-center">
        {frame ? (
          <img src={frame.dataUrl} className="max-h-[60vh] rounded-2xl border border-line" alt="Phone screen" />
        ) : (
          <div className="flex h-80 items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Waiting for the screen…
          </div>
        )}
      </div>
    </Dialog>
  )
}
