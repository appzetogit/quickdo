import { useRef, useState } from "react"
import { CheckCircle2, FileText, Loader2, Upload } from "lucide-react"
import { partnerApi, errorMessage } from "../partnerApi"

const isPdf = (url) => /\.pdf(\?|$)/i.test(String(url || ""))

/**
 * One document or photo. Uploads the moment it is chosen, so a slow connection
 * shows up here rather than as a long spinner on submit, and the application
 * only ever carries URLs.
 */
export default function UploadField({ label, hint, required, value, onChange, token, accept = "image/*,application/pdf", capture }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const pick = async (file) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError("That file is over 10 MB. Choose a smaller photo or PDF.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const { url } = await partnerApi.upload(token, file)
      onChange(url)
    } catch (e) {
      setError(errorMessage(e, "Upload failed. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">
          {label}
          {required ? <span className="text-rose-600"> *</span> : <span className="text-slate-400"> (optional)</span>}
        </span>
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
          value ? "border-emerald-300 bg-emerald-50/60" : "border-dashed border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          ) : value && !isPdf(value) ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : value ? (
            <FileText className="h-5 w-5 text-rose-500" />
          ) : (
            <Upload className="h-5 w-5 text-slate-400" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-700">
            {busy ? "Uploading…" : value ? "Uploaded — tap to replace" : "Tap to upload a photo or PDF"}
          </span>
          {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        </span>
        {value && !busy && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
      </button>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <input
        ref={input}
        type="file"
        accept={accept}
        capture={capture}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ""
        }}
      />
    </div>
  )
}
