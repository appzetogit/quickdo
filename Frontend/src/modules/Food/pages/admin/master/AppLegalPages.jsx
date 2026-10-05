import { useState, useEffect, useCallback } from "react"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { legalHtmlToPlainText, plainTextToLegalHtml } from "@food/utils/legalContentFormat"

/**
 * Terms and privacy per app: the restaurant app, the food delivery app, the
 * quick commerce seller app and so on each get their own
 * (core/settings/appLegal.js on the server). An app with nothing written here
 * shows the platform-wide page from the Legal pages tab.
 */

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
const ghostCls =
  "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

export default function AppLegalPages() {
  const [meta, setMeta] = useState(null)
  const [app, setApp] = useState("food_user")
  const [kind, setKind] = useState("terms")
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await platformSettingsAPI.getAppLegal()
      setMeta(res?.data?.data)
    } catch (err) {
      toast.error(errText(err, "Could not load the pages"))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const saved = meta?.pages?.[`${app}:${kind}`]
  const savedText = legalHtmlToPlainText(saved?.content || "")
  useEffect(() => {
    setTitle(saved?.title || "")
    setText(savedText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, kind, meta])

  const save = async (value) => {
    setBusy(true)
    try {
      await platformSettingsAPI.saveAppLegal(app, kind, {
        title: value ? title : "",
        content: value ? plainTextToLegalHtml(value) : "",
      })
      toast.success(value ? "Saved. This app now shows this page." : "Cleared. This app shows the platform-wide page again.")
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  if (!meta) {
    return (
      <div className="flex items-center gap-2 py-10 text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pages
      </div>
    )
  }

  const groups = [...new Set(meta.apps.map((a) => a.group))]
  const appLabel = meta.apps.find((a) => a.key === app)?.label
  const kindLabel = meta.kinds.find((k) => k.key === kind)?.label

  /*
   *     this app's own page  >  the platform-wide page  >  the vertical's own
   *
   * The same order the server resolves in (core/settings/appLegal.js).
   */
  const inForce = saved
    ? { text: "shows the page below.", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" }
    : meta.platform?.[kind]
      ? { text: "nothing written here, so it shows the platform-wide page from Master Settings › Legal pages.", tone: "border-blue-200 bg-blue-50 text-blue-900" }
      : { text: "nothing written here and no platform-wide page, so it falls back to this vertical's own Pages screen.", tone: "border-amber-200 bg-amber-50 text-amber-900" }
  const dirty = text !== savedText || (saved && title !== (saved.title || ""))

  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-5 py-4">
        <h2 className="text-base font-semibold text-neutral-900">Terms for each app</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Separate terms and privacy for customers, restaurants, sellers, riders and drivers.
          An app shows its own page first, then the platform-wide one, then its vertical&apos;s own screen.
        </p>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-[210px_1fr]">
        <nav className="space-y-4" aria-label="Apps">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{g}</p>
              <div className="space-y-0.5">
                {meta.apps.filter((a) => a.group === g).map((a) => {
                  const count = meta.kinds.filter((k) => meta.pages[`${a.key}:${k.key}`]).length
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => setApp(a.key)}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm ${app === a.key ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
                    >
                      <span>{a.label.split(": ")[1] || a.label}</span>
                      {count > 0 && <span className={`text-[11px] tabular-nums ${app === a.key ? "text-neutral-300" : "text-emerald-600"}`}>{count}/{meta.kinds.length}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {meta.kinds.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${kind === k.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
              >
                {k.label}{meta.pages[`${app}:${k.key}`] ? " ✓" : ""}
              </button>
            ))}
          </div>
          {/*
            * Which of the three levels this app is ACTUALLY showing.
            *
            * It used to say "shows the platform-wide page" whenever nothing was
            * written here -- true only when such a page exists. With none, the
            * app falls through to its vertical's own screen, and an admin told
            * otherwise goes looking in the wrong place.
            */}
          <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${inForce.tone}`}>
            <span className="font-semibold">{appLabel}</span> · {inForce.text}
          </div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Title</label>
          <input className={`${inputCls} mb-3`} value={title} placeholder={kindLabel} onChange={(e) => setTitle(e.target.value)} />
          <label className="mb-1 block text-xs font-medium text-neutral-600">Page</label>
          <textarea
            rows={16}
            className={`${inputCls} font-mono text-[13px] leading-relaxed`}
            value={text}
            placeholder={`Write the ${kindLabel} for the ${appLabel}…`}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {saved && (
              <button type="button" className={ghostCls} disabled={busy} onClick={() => save("")}>
                Use the platform-wide page
              </button>
            )}
            <button type="button" className={btnCls} disabled={!dirty || busy || !text.trim()} onClick={() => save(text)}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save {kindLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
