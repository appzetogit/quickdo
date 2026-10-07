import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { HelpCircle, Loader2, Pencil, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react"
import { faqAdminAPI } from "@/services/api/marketplace"

/**
 * Master > FAQs (plan §5.8): one list of questions for every app, per service
 * and category, in the order shown here. The apps read them from
 * GET /platform/faqs?vertical=.
 */

const VERTICALS = [
  { value: "general", label: "All apps (general)" },
  { value: "food", label: "Food" },
  { value: "quickCommerce", label: "Quick" },
  { value: "taxi", label: "Rides" },
  { value: "serviceProvider", label: "Services" },
  { value: "delivery", label: "Delivery partners" },
  { value: "store", label: "Stores & restaurants" },
]
const labelOf = (v) => VERTICALS.find((x) => x.value === v)?.label || v
const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const EMPTY = { vertical: "general", category: "General", question: "", answer: "", isActive: true }

export default function Faqs() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await faqAdminAPI.list(filter ? { vertical: filter } : {})
      setRows(res?.data?.data || [])
    } catch (err) {
      toast.error(errText(err, "Could not load FAQs"))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const key = `${r.vertical}::${r.category || "General"}`
      if (!map.has(key)) map.set(key, { vertical: r.vertical, category: r.category || "General", items: [] })
      map.get(key).items.push(r)
    }
    return [...map.values()]
  }, [rows])

  const save = async () => {
    if (!editing.question.trim() || !editing.answer.trim()) {
      toast.error("Write both the question and the answer")
      return
    }
    setSaving(true)
    try {
      const body = {
        vertical: editing.vertical,
        category: editing.category.trim() || "General",
        question: editing.question.trim(),
        answer: editing.answer.trim(),
        isActive: editing.isActive !== false,
      }
      if (editing._id) await faqAdminAPI.update(editing._id, body)
      else await faqAdminAPI.create(body)
      toast.success("FAQ saved")
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save the FAQ"))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.question}"?`)) return
    try {
      await faqAdminAPI.remove(row._id)
      toast.success("FAQ deleted")
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not delete the FAQ"))
    }
  }

  const toggle = async (row) => {
    try {
      await faqAdminAPI.update(row._id, { isActive: !row.isActive })
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not update the FAQ"))
    }
  }

  const move = async (group, index, dir) => {
    const items = [...group.items]
    const j = index + dir
    if (j < 0 || j >= items.length) return
    ;[items[index], items[j]] = [items[j], items[index]]
    try {
      await faqAdminAPI.reorder(items.map((it, i) => ({ id: it._id, sortOrder: i + 1 })))
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save the order"))
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 lg:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900">
              <HelpCircle className="h-5 w-5" /> FAQs
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              Questions shown in each app&apos;s help screen. &quot;All apps&quot; questions appear in every app, after that app&apos;s own.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Every app</option>
              {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setEditing({ ...EMPTY, vertical: filter || "general" })}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" /> Add FAQ
            </button>
          </div>
        </div>

        {editing && (
          <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-neutral-700">App</span>
                <select
                  value={editing.vertical}
                  onChange={(e) => setEditing((x) => ({ ...x, vertical: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                >
                  {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-neutral-700">Category</span>
                <input
                  value={editing.category}
                  onChange={(e) => setEditing((x) => ({ ...x, category: e.target.value }))}
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="Orders, Payments, Account..."
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-neutral-700">Question</span>
              <input
                value={editing.question}
                onChange={(e) => setEditing((x) => ({ ...x, question: e.target.value }))}
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-neutral-700">Answer</span>
              <textarea
                value={editing.answer}
                onChange={(e) => setEditing((x) => ({ ...x, answer: e.target.value }))}
                maxLength={5000}
                rows={5}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={editing.isActive !== false}
                onChange={(e) => setEditing((x) => ({ ...x, isActive: e.target.checked }))}
              />
              Shown in the app
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">Cancel</button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">No FAQs yet.</p>
        ) : (
          groups.map((g) => (
            <div key={`${g.vertical}-${g.category}`} className="rounded-xl border border-neutral-200 bg-white">
              <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium text-neutral-800">
                {labelOf(g.vertical)} <span className="text-neutral-400">/</span> {g.category}
              </div>
              <ul className="divide-y divide-neutral-100">
                {g.items.map((row, i) => (
                  <li key={row._id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex flex-col">
                      <button type="button" aria-label="Move up" onClick={() => move(g, i, -1)} disabled={i === 0} className="text-neutral-400 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" aria-label="Move down" onClick={() => move(g, i, 1)} disabled={i === g.items.length - 1} className="text-neutral-400 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${row.isActive ? "text-neutral-900" : "text-neutral-400 line-through"}`}>{row.question}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{row.answer}</p>
                    </div>
                    <button type="button" onClick={() => toggle(row)} className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700">
                      {row.isActive ? "Hide" : "Show"}
                    </button>
                    <button type="button" aria-label="Edit" onClick={() => setEditing({ ...row })} className="text-neutral-500"><Pencil className="h-4 w-4" /></button>
                    <button type="button" aria-label="Delete" onClick={() => remove(row)} className="text-red-500"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
