import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ExternalLink, Loader2, RotateCcw, Upload } from "lucide-react"
import { adminAPI } from "@food/api"

/*
 * Master -> Homepage Video: the "Video Demo" section of the website home page
 * (quickdropsindia.com). Until something is set here, the site plays the
 * video built into it with its original three tabs.
 *
 * Each tab jumps the video to its start point and is highlighted while that
 * part plays, so the start points go in order.
 */

const BUILT_IN_VIDEO = "/food/delivery1.mp4"
const DEFAULT_TABS = [
  { label: "Premium Ride Hailing", description: "Book verified professional captains and travel in comfort with live tracking.", start_percent: 0 },
  { label: "On-Demand Delivery", description: "Craving local delicacies or need fresh groceries? Smart-dispatch delivery at your doorstep.", start_percent: 33 },
  { label: "Logistics & Cargo", description: "Move house, send large packages, or manage warehouse supplies with cargo freight.", start_percent: 66 },
]
const MAX_MB = 25

export default function HomepageVideo() {
  const [data, setData] = useState(null)
  const [tabs, setTabs] = useState(DEFAULT_TABS)
  const [link, setLink] = useState("")
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  const fill = useCallback((d) => {
    setData(d)
    setTabs(d?.tabs?.length ? d.tabs.map((t) => ({ ...t })) : DEFAULT_TABS)
    setLink(d?.source === "link" ? d.url : "")
    setFile(null)
    setPreviewUrl("")
    if (fileRef.current) fileRef.current.value = ""
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getHomepageVideo()
      fill(res?.data?.data || null)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load the homepage video")
    } finally {
      setLoading(false)
    }
  }, [fill])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl])

  const pickFile = (f) => {
    if (!f) return
    if (!f.type.startsWith("video/")) {
      toast.error("Choose a video file (MP4, WebM or MOV)")
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`That video is ${(f.size / 1024 / 1024).toFixed(1)} MB. The most allowed is ${MAX_MB} MB.`)
      return
    }
    setFile(f)
    setLink("")
    setPreviewUrl(URL.createObjectURL(f))
  }

  const setTab = (i, key, value) => setTabs((prev) => prev.map((t, j) => (j === i ? { ...t, [key]: value } : t)))

  const save = async () => {
    if (tabs.some((t) => !String(t.label || "").trim())) {
      toast.error("Every tab needs a title")
      return
    }
    const starts = tabs.map((t) => Number(t.start_percent) || 0)
    if (starts.some((n, i) => i > 0 && n <= starts[i - 1])) {
      toast.error("Start points must go up from tab to tab")
      return
    }
    setSaving(true)
    try {
      const body = new FormData()
      if (file) body.append("video", file)
      else body.append("url", link.trim())
      body.append("tabs", JSON.stringify(tabs.map((t) => ({ label: t.label, description: t.description, start_percent: Number(t.start_percent) || 0 }))))
      const res = await adminAPI.saveHomepageVideo(body)
      fill(res?.data?.data || null)
      toast.success("Homepage video saved. It shows on the website now.")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save the homepage video")
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!window.confirm("Go back to the video built into the website and its original tabs?")) return
    setSaving(true)
    try {
      const body = new FormData()
      body.append("reset", "true")
      const res = await adminAPI.saveHomepageVideo(body)
      fill(res?.data?.data || null)
      toast.success("Back to the built-in video")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not reset")
    } finally {
      setSaving(false)
    }
  }

  const shownVideo = previewUrl || (file ? "" : link.trim()) || data?.url || BUILT_IN_VIDEO
  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Homepage Video</h1>
          <p className="mt-1 text-sm text-neutral-500">
            The "Video Demo" section of the website home page, and the three tabs beside it.
          </p>
        </div>
        <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-900">
          View the home page <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-500" /></div>
      ) : (
        <>
          <section className="grid gap-5 rounded-xl border border-neutral-200 bg-white p-5 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <div className="aspect-video w-full overflow-hidden rounded-lg bg-neutral-900">
                {shownVideo ? (
                  <video key={shownVideo} src={shownVideo} controls muted playsInline className="h-full w-full object-cover" />
                ) : null}
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {file
                  ? `New video, not saved yet: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
                  : data?.usingBuiltIn
                    ? "Showing the video built into the website."
                    : `Showing the ${data?.source === "upload" ? "uploaded video" : "linked video"}${data?.updatedAt ? `, set ${new Date(data.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}.`}
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-neutral-800">Upload a video</p>
                <p className="text-xs text-neutral-500">MP4, WebM or MOV, up to {MAX_MB} MB. A landscape (16:9) video looks best.</p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
                  <Upload className="h-4 w-4" /> {file ? "Choose another" : "Choose video"}
                  <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
                </label>
              </div>
              <div>
                <label htmlFor="video-link" className="text-sm font-medium text-neutral-800">Or link to a video file</label>
                <p className="text-xs text-neutral-500">A direct https link to an .mp4. YouTube links cannot play in this section.</p>
                <input
                  id="video-link"
                  type="url"
                  value={link}
                  disabled={Boolean(file)}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…/video.mp4"
                  className={`mt-2 ${field} disabled:bg-neutral-100`}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-neutral-900">Tabs beside the video</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Clicking a tab jumps the video to its start point (a share of the video's length), and the tab lights up while that part plays.
            </p>
            <div className="mt-4 space-y-3">
              {tabs.map((t, i) => (
                <div key={i} className="grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-[1fr_2fr_8rem]">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-600">Tab {i + 1} title</label>
                    <input value={t.label} maxLength={40} onChange={(e) => setTab(i, "label", e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-600">Description</label>
                    <input value={t.description} maxLength={160} onChange={(e) => setTab(i, "description", e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-600">Starts at (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={t.start_percent}
                      onChange={(e) => setTab(i, "start_percent", e.target.value.replace(/[^0-9]/g, ""))}
                      className={`${field} tabular-nums`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={reset}
              disabled={saving || data?.usingBuiltIn}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" /> Use the built-in video
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving && file ? "Uploading…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
