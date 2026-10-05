import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Loader2, RefreshCw, ExternalLink, Upload, Trash2, ImageOff } from "lucide-react"
import { homeContentAPI } from "@food/api"

/**
 * Master > Banner & Settings > Home Screen Banners.
 *
 * Every picture the customer app shows on its home screens, grouped by where it
 * appears (core/cms/homeContent.service.js). Pause and resume work here for all
 * of them; uploading and editing open each service's own screen -- except
 * Quick's top banners, which have no other screen and are managed here.
 *
 * The file and its API path avoid the word "banner": ad blockers block requests
 * and scripts whose URL contains it, and the page would silently load empty.
 */

const STATE = {
  live: { label: "Live", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  scheduled: { label: "Scheduled", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  paused: { label: "Paused", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  ended: { label: "Ended", tone: "bg-neutral-100 text-neutral-500 ring-neutral-200" },
}

const errorText = (err, fallback) => err?.response?.data?.message || fallback
const day = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "")

function Tile({ item, busy, onToggle, onRemove }) {
  const s = STATE[item.state] || STATE.live
  const dates = item.startDate || item.endDate ? `${item.startDate ? day(item.startDate) : "…"} – ${item.endDate ? day(item.endDate) : "…"}` : ""
  return (
    <li className={`flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white ${item.state === "live" ? "" : "opacity-75"}`}>
      <div className="relative aspect-[16/9] bg-neutral-100">
        {item.imageUrl ? (
          item.isVideo ? (
            <video src={item.imageUrl} muted loop playsInline className="h-full w-full object-cover" aria-label={item.title || "Video banner"} />
          ) : (
            <img src={item.imageUrl} alt={item.title || ""} loading="lazy" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400"><ImageOff className="h-6 w-6" /></div>
        )}
        <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.tone}`}>{s.label}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="truncate text-sm font-medium text-neutral-900">{item.title || "Untitled"}</p>
        {(item.zone || dates) && (
          <p className="truncate text-xs text-neutral-500">{[item.zone, dates].filter(Boolean).join(" · ")}</p>
        )}
        <div className="mt-auto flex items-center gap-1.5 pt-1.5">
          {item.state !== "ended" && (
            <button
              type="button"
              disabled={busy}
              onClick={onToggle}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {item.state === "paused" ? "Resume" : "Pause"}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className="ml-auto rounded-md p-1 text-neutral-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
              aria-label="Delete this picture"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function Grid({ items, busy, toggle, remove }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <Tile key={it.id} item={it} busy={busy === it.id} onToggle={() => toggle(it)} onRemove={remove ? () => remove(it) : null} />
      ))}
    </ul>
  )
}

export default function HomeScreenArtwork() {
  const [groups, setGroups] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await homeContentAPI.list()
      setGroups(res?.data?.data?.groups || [])
    } catch (err) {
      setError(errorText(err, "Could not load the home screen banners."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (item) => {
    const live = item.state === "paused"
    setBusy(item.id)
    try {
      await homeContentAPI.setLive(item.group, item.id, live)
      toast.success(live ? "Showing again in the app" : "Hidden from the app")
      await load()
    } catch (err) {
      toast.error(errorText(err, "Could not change this banner."))
    } finally {
      setBusy("")
    }
  }

  const removeTop = async (item) => {
    if (!window.confirm("Delete this picture from Quick's home? This can't be undone.")) return
    setBusy(item.id)
    try {
      await homeContentAPI.removeQuickTop(item.id)
      toast.success("Deleted")
      await load()
    } catch (err) {
      toast.error(errorText(err, "Could not delete it."))
    } finally {
      setBusy("")
    }
  }

  const uploadTop = async (files) => {
    if (!files?.length) return
    const form = new FormData()
    Array.from(files).forEach((f) => form.append("files", f))
    setUploading(true)
    try {
      const res = await homeContentAPI.uploadQuickTop(form)
      const errs = res?.data?.data?.errors || []
      if (errs.length) toast.error(errs[0])
      else toast.success(`${files.length} picture${files.length === 1 ? "" : "s"} added to Quick's home`)
      await load()
    } catch (err) {
      toast.error(errorText(err, "Could not upload."))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Home screen banners</h1>
            <p className="mt-1 text-sm text-neutral-600">Every picture customers see on the app&rsquo;s home screens, by where it appears.</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-14 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button type="button" onClick={load} className="mt-3 text-sm font-medium text-neutral-900 underline">Try again</button>
          </div>
        ) : !groups ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="rounded-xl border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-neutral-900">{g.label}</h2>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {g.where} · <span className="tabular-nums">{g.live}</span> live
                  </p>
                </div>
                {g.key === "quickTop" ? (
                  <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Add pictures
                    <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => uploadTop(e.target.files)} />
                  </label>
                ) : (
                  g.editPath && (
                    <Link to={g.editPath} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
                      Add or edit
                      <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                    </Link>
                  )
                )}
              </div>

              <div className="space-y-5 p-5">
                {g.key === "header" ? (
                  g.sections.map((sec) => (
                    <div key={sec.id}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        {sec.label} <span className="font-normal normal-case tracking-normal text-neutral-400">· {sec.items.length}</span>
                      </h3>
                      {sec.items.length ? (
                        <Grid items={sec.items} busy={busy} toggle={toggle} />
                      ) : (
                        <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-2.5 text-sm text-neutral-500">
                          No artwork. The app shows a plain colour here.
                        </p>
                      )}
                    </div>
                  ))
                ) : g.items.length ? (
                  <Grid items={g.items} busy={busy} toggle={toggle} remove={g.key === "quickTop" ? removeTop : null} />
                ) : (
                  <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center text-sm text-neutral-500">
                    Nothing here yet, so this spot is empty in the app.
                  </p>
                )}
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-neutral-500">
          Taxi&rsquo;s banners under Taxi &gt; Promotions are sent as push notifications; the app&rsquo;s Rides home shows only its header artwork above.
        </p>
      </div>
    </div>
  )
}
