import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Send, Users } from "lucide-react"
import { toast } from "sonner"
import { masterBroadcastAPI } from "@food/api/masterAnalytics"
import { Card, btnCls, count, errorText, ghostCls, inputCls, verticalMeta, ZoneSelect } from "./masterKit"

/**
 * Master > Broadcasts: one message to any role -- customers, restaurants,
 * stores, riders, taxi drivers, Services vendors and workers -- by push (with
 * the in-app inbox), SMS and email, narrowed by zone and recent activity
 * (core/notifications/platformBroadcast.service.js). A channel that is not set
 * up is skipped and the broadcast says so.
 */

const CHANNELS = [
  { key: "push", label: "Push + in-app inbox" },
  { key: "sms", label: "SMS" },
  { key: "email", label: "Email" },
]

const statText = (b) => {
  const s = b.stats || {}
  const parts = []
  if (s.push) parts.push(s.push.skipped ? `Push skipped (${s.push.reason})` : `Push ${count(s.push.sent)} sent`)
  if (s.sms) parts.push(s.sms.skipped ? `SMS skipped (${s.sms.reason})` : `SMS ${count(s.sms.sent)} sent${s.sms.failed ? `, ${count(s.sms.failed)} failed` : ""}`)
  if (s.email) parts.push(s.email.skipped ? `Email skipped (${s.email.reason})` : `Email ${count((s.email.sent || 0) + (s.email.queued || 0))} sent${s.email.failed ? `, ${count(s.email.failed)} failed` : ""}`)
  if (s.error) parts.push(`Failed: ${s.error}`)
  return parts.join(" · ")
}

export default function MasterBroadcasts() {
  const [catalogue, setCatalogue] = useState([])
  const [roles, setRoles] = useState([])
  const [zoneVertical, setZoneVertical] = useState("")
  const [zoneId, setZoneId] = useState("")
  const [activeWithinDays, setActiveWithinDays] = useState("")
  const [channels, setChannels] = useState(["push"])
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [link, setLink] = useState("")
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState({ items: [], total: 0 })
  const [error, setError] = useState("")

  const loadHistory = useCallback(async () => {
    try {
      const res = await masterBroadcastAPI.list({ limit: 20 })
      setHistory(res?.data?.data || { items: [], total: 0 })
    } catch { /* shown empty */ }
  }, [])

  useEffect(() => {
    masterBroadcastAPI.roles()
      .then((res) => setCatalogue(res?.data?.data?.roles || []))
      .catch((err) => setError(errorText(err, "You do not have access to broadcasts.")))
    loadHistory()
  }, [loadHistory])

  const byVertical = useMemo(() => {
    const m = {}
    catalogue.forEach((r) => { (m[r.vertical] ||= []).push(r) })
    return m
  }, [catalogue])

  // A zone belongs to one service, so it can be used only when every chosen role is in that service.
  const chosenVerticals = [...new Set(roles.map((r) => catalogue.find((c) => c.key === r)?.vertical).filter(Boolean))]
  useEffect(() => {
    const v = chosenVerticals.length === 1 ? chosenVerticals[0] : ""
    if (v !== zoneVertical) { setZoneVertical(v); setZoneId("") }
  }, [chosenVerticals.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = {
    title, message, link, channels,
    segment: { roles, ...(zoneId ? { zoneId } : {}), ...(activeWithinDays ? { activeWithinDays: Number(activeWithinDays) } : {}) },
  }
  useEffect(() => { setPreview(null) }, [roles.join(","), zoneId, activeWithinDays]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list, setList, key) => setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])

  const doPreview = async () => {
    setPreviewing(true)
    try {
      const res = await masterBroadcastAPI.preview(body)
      setPreview(res?.data?.data || null)
    } catch (err) {
      toast.error(errorText(err, "Could not count the audience."))
    } finally {
      setPreviewing(false)
    }
  }

  const send = async () => {
    if (!title.trim() || !message.trim()) return toast.error("Write a title and a message")
    if (!roles.length) return toast.error("Choose who gets it")
    if (!channels.length) return toast.error("Choose at least one channel")
    if (!window.confirm(`Send "${title}" now${preview ? ` to ${preview.total} people` : ""}?`)) return undefined
    setSending(true)
    try {
      const res = await masterBroadcastAPI.send(body)
      const d = res?.data?.data
      toast.success(d?.status === "sending" ? `Sending to ${count(d.targetCount)} people` : `Sent to ${count(d?.targetCount)} people`)
      setTitle(""); setMessage(""); setLink(""); setPreview(null)
      loadHistory()
    } catch (err) {
      toast.error(errorText(err, "Could not send the broadcast."))
    } finally {
      setSending(false)
    }
    return undefined
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Broadcasts</h1>
          <p className="mt-1 text-sm text-neutral-600">Message customers, partners and drivers of every service, by push, SMS and email.</p>
        </div>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <Card title="Who gets it">
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(byVertical).map(([v, list]) => (
              <div key={v}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{verticalMeta(v).label}</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((r) => (
                    <label key={r.key} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${roles.includes(r.key) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
                      <input type="checkbox" className="sr-only" checked={roles.includes(r.key)} onChange={() => toggle(roles, setRoles, r.key)} />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {zoneVertical ? (
              <ZoneSelect vertical={zoneVertical} value={zoneId} onChange={setZoneId} />
            ) : (
              <span className="text-xs text-neutral-500">Pick roles from one service to narrow by zone.</span>
            )}
            <select aria-label="Active within" className={inputCls} value={activeWithinDays} onChange={(e) => setActiveWithinDays(e.target.value)}>
              <option value="">Anyone</option>
              <option value="7">Active in the last 7 days</option>
              <option value="30">Active in the last 30 days</option>
              <option value="90">Active in the last 90 days</option>
            </select>
            <button type="button" className={ghostCls} onClick={doPreview} disabled={!roles.length || previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Count
            </button>
          </div>
          {preview && (
            <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm">
              <p className="font-semibold">{count(preview.total)} people</p>
              <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                {preview.roles.map((r) => (
                  <li key={r.role}>{r.label}: {count(r.recipients)} ({count(r.withPush)} with the app, {count(r.withPhone)} with a phone, {count(r.withEmail)} with an email)</li>
                ))}
              </ul>
              {(!preview.channels.sms || !preview.channels.email) && (
                <p className="mt-1 text-xs text-amber-700">
                  {!preview.channels.sms && "SMS is not set up (Master settings > Payments & messages). "}
                  {!preview.channels.email && "Email is not set up. "}
                  Those channels will be skipped.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="Message">
          <div className="grid gap-3">
            <input className={inputCls} placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={inputCls} rows={4} placeholder="Message" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
            <input className={inputCls} placeholder="Link (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <label key={c.key} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={channels.includes(c.key)} onChange={() => toggle(channels, setChannels, c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-500">SMS in India must match a registered DLT template; set SMS_INDIA_HUB_BROADCAST_TEMPLATE_ID on the server for promotional messages.</p>
            <div>
              <button type="button" className={btnCls} onClick={send} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
              </button>
            </div>
          </div>
        </Card>

        <Card title={`Sent (${count(history.total)})`}>
          {history.items.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing sent yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {history.items.map((b) => (
                <li key={b._id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-neutral-900">{b.title}</span>
                    <span className="text-xs text-neutral-500">{new Date(b.createdAt).toLocaleString("en-IN")}</span>
                  </div>
                  <p className="text-neutral-700">{b.message}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {b.audience} · {count(b.targetCount)} people · {b.status === "sending" ? "Sending…" : statText(b)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
