import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import io from "socket.io-client"
import {
  Bell, BellOff, CalendarCheck, Car, LifeBuoy, Settings, ShoppingBag, Siren, UserPlus, Volume2, Wallet, X, XCircle,
} from "lucide-react"
import { API_BASE_URL } from "@food/api/config"
import { getUnifiedAdminToken } from "../../modules/Taxi/modules/admin/services/adminSession"
import { KIND_PRIORITY, REPEAT_SECONDS, isSupported, isUnlocked, playTone, unlock } from "./alertSound"

/**
 * Admin alert centre: rings, shows a card and (in a background tab) raises a
 * desktop notification for every admin_alert the server sends -- new orders,
 * rides, bookings, SOS, partner and payout requests across every module.
 *
 * Mounted once for the whole admin (food, master, taxi), so it keeps listening
 * on every page. The server side is Backend/src/core/notifications/adminAlerts.js.
 */

const SETTINGS_KEY = "admin_alert_settings_v1"
const CHANNEL = "qd-admin-alerts"
const MAX_CARDS = 20

const KINDS = {
  order: { label: "Orders", icon: ShoppingBag, stripe: "bg-emerald-500" },
  ride: { label: "Rides & parcels", icon: Car, stripe: "bg-sky-500" },
  booking: { label: "Service bookings", icon: CalendarCheck, stripe: "bg-indigo-500" },
  cancelled: { label: "Cancellations", icon: XCircle, stripe: "bg-amber-500" },
  sos: { label: "SOS / emergencies", icon: Siren, stripe: "bg-red-600" },
  partner: { label: "Partner sign-ups", icon: UserPlus, stripe: "bg-violet-500" },
  payout: { label: "Withdrawals & refunds", icon: Wallet, stripe: "bg-teal-500" },
  support: { label: "Support tickets", icon: LifeBuoy, stripe: "bg-slate-500" },
}

const DEFAULT_SETTINGS = {
  muted: false,
  volume: 0.8,
  // 0 = ring until someone clicks the alert.
  ringSeconds: 15,
  kinds: Object.fromEntries(Object.keys(KINDS).map((k) => [k, true])),
}

const readSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null")
    if (!saved) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...saved, kinds: { ...DEFAULT_SETTINGS.kinds, ...(saved.kinds || {}) } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

const socketOrigin = () => {
  try {
    return new URL(API_BASE_URL).origin
  } catch {
    return typeof window !== "undefined" ? window.location.origin : ""
  }
}

const timeAgo = (iso, now) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return `${h} h ago`
}

/**
 * Only one tab rings per alert. A Web Lock named after the alert is held for
 * the ring's length by whichever tab asks first; the others skip the sound but
 * still show the card. Browsers without Web Locks just ring in every tab.
 */
const claimRing = (id, holdMs) =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      resolve(true)
      return
    }
    navigator.locks
      .request(`qd-admin-alert:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false)
          return undefined
        }
        resolve(true)
        return new Promise((r) => setTimeout(r, holdMs))
      })
      .catch(() => resolve(true))
  })

export default function AdminAlertCenter() {
  const navigate = useNavigate()
  // useNavigate changes identity on every route change; read it through a ref
  // so the socket handler -- and with it the connection -- stays put.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const [alerts, setAlerts] = useState([])
  const [settings, setSettings] = useState(readSettings)
  const [unlocked, setUnlocked] = useState(isUnlocked)
  const [panelOpen, setPanelOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  )

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // id -> { kind, until (ms, 0 = until acknowledged), nextAt }
  const ringingRef = useRef(new Map())
  const channelRef = useRef(null)

  const saveSettings = (patch) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        // Private mode: settings last for this tab only.
      }
      return next
    })

  // Stop ringing / remove, here and in the other admin tabs.
  const acknowledge = useCallback((id, { remove = false, broadcast = true } = {}) => {
    ringingRef.current.delete(id)
    setAlerts((prev) => (remove ? prev.filter((a) => a.id !== id) : prev.map((a) => (a.id === id ? { ...a, acked: true } : a))))
    if (broadcast) channelRef.current?.postMessage({ type: remove ? "remove" : "ack", id })
  }, [])

  const clearAll = useCallback(() => {
    ringingRef.current.clear()
    setAlerts([])
    channelRef.current?.postMessage({ type: "clear" })
  }, [])

  const openAlert = useCallback(
    (alert) => {
      acknowledge(alert.id, { remove: true })
      if (alert.link) navigateRef.current(alert.link)
    },
    [acknowledge]
  )

  const receive = useCallback(
    async (alert) => {
      if (!alert?.id) return
      const s = settingsRef.current
      setAlerts((prev) => {
        if (prev.some((a) => a.id === alert.id)) return prev
        return [{ ...alert, acked: false }, ...prev].slice(0, MAX_CARDS)
      })
      if (s.muted || s.kinds[alert.kind] === false) return

      const untilAcked = alert.urgent || !s.ringSeconds
      const holdMs = untilAcked ? 10 * 60 * 1000 : s.ringSeconds * 1000
      if (!(await claimRing(alert.id, holdMs))) return

      ringingRef.current.set(alert.id, {
        kind: alert.kind,
        until: untilAcked ? 0 : Date.now() + holdMs,
        nextAt: 0,
      })

      // A background tab: the ring may be missed, the desktop notification is not.
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const n = new Notification(alert.title, {
            body: alert.body || "",
            tag: alert.id,
            requireInteraction: Boolean(alert.urgent),
          })
          n.onclick = () => {
            window.focus()
            openAlert(alert)
            n.close()
          }
        } catch {
          // Some platforms only allow notifications from a service worker.
        }
      }
    },
    [openAlert]
  )

  // Live connection. The token is read on every (re)connect so a refreshed
  // login is picked up without reloading the page.
  useEffect(() => {
    if (!getUnifiedAdminToken()) return undefined
    const socket = io(socketOrigin(), {
      transports: ["websocket", "polling"],
      auth: (cb) => cb({ token: getUnifiedAdminToken() || "" }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
    socket.on("admin_alert", receive)
    return () => {
      socket.off("admin_alert", receive)
      socket.disconnect()
    }
  }, [receive])

  // Keep acknowledgements in step across admin tabs.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined
    const ch = new BroadcastChannel(CHANNEL)
    channelRef.current = ch
    ch.onmessage = ({ data }) => {
      if (data?.type === "clear") {
        ringingRef.current.clear()
        setAlerts([])
      } else if (data?.id) {
        acknowledge(data.id, { remove: data.type === "remove", broadcast: false })
      }
    }
    return () => {
      ch.close()
      channelRef.current = null
    }
  }, [acknowledge])

  // Chrome holds sound back until the first click or key press on the page.
  useEffect(() => {
    if (unlocked) return undefined
    const onGesture = async () => {
      if (await unlock()) setUnlocked(true)
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        try {
          setNotifPermission(await Notification.requestPermission())
        } catch {
          // Ignored: the bell panel offers it again.
        }
      }
    }
    window.addEventListener("pointerdown", onGesture)
    window.addEventListener("keydown", onGesture)
    return () => {
      window.removeEventListener("pointerdown", onGesture)
      window.removeEventListener("keydown", onGesture)
    }
  }, [unlocked])

  // The ring loop: the most urgent ringing alert plays, on repeat, until it
  // times out or is acknowledged.
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now()
      const ringing = ringingRef.current
      for (const [id, r] of ringing) {
        if (r.until && t >= r.until) ringing.delete(id)
      }
      if (!ringing.size || settingsRef.current.muted) return
      const entries = [...ringing.values()]
      entries.sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind))
      const top = entries[0]
      if (t < top.nextAt) return
      playTone(top.kind, settingsRef.current.volume)
      const gap = (REPEAT_SECONDS[top.kind] || REPEAT_SECONDS.default) * 1000
      for (const r of entries) r.nextAt = t + gap
    }, 250)
    return () => clearInterval(timer)
  }, [])

  // "just now" labels.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000)
    return () => clearInterval(timer)
  }, [])

  const pending = useMemo(() => alerts.filter((a) => !a.acked), [alerts])

  // Flash the tab title while alerts wait in a background tab.
  useEffect(() => {
    if (!pending.length) return undefined
    const original = document.title
    let on = false
    const timer = setInterval(() => {
      if (!document.hidden) {
        document.title = original
        return
      }
      on = !on
      document.title = on ? `🔔 (${pending.length}) ${pending[0].title}` : original
    }, 1000)
    return () => {
      clearInterval(timer)
      document.title = original
    }
  }, [pending])

  const testSound = async () => {
    if (await unlock()) setUnlocked(true)
    playTone("order", settings.volume)
  }

  const askNotifications = async () => {
    if (typeof Notification === "undefined") return
    try {
      setNotifPermission(await Notification.requestPermission())
    } catch {
      // Blocked in browser settings.
    }
  }

  // Closed-tab alerts: once notifications are allowed, register this browser
  // for push so the server can still reach it with the panel closed.
  const [pushReady, setPushReady] = useState(false)
  useEffect(() => {
    if (notifPermission !== "granted") return
    let cancelled = false
    import("@food/utils/firebaseMessaging")
      .then((m) => m.registerAdminWebPush(getUnifiedAdminToken()))
      .then((ok) => {
        if (!cancelled) setPushReady(Boolean(ok))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [notifPermission])

  const showUnlockBar = isSupported() && !unlocked && !settings.muted

  return (
    <>
      {/* Alert cards */}
      {alerts.length > 0 && (
        <div className="fixed right-4 top-4 z-[9999] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
          {alerts.length > 1 && (
            <button
              type="button"
              onClick={clearAll}
              className="self-end rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-slate-900"
            >
              Clear all ({alerts.length})
            </button>
          )}
          <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
            {alerts.map((a) => {
              const meta = KINDS[a.kind] || KINDS.order
              const Icon = meta.icon
              const isRinging = !a.acked && ringingRef.current.has(a.id)
              return (
                <div
                  key={a.id}
                  onClick={() => acknowledge(a.id)}
                  className={`relative flex overflow-hidden rounded-xl border bg-white shadow-lg ${a.acked ? "border-slate-200 opacity-80" : "border-slate-300"} ${a.urgent && !a.acked ? "ring-2 ring-red-500" : ""}`}
                >
                  <div className={`w-1.5 shrink-0 ${meta.stripe}`} />
                  <div className="flex min-w-0 flex-1 gap-3 p-3">
                    <div className="relative mt-0.5 shrink-0">
                      <Icon className="h-5 w-5 text-slate-700" />
                      {isRinging && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-ping rounded-full bg-red-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{a.title}</p>
                      {a.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{a.body}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">{timeAgo(a.at, now)}</span>
                        {a.link && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              openAlert(a)
                            }}
                            className="ml-auto rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black"
                          >
                            Open
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={(e) => {
                        e.stopPropagation()
                        acknowledge(a.id, { remove: true })
                      }}
                      className="self-start rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sound is blocked until the first click on the page */}
      {showUnlockBar && (
        <div className="fixed bottom-4 left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          <Volume2 className="h-4 w-4" />
          <span>Click anywhere to turn on order sounds</span>
        </div>
      )}

      {/* Bell: mute state, pending count, settings */}
      <div className="fixed bottom-4 right-4 z-[9998]">
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          title={settings.muted ? "Alert sounds are off" : "Alert sounds"}
          className={`relative flex h-11 w-11 items-center justify-center rounded-full shadow-lg ${settings.muted ? "bg-slate-400" : "bg-slate-900"} text-white hover:opacity-90`}
        >
          {settings.muted ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          {pending.length > 0 && (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5">
              {pending.length}
            </span>
          )}
        </button>

        {panelOpen && (
          <div className="absolute bottom-14 right-0 w-72 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold">
                <Settings className="h-4 w-4" /> Alert sounds
              </span>
              <button type="button" onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mb-3 flex items-center justify-between">
              <span>Sound on</span>
              <input type="checkbox" checked={!settings.muted} onChange={(e) => saveSettings({ muted: !e.target.checked })} className="h-4 w-4 accent-slate-900" />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-slate-500">Volume</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={settings.volume}
                onChange={(e) => saveSettings({ volume: Number(e.target.value) })}
                className="w-full accent-slate-900"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-slate-500">Ring for</span>
              <select
                value={settings.ringSeconds}
                onChange={(e) => saveSettings({ ringSeconds: Number(e.target.value) })}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5"
              >
                <option value={5}>5 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={0}>Until I click it</option>
              </select>
              <span className="mt-1 block text-[11px] text-slate-400">SOS always rings until clicked.</span>
            </label>

            <div className="mb-3">
              <span className="mb-1 block text-xs text-slate-500">Ring for these</span>
              <div className="grid grid-cols-1 gap-1">
                {Object.entries(KINDS).map(([k, meta]) => (
                  <label key={k} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={settings.kinds[k] !== false}
                      onChange={(e) => saveSettings({ kinds: { ...settings.kinds, [k]: e.target.checked } })}
                      className="h-3.5 w-3.5 accent-slate-900"
                    />
                    {meta.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button type="button" onClick={testSound} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black">
                Test sound
              </button>
              {notifPermission === "default" && (
                <button type="button" onClick={askNotifications} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                  Allow desktop notifications
                </button>
              )}
              {notifPermission === "granted" && (
                <p className={`text-[11px] ${pushReady ? "text-emerald-700" : "text-slate-500"}`}>
                  {pushReady
                    ? "Alerts also arrive with this tab closed (while Chrome is running)."
                    : "Setting up alerts for when this tab is closed…"}
                </p>
              )}
              {notifPermission === "denied" && (
                <p className="text-[11px] text-amber-700">
                  Desktop notifications are blocked. Allow them from the lock icon in Chrome's address bar.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
