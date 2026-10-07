import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  Plus,
  Search,
  Loader2,
  X,
  Pencil,
  Trash2,
  ShieldCheck,
  Crown,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Check,
} from "lucide-react"
import { adminAccountsAPI } from "@food/api"
import { refreshAdminAccess } from "@food/utils/adminAccess"

/**
 * Admin accounts, for every panel.
 *
 * One list and one form whichever panel it is opened from (Food, Quick
 * Commerce or Taxi): an account is a person, and the same person can be
 * given several panels. What each sub-admin may do is enforced by the server;
 * this screen is where it is decided.
 */

const PANEL_TONE = {
  food: "bg-orange-50 text-orange-800 ring-orange-200",
  quickCommerce: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  taxi: "bg-amber-50 text-amber-900 ring-amber-200",
}
const ROLE_META = {
  owner: { label: "Owner", Icon: Crown, tone: "bg-neutral-900 text-white" },
  full: { label: "Full access", Icon: ShieldCheck, tone: "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200" },
  custom: { label: "Custom", Icon: SlidersHorizontal, tone: "bg-neutral-100 text-neutral-800 ring-1 ring-neutral-200" },
}

/* Ready-made sets for the common jobs, so a new account takes one click. */
const PRESETS = [
  {
    key: "ops",
    label: "Operations",
    perms: ["dashboard.read", "orders.write", "restaurants.write", "foods.write", "categories.write", "delivery.write", "zones.read", "customers.read", "support.write", "fleet.write"],
  },
  { key: "support", label: "Support desk", perms: ["dashboard.read", "orders.read", "customers.write", "support.write", "delivery.read"] },
  { key: "finance", label: "Finance", perms: ["dashboard.read", "reports.read", "wallet.write", "fee_settings.write", "orders.read", "promotions.read"] },
  { key: "marketing", label: "Marketing", perms: ["dashboard.read", "promotions.write", "referrals.write", "cms.write", "reports.read"] },
]

const initials = (name = "", email = "") =>
  (name || email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")

const when = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

/* ------------------------------------------------------------------ bits */

function PanelChips({ services, labels }) {
  return (
    <div className="flex flex-wrap gap-1">
      {services.map((s) => (
        <span key={s} className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${PANEL_TONE[s] || "bg-neutral-100 text-neutral-700 ring-neutral-200"}`}>
          {labels[s] || s}
        </span>
      ))}
    </div>
  )
}

function RoleBadge({ role, count }) {
  const meta = ROLE_META[role] || ROLE_META.custom
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.tone}`}>
      <meta.Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
      {role === "custom" && typeof count === "number" && <span className="opacity-70">· {count}</span>}
    </span>
  )
}

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-50 ${checked ? "bg-emerald-600" : "bg-neutral-300"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  )
}

/** No access / View / Manage for one section. */
function LevelControl({ value, onChange, canWrite, label }) {
  const options = [
    { v: "none", text: "No access" },
    { v: "read", text: "View" },
    { v: "write", text: "Manage", disabled: !canWrite },
  ]
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-neutral-100 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          disabled={o.disabled}
          onClick={() => onChange(o.v)}
          title={o.disabled ? "You can only give what you have yourself" : undefined}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 ${
            value === o.v
              ? o.v === "none"
                ? "bg-white text-neutral-700 shadow-sm"
                : o.v === "read"
                  ? "bg-white text-sky-700 shadow-sm"
                  : "bg-white text-emerald-700 shadow-sm"
              : "text-neutral-500 hover:text-neutral-800"
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ the form */

const levelsFrom = (permissions = []) => {
  const out = {}
  for (const p of permissions) {
    const [r, a] = String(p).split(".")
    if (!r) continue
    if (a === "write") out[r] = "write"
    else if (a === "read" && out[r] !== "write") out[r] = "read"
  }
  return out
}
const permissionsFrom = (levels) =>
  Object.entries(levels).flatMap(([r, lvl]) => (lvl === "write" ? [`${r}.write`, `${r}.read`] : lvl === "read" ? [`${r}.read`] : []))

/** Zones an admin is limited to. None ticked = every zone. */
function ZonePicker({ title, zones, value, onChange, note }) {
  const all = value.length === 0
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>
        {!all && (
          <button type="button" className="text-xs font-medium text-neutral-600 underline" onClick={() => onChange([])}>
            All zones
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={all}
          onClick={() => onChange([])}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${all ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-neutral-300 text-neutral-700 hover:border-neutral-500"}`}
        >
          All zones
        </button>
        {zones.map((z) => {
          const on = value.includes(z.id)
          return (
            <button
              key={z.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== z.id) : [...value, z.id])}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? "border-amber-500 bg-amber-50 text-amber-900" : "border-neutral-300 text-neutral-700 hover:border-neutral-500"}`}
            >
              {z.name}
              {z.isActive === false ? " (off)" : ""}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-neutral-500">{all ? "Every zone. " : ""}{note}</p>
    </section>
  )
}

function AdminForm({ meta, editing, onClose, onSaved }) {
  const isEdit = Boolean(editing)
  const panelLabels = Object.fromEntries(meta.services.map((s) => [s.key, s.label]))
  const [form, setForm] = useState(() => ({
    name: editing?.name || "",
    email: editing?.email || "",
    phone: editing?.phone || "",
    password: "",
    confirm: "",
    role: editing?.role && meta.roles.some((r) => r.key === editing.role) ? editing.role : "custom",
    servicesAccess: editing?.servicesAccess?.filter((s) => panelLabels[s]) || (meta.services[0] ? [meta.services[0].key] : []),
    levels: levelsFrom(editing?.permissions || []),
    serviceLocationIds: editing?.serviceLocationIds || [],
    foodZoneIds: editing?.foodZoneIds || [],
    qcZoneIds: editing?.qcZoneIds || [],
    taxiZoneIds: editing?.taxiZoneIds || [],
    isActive: editing ? editing.isActive : true,
    // New sub-admins start without delete access; it is granted on purpose.
    canDelete: editing ? editing.canDelete !== false : false,
  }))
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setLevel = (key, lvl) => setForm((f) => ({ ...f, levels: { ...f.levels, [key]: lvl } }))

  // Only the sections that exist in the panels picked.
  const groups = useMemo(
    () =>
      meta.catalog
        .map((g) => ({ ...g, resources: g.resources.filter((r) => r.services.some((s) => form.servicesAccess.includes(s))) }))
        .filter((g) => g.resources.length),
    [meta.catalog, form.servicesAccess],
  )
  const visibleKeys = useMemo(() => new Set(groups.flatMap((g) => g.resources.map((r) => r.key))), [groups])
  const writable = useMemo(
    () => Object.fromEntries(meta.catalog.flatMap((g) => g.resources.map((r) => [r.key, r.canGrantWrite]))),
    [meta.catalog],
  )

  const chosen = Object.entries(form.levels).filter(([k, v]) => visibleKeys.has(k) && v !== "none")
  const manageCount = chosen.filter(([, v]) => v === "write").length

  const setGroup = (group, lvl) =>
    setForm((f) => {
      const levels = { ...f.levels }
      group.resources.forEach((r) => {
        levels[r.key] = lvl === "write" && !writable[r.key] ? "read" : lvl
      })
      return { ...f, levels }
    })

  const applyPreset = (preset) => {
    const levels = {}
    for (const p of preset.perms) {
      const [r, a] = p.split(".")
      if (!visibleKeys.has(r)) continue
      levels[r] = a === "write" && writable[r] ? "write" : levels[r] === "write" ? "write" : "read"
    }
    set({ levels })
  }

  const togglePanel = (key) =>
    set({
      servicesAccess: form.servicesAccess.includes(key)
        ? form.servicesAccess.filter((s) => s !== key)
        : [...form.servicesAccess, key],
    })

  const needsLocations = form.role !== "owner" && form.servicesAccess.includes("taxi")
  const showFoodZones = form.role !== "owner" && form.servicesAccess.includes("food") && (meta.foodZones || []).length > 0
  const showQcZones =
    form.role !== "owner" &&
    form.servicesAccess.includes("quickCommerce") &&
    (meta.qcZones || []).length > 0
  const showTaxiZones = form.role !== "owner" && form.servicesAccess.includes("taxi") && (meta.taxiZones || []).length > 0

  const submit = async (e) => {
    e.preventDefault()
    setError("")
    if (!form.name.trim()) return setError("Enter a name.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Enter a valid email address.")
    if (!isEdit || form.password) {
      if (form.password.length < 6) return setError("Password must be at least 6 characters.")
      if (form.password !== form.confirm) return setError("Passwords do not match.")
    }
    if (form.role !== "owner" && !form.servicesAccess.length) return setError("Pick at least one panel.")
    const permissions = permissionsFrom(Object.fromEntries(Object.entries(form.levels).filter(([k]) => visibleKeys.has(k))))
    if (form.role === "custom" && !permissions.length) return setError("Give at least one section View or Manage.")
    if (needsLocations && !form.serviceLocationIds.length) return setError("Pick at least one taxi service location.")

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
      servicesAccess: form.servicesAccess,
      permissions,
      serviceLocationIds: needsLocations ? form.serviceLocationIds : [],
      foodZoneIds: showFoodZones ? form.foodZoneIds : [],
      qcZoneIds: showQcZones ? form.qcZoneIds : [],
      taxiZoneIds: showTaxiZones ? form.taxiZoneIds : [],
      isActive: form.isActive,
      ...(form.role !== "owner" ? { canDelete: form.canDelete } : {}),
      ...(form.password ? { password: form.password, password_confirmation: form.confirm } : {}),
    }
    setSaving(true)
    try {
      if (isEdit) await adminAccountsAPI.update(editing.id, payload)
      else await adminAccountsAPI.create(payload)
      toast.success(isEdit ? "Changes saved" : `${payload.name} can now sign in`)
      onSaved()
    } catch (err) {
      setError(errorText(err, "Could not save. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="admin-form-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-neutral-900/40" onClick={onClose} />
      <form onSubmit={submit} className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 id="admin-form-title" className="text-lg font-semibold text-neutral-900">
              {isEdit ? `Edit ${editing.name || editing.email}` : "Add an admin"}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {isEdit ? "Changes apply on their next click; no need to sign out." : "They sign in at the admin login with this email and password."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-neutral-800">Name</span>
                <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Priya Sharma" autoFocus={!isEdit} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-neutral-800">Phone <span className="font-normal text-neutral-400">(optional)</span></span>
                <input className={inputCls} value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="98XXXXXXXX" inputMode="tel" />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium text-neutral-800">Email</span>
                <input className={inputCls} value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="priya@quickdropsindia.com" type="email" autoComplete="off" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-neutral-800">{isEdit ? "New password" : "Password"}</span>
                <div className="relative">
                  <input
                    className={`${inputCls} pr-9`}
                    value={form.password}
                    onChange={(e) => set({ password: e.target.value })}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={isEdit ? "Leave blank to keep" : "At least 6 characters"}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700" aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-neutral-800">Confirm password</span>
                <input className={inputCls} value={form.confirm} onChange={(e) => set({ confirm: e.target.value })} type={showPassword ? "text" : "password"} autoComplete="new-password" />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Access level</h3>
            <div className={`grid gap-2 ${meta.roles.length === 3 ? "sm:grid-cols-3" : meta.roles.length === 2 ? "sm:grid-cols-2" : ""}`}>
              {meta.roles.map((r) => {
                const RoleIcon = (ROLE_META[r.key] || ROLE_META.custom).Icon
                const on = form.role === r.key
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => set({ role: r.key })}
                    aria-pressed={on}
                    className={`flex items-start gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900 ${on ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:border-neutral-400"}`}
                  >
                    <RoleIcon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-neutral-900" : "text-neutral-400"}`} />
                    <span>
                      <span className="block text-sm font-semibold text-neutral-900">{r.label}</span>
                      <span className="block text-xs text-neutral-500">{r.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {form.role !== "owner" && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Panels</h3>
              <div className="flex flex-wrap gap-2">
                {meta.services.map((s) => {
                  const on = form.servicesAccess.includes(s.key)
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => togglePanel(s.key)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900 ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:border-neutral-500"}`}
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {needsLocations && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Taxi service locations</h3>
                {meta.serviceLocations.length > 1 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-neutral-700 underline-offset-2 hover:underline"
                    onClick={() =>
                      set({
                        serviceLocationIds:
                          form.serviceLocationIds.length === meta.serviceLocations.length ? [] : meta.serviceLocations.map((l) => l.id),
                      })
                    }
                  >
                    {form.serviceLocationIds.length === meta.serviceLocations.length ? "Clear" : "Select all"}
                  </button>
                )}
              </div>
              {meta.serviceLocations.length ? (
                <div className="flex flex-wrap gap-2">
                  {meta.serviceLocations.map((l) => {
                    const on = form.serviceLocationIds.includes(l.id)
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          set({ serviceLocationIds: on ? form.serviceLocationIds.filter((x) => x !== l.id) : [...form.serviceLocationIds, l.id] })
                        }
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? "border-amber-500 bg-amber-50 text-amber-900" : "border-neutral-300 text-neutral-700 hover:border-neutral-500"}`}
                      >
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No taxi service locations exist yet. Add one in the Taxi panel first.</p>
              )}
              <p className="text-xs text-neutral-500">Taxi shows this admin only rides, drivers and zones in these locations.</p>
            </section>
          )}

          {showFoodZones && (
            <ZonePicker
              title="Food zones"
              zones={meta.foodZones}
              value={form.foodZoneIds}
              onChange={(foodZoneIds) => set({ foodZoneIds })}
              note="Food shows this admin only the restaurants, orders, delivery partners and dashboard of these zones. With Zone settings below, they set earnings, incentives, cancellation and fees for these zones only."
            />
          )}
          {showQcZones && (
            <ZonePicker
              title="Quick commerce zones"
              zones={meta.qcZones}
              value={form.qcZoneIds}
              onChange={(qcZoneIds) => set({ qcZoneIds })}
              note="Quick Commerce shows this admin only the stores, orders, delivery partners and dashboard of these zones. With Zone settings below, they set earnings, incentives, cancellation and fees for these zones only."
            />
          )}
          {showTaxiZones && (
            <ZonePicker
              title="Taxi zones"
              zones={meta.taxiZones}
              value={form.taxiZoneIds}
              onChange={(taxiZoneIds) => set({ taxiZoneIds })}
              note="With Zone settings below, this admin sets driver incentives for these taxi zones only. Taxi lists are still limited by the service locations above."
            />
          )}

          {form.role === "custom" && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">What they can do</h3>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {chosen.length
                      ? `${chosen.length} section${chosen.length === 1 ? "" : "s"}: ${manageCount} to manage, ${chosen.length - manageCount} view only.`
                      : "Nothing yet. View shows a section; Manage also lets them change it."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-neutral-500">Start from:</span>
                  {PRESETS.map((p) => (
                    <button key={p.key} type="button" onClick={() => applyPreset(p)} className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {!form.servicesAccess.length && <p className="text-sm text-neutral-500">Pick a panel above to see its sections.</p>}

              {groups.map((g) => (
                <div key={g.group} className="overflow-hidden rounded-xl border border-neutral-200">
                  <div className="flex items-center justify-between bg-neutral-50 px-4 py-2">
                    <span className="text-sm font-semibold text-neutral-800">{g.group}</span>
                    <div className="flex gap-3 text-xs">
                      <button type="button" className="text-neutral-500 hover:text-neutral-900" onClick={() => setGroup(g, "none")}>None</button>
                      <button type="button" className="text-sky-700 hover:text-sky-900" onClick={() => setGroup(g, "read")}>View all</button>
                      <button type="button" className="text-emerald-700 hover:text-emerald-900" onClick={() => setGroup(g, "write")}>Manage all</button>
                    </div>
                  </div>
                  <ul className="divide-y divide-neutral-100">
                    {g.resources.map((r) => (
                      <li key={r.key} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-neutral-900">{r.label}</p>
                          <p className="text-xs text-neutral-500">{r.hint}</p>
                        </div>
                        <LevelControl
                          label={r.label}
                          value={form.levels[r.key] || "none"}
                          canWrite={r.canGrantWrite}
                          onChange={(lvl) => setLevel(r.key, lvl)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {form.role !== "owner" && (
            <section className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">Can delete</p>
                <p className="text-xs text-neutral-500">
                  {meta.me?.canDelete === false
                    ? "You don't have delete access yourself, so you can't give it."
                    : "Off: they can still add and edit, but can't delete anything in any panel, including zones, restaurants, stores, items, vehicles and drivers."}
                </p>
              </div>
              <Toggle
                checked={form.canDelete}
                onChange={(v) => set({ canDelete: v })}
                disabled={meta.me?.canDelete === false && !form.canDelete}
                label="Can delete"
              />
            </section>
          )}

          <section className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-neutral-900">Account active</p>
              <p className="text-xs text-neutral-500">Switched off, they are signed out of every panel on their next click.</p>
            </div>
            <Toggle checked={form.isActive} onChange={(v) => set({ isActive: v })} label="Account active" />
          </section>
        </div>

        <footer className="border-t border-neutral-200 px-6 py-3">
          {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create admin"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------ the page */

export default function AdminAccounts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: routeId } = useParams()
  const listPath = location.pathname.replace(/\/(create|edit\/[^/]+)\/?$/, "")

  const [meta, setMeta] = useState(null)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [q, setQ] = useState("")
  const [panel, setPanel] = useState("")
  const [status, setStatus] = useState("")
  const [busyId, setBusyId] = useState("")
  const [confirming, setConfirming] = useState(null)

  const creating = /\/create\/?$/.test(location.pathname)
  const editing = routeId ? rows.find((r) => r.id === routeId) : null

  const load = useCallback(async () => {
    try {
      const [m, list] = await Promise.all([adminAccountsAPI.meta(), adminAccountsAPI.list()])
      setMeta(m?.data?.data || null)
      setRows(list?.data?.data?.results || [])
      setSummary(list?.data?.data?.summary || null)
      setLoadError("")
    } catch (err) {
      setLoadError(errorText(err, "Could not load admin accounts."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const panelLabels = useMemo(() => Object.fromEntries((meta?.services || []).map((s) => [s.key, s.label])), [meta])
  const canManage = Boolean(meta?.me?.canManageAdmins)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (needle && ![r.name, r.email, r.phone].some((v) => String(v || "").toLowerCase().includes(needle))) return false
      if (panel && !r.servicesAccess.includes(panel)) return false
      if (status === "active" && !r.isActive) return false
      if (status === "inactive" && r.isActive) return false
      return true
    })
  }, [rows, q, panel, status])

  const closeForm = () => navigate(listPath)
  const afterSave = () => {
    navigate(listPath)
    load()
    refreshAdminAccess()
  }

  const toggleActive = async (row, next) => {
    setBusyId(row.id)
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, isActive: next } : r)))
    try {
      await adminAccountsAPI.setStatus(row.id, next)
      toast.success(next ? `${row.name || row.email} can sign in again` : `${row.name || row.email} is switched off`)
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, isActive: !next } : r)))
      toast.error(errorText(err, "Could not change that."))
    } finally {
      setBusyId("")
    }
  }

  const remove = async (row) => {
    setBusyId(row.id)
    try {
      await adminAccountsAPI.remove(row.id)
      toast.success(`${row.name || row.email} removed`)
      setConfirming(null)
      load()
    } catch (err) {
      toast.error(errorText(err, "Could not remove this admin."))
    } finally {
      setBusyId("")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-neutral-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading admin accounts
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          {loadError}
          <button type="button" onClick={() => { setLoading(true); load() }} className="ml-2 font-semibold underline">
            Try again
          </button>
        </div>
      </div>
    )
  }

  const stat = (label, value, key) => (
    <button
      type="button"
      onClick={() => setStatus(key)}
      aria-pressed={status === key}
      className={`rounded-xl border px-4 py-3 text-left transition-colors ${status === key ? "border-neutral-900 bg-white" : "border-transparent bg-white/60 hover:bg-white"}`}
    >
      <span className="block text-2xl font-semibold tabular-nums text-neutral-900">{value}</span>
      <span className="text-xs text-neutral-500">{label}</span>
    </button>
  )

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Admin accounts</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Who can open which panel, and what they can do there. One account works across Food, Quick Commerce and Taxi.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => navigate(`${listPath}/create`)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              <Plus className="h-4 w-4" /> Add admin
            </button>
          )}
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-2">
            {stat("All admins", summary.total, "")}
            {stat("Active", summary.active, "active")}
            {stat("Switched off", summary.total - summary.active, "inactive")}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email or phone"
              className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
            />
          </div>
          <select
            value={panel}
            onChange={(e) => setPanel(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            aria-label="Filter by panel"
          >
            <option value="">All panels</option>
            {(meta?.services || []).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {shown.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-neutral-800">{rows.length ? "No admin matches these filters" : "No other admins yet"}</p>
              <p className="mt-1 text-sm text-neutral-500">
                {rows.length ? "Clear the search or pick another panel." : canManage ? "Add one to share the work, with only the sections they need." : ""}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Access</th>
                    <th className="px-4 py-3 font-medium">Panels</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    <th className="px-4 py-3 font-medium">Active</th>
                    <th className="px-4 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {shown.map((r) => {
                    const sections = new Set(r.permissions.map((p) => p.split(".")[0])).size
                    const editable = canManage && (r.role !== "owner" || meta?.me?.isOwner)
                    return (
                      <tr key={r.id} className={r.isActive ? "" : "bg-neutral-50 text-neutral-500"}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700">
                              {initials(r.name, r.email)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-neutral-900">{r.name || "Unnamed"}</p>
                              <p className="truncate text-xs text-neutral-500">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <RoleBadge role={r.role} count={sections} />
                            {r.canDelete === false && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">No delete</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3"><PanelChips services={r.servicesAccess} labels={{ ...panelLabels, food: "Food", quickCommerce: "Quick Commerce", taxi: "Taxi" }} /></td>
                        <td className="px-4 py-3 text-xs text-neutral-500">
                          {when(r.createdAt)}
                          {r.createdBy && <span className="block">by {r.createdBy}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Toggle
                            checked={r.isActive}
                            disabled={!editable || busyId === r.id}
                            onChange={(v) => toggleActive(r, v)}
                            label={`${r.name || r.email} active`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {editable && (
                            <div className="flex justify-end gap-1">
                              <button type="button" onClick={() => navigate(`${listPath}/edit/${r.id}`)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label={`Edit ${r.name || r.email}`}>
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button type="button" onClick={() => setConfirming(r)} className="rounded-lg p-2 text-neutral-500 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${r.name || r.email}`}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {meta && canManage && (creating || editing) && (
        <AdminForm key={editing?.id || "new"} meta={meta} editing={editing} onClose={closeForm} onSaved={afterSave} />
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="remove-title">
          <button type="button" aria-label="Cancel" className="absolute inset-0 bg-neutral-900/40" onClick={() => setConfirming(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="remove-title" className="text-base font-semibold text-neutral-900">Remove {confirming.name || confirming.email}?</h2>
            <p className="mt-2 text-sm text-neutral-600">
              They lose access to every panel at once. Admins they created stay, and move under you. To pause access instead, switch the account off.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100">Cancel</button>
              <button
                type="button"
                disabled={busyId === confirming.id}
                onClick={() => remove(confirming)}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busyId === confirming.id && <Loader2 className="h-4 w-4 animate-spin" />}
                Remove admin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
