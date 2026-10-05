import { useEffect, useRef, useState } from "react"
import io from "socket.io-client"
import { API_BASE_URL } from "@food/api/config"
import { getModuleToken } from "@food/utils/auth"

/**
 * Live dispatch events for the admin panel.
 *
 * Admin sockets are auto-joined to `admin:all` by the server once the handshake
 * carries the admin token. Food events come on the root namespace, Quick and
 * Medical on `/qc`. One socket per namespace is shared by every component that
 * listens (a list plus an open dialog do not open two connections), and it is
 * closed a moment after the last listener leaves.
 *
 * Callers get `connected`; while it is false they fall back to a light refresh.
 */

const EVENTS = ["manual_assignment_update", "order_status_update"]
const RELEASE_DELAY_MS = 3000

const channels = new Map()

const socketOrigin = () => {
  try {
    const base = API_BASE_URL || ""
    if (!base) return ""
    const origin = typeof window !== "undefined" ? window.location.origin : undefined
    return new URL(base, origin).origin
  } catch {
    return ""
  }
}

const namespaceFor = (vertical) => (vertical === "quickCommerce" ? "/qc" : "")

const notifyStatus = (channel) => {
  channel.statusListeners.forEach((fn) => {
    try {
      fn(channel.connected)
    } catch {
      /* a listener's own problem */
    }
  })
}

const acquire = (vertical) => {
  const ns = namespaceFor(vertical)
  let channel = channels.get(ns)
  if (channel) {
    if (channel.releaseTimer) {
      clearTimeout(channel.releaseTimer)
      channel.releaseTimer = null
    }
    channel.refs += 1
    return channel
  }

  channel = {
    ns,
    refs: 1,
    socket: null,
    connected: false,
    listeners: new Set(),
    statusListeners: new Set(),
    releaseTimer: null,
  }
  channels.set(ns, channel)

  const origin = socketOrigin()
  const token = getModuleToken("admin")
  if (!origin || !token) return channel

  const socket = io(`${origin}${ns}`, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    timeout: 20000,
  })
  channel.socket = socket

  socket.on("connect", () => {
    channel.connected = true
    notifyStatus(channel)
  })
  socket.on("disconnect", () => {
    channel.connected = false
    notifyStatus(channel)
  })
  socket.on("connect_error", () => {
    channel.connected = false
    notifyStatus(channel)
  })
  EVENTS.forEach((eventName) => {
    socket.on(eventName, (payload) => {
      channel.listeners.forEach((fn) => {
        try {
          fn(eventName, payload || {})
        } catch {
          /* a listener's own problem */
        }
      })
    })
  })
  return channel
}

const release = (channel) => {
  channel.refs -= 1
  if (channel.refs > 0) return
  channel.releaseTimer = setTimeout(() => {
    if (channel.refs > 0) return
    channel.socket?.removeAllListeners()
    channel.socket?.disconnect()
    channels.delete(channel.ns)
  }, RELEASE_DELAY_MS)
}

/**
 * @param {'food'|'quickCommerce'} vertical
 * @param {(eventName: string, payload: object) => void} onEvent
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ connected: boolean }}
 */
export function useAdminDispatchSocket(vertical, onEvent, { enabled = true } = {}) {
  const handlerRef = useRef(onEvent)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled) {
      setConnected(false)
      return undefined
    }
    const channel = acquire(vertical)
    const listener = (eventName, payload) => handlerRef.current?.(eventName, payload)
    channel.listeners.add(listener)
    channel.statusListeners.add(setConnected)
    setConnected(channel.connected)
    return () => {
      channel.listeners.delete(listener)
      channel.statusListeners.delete(setConnected)
      release(channel)
    }
  }, [vertical, enabled])

  return { connected }
}

export default useAdminDispatchSocket
