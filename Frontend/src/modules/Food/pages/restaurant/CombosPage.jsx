import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Boxes, Check, Pencil, Plus, Trash2, X } from "lucide-react"
import toast from "react-hot-toast"

import { restaurantAPI, uploadAPI } from "@food/api"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

/**
 * Combos: pick dishes you already sell and offer them together at one price.
 *
 * A combo is stored as a dish, which is why it lands in the approval queue the
 * same way a new dish does. Nothing here decides the final price at checkout --
 * the server recomputes the component total from the live menu when it saves, so
 * a stale tab cannot bank an old price.
 *
 * The one rule worth surfacing in the UI rather than only in an error: a combo
 * has to be cheaper than its parts. The saving is shown live as the price is
 * typed so that is obvious before anyone presses Save.
 */

const MIN_COMPONENTS = 2
const MAX_COMPONENTS = 10

const rupees = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return "₹0"
    return "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN")
}

const emptyRow = () => ({
    localId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    // "catalog" picks a dish you already sell; "manual" is a typed name and
    // price for something with no menu entry of its own (a giveaway item, a
    // one-off add-on). The server treats both the same way once saved -- see
    // combo.js on the backend.
    mode: "catalog",
    itemId: "",
    variantId: "",
    manualName: "",
    manualPrice: "",
    quantity: 1,
})

const emptyDraft = () => ({
    comboId: null,
    name: "",
    description: "",
    image: "",
    comboPrice: "",
    // Two rows from the start: a combo is a pair at minimum, so an empty form
    // should already look like the thing being made.
    rows: [emptyRow(), emptyRow()],
})

const draftFromCombo = (combo) => ({
    comboId: combo._id || combo.id,
    name: combo.name || "",
    description: combo.description || "",
    image: combo.image || "",
    comboPrice: combo.price != null ? String(combo.price) : "",
    rows: (combo.comboComponents || []).map((c, index) => {
        const isManual = !c.itemId
        return {
            localId: `row-${index}-${String(c.itemId || c.nameSnapshot)}`,
            mode: isManual ? "manual" : "catalog",
            itemId: String(c.itemId || ""),
            variantId: c.variantId ? String(c.variantId) : "",
            manualName: isManual ? c.nameSnapshot || "" : "",
            manualPrice: isManual && c.listUnitPrice != null ? String(c.listUnitPrice) : "",
            quantity: Number(c.quantity) || 1,
        }
    }),
})

export default function CombosPage() {
    const goBack = useRestaurantBackNavigation("/restaurant/explore")

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [combos, setCombos] = useState([])
    const [dishes, setDishes] = useState([])
    const [draft, setDraft] = useState(null)
    // Held separately from the draft: the file is only uploaded on save, so
    // abandoning a half-filled form does not leave an orphaned upload behind.
    const [imageFile, setImageFile] = useState(null)
    const [imagePreview, setImagePreview] = useState("")

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [comboRes, menuRes] = await Promise.all([
                restaurantAPI.getCombos(),
                restaurantAPI.getMenu().catch(() => null),
            ])

            const list = comboRes?.data?.data?.combos || comboRes?.data?.combos || []
            setCombos(Array.isArray(list) ? list : [])

            // The menu arrives as sections; flatten it into a flat pick list. A
            // combo cannot contain another combo, so those are filtered out here
            // as well as refused by the server.
            // The body is { success, message, data: { menu: { sections } } }, so
            // the sections sit two levels down. Reading data.data.sections leaves
            // the picker silently empty, since getMenu is caught and a missing key
            // just yields an empty list.
            const menuPayload =
                menuRes?.data?.data?.menu || menuRes?.data?.menu || menuRes?.data?.data || menuRes?.data || {}
            const sections = Array.isArray(menuPayload.sections) ? menuPayload.sections : []
            const flat = []
            for (const section of sections) {
                for (const item of section?.items || []) {
                    if (item?.isCombo) continue
                    flat.push({
                        id: String(item._id || item.id),
                        name: item.name || "Unnamed dish",
                        price: Number(item.price) || 0,
                        variants: item.variantsEnabled === false ? [] : item.variants || [],
                    })
                }
            }
            const seen = new Set()
            setDishes(flat.filter((d) => (seen.has(d.id) ? false : seen.add(d.id))))
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not load your combos.")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const dishesById = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes])

    /** The price of one specific pick: a manual price, a chosen size, or the dish. */
    const unitPrice = useCallback(
        (row) => {
            if (row.mode === "manual") return Number(row.manualPrice) || 0
            const dish = dishesById.get(row.itemId)
            if (!dish) return 0
            if (row.variantId) {
                const variant = (dish.variants || []).find((v) => String(v._id) === row.variantId)
                return Number(variant?.price) || 0
            }
            return Number(dish.price) || 0
        },
        [dishesById],
    )

    /** What makes a row "filled in" -- a picked dish, or a typed manual name. */
    const isRowFilled = (row) => (row.mode === "manual" ? Boolean(row.manualName.trim()) : Boolean(row.itemId))

    /** What counts as "a different dish" for the 2-dish minimum -- mirrors the
     *  server's dishIdentity in combo.js, so the inline count and the eventual
     *  save error never disagree. */
    const rowIdentity = (row) =>
        row.mode === "manual" ? `manual::${row.manualName.trim().toLowerCase()}` : row.itemId

    const componentTotal = useMemo(() => {
        if (!draft) return 0
        return draft.rows.reduce((sum, row) => sum + unitPrice(row) * (Number(row.quantity) || 1), 0)
    }, [draft, unitPrice])

    const comboPriceNumber = Number(draft?.comboPrice)
    const savingAmount =
        Number.isFinite(comboPriceNumber) && comboPriceNumber > 0
            ? Math.max(0, componentTotal - comboPriceNumber)
            : 0
    const savingPercent = componentTotal > 0 ? Math.round((savingAmount / componentTotal) * 100) : 0


    /**
     * Open or close the editor.
     *
     * Always clears the picked file. Without that, choosing a photo, cancelling,
     * then editing a different combo would upload the first file onto the second.
     */
    const openDraft = (next) => {
        setDraft(next)
        setImageFile(null)
        setImagePreview("")
    }

    const patchRow = (localId, patch) =>
        setDraft((d) => ({
            ...d,
            rows: d.rows.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
        }))

    const handleSave = async () => {
        if (!draft) return

        const name = draft.name.trim()
        if (!name) return toast.error("Give the combo a name.")

        const rows = draft.rows.filter(isRowFilled)
        if (rows.length < MIN_COMPONENTS) {
            return toast.error(`Pick or type at least ${MIN_COMPONENTS} different dishes for a combo.`)
        }
        if (new Set(rows.map(rowIdentity)).size < MIN_COMPONENTS) {
            return toast.error("A combo needs at least two different dishes.")
        }
        const unpriced = rows.find((row) => row.mode === "manual" && !(Number(row.manualPrice) > 0))
        if (unpriced) {
            return toast.error(`Set a price for "${unpriced.manualName.trim()}".`)
        }
        if (!Number.isFinite(comboPriceNumber) || comboPriceNumber <= 0) {
            return toast.error("Set a combo price above zero.")
        }
        if (comboPriceNumber >= componentTotal) {
            return toast.error(
                `A combo has to be cheaper than its parts. These dishes cost ${rupees(componentTotal)} separately.`,
            )
        }

        const body = {
            name,
            description: draft.description.trim(),
            comboPrice: comboPriceNumber,
            components: rows.map((row) =>
                row.mode === "manual"
                    ? {
                          manualName: row.manualName.trim(),
                          manualPrice: Number(row.manualPrice) || 0,
                          quantity: Number(row.quantity) || 1,
                      }
                    : {
                          itemId: row.itemId,
                          variantId: row.variantId || null,
                          quantity: Number(row.quantity) || 1,
                      },
            ),
        }

        setSaving(true)
        try {
            let image = draft.image || ""
            if (imageFile) {
                const uploaded = await uploadAPI.uploadMedia(imageFile, { folder: "restaurant/combos" })
                image = uploaded?.data?.data?.url || uploaded?.data?.url || image
            }
            body.image = image

            if (draft.comboId) {
                await restaurantAPI.updateCombo(draft.comboId, body)
                toast.success("Combo updated. It goes live once approved.")
            } else {
                await restaurantAPI.createCombo(body)
                toast.success("Combo created. It goes live once approved.")
            }
            setDraft(null)
            setImageFile(null)
            setImagePreview("")
            await load()
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not save that combo.")
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (combo) => {
        if (!window.confirm(`Delete "${combo.name}"? This removes the combo from your menu.`)) return
        try {
            await restaurantAPI.deleteCombo(combo._id || combo.id)
            toast.success("Combo deleted.")
            await load()
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not delete that combo.")
        }
    }

    return (
        <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
            <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={goBack}
                        className="rounded-xl p-2 -ml-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                        aria-label="Back"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h1 className="text-base sm:text-lg font-bold text-gray-900">Combos</h1>
                        <p className="text-xs text-gray-500 hidden sm:block">
                            Pair dishes you already sell and offer them together at one price.
                        </p>
                    </div>
                </div>

                {!draft && !loading && (
                    <button
                        type="button"
                        onClick={() => openDraft(emptyDraft())}
                        className="inline-flex items-center gap-1.5 px-4 sm:px-6 py-2 rounded-xl text-sm font-semibold text-white bg-primary-orange hover:brightness-95 transition-all shadow-sm"
                    >
                        <Plus className="h-4 w-4" />
                        New combo
                    </button>
                )}
            </div>

            <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
                {loading && <p className="text-sm text-gray-500">Loading your combos...</p>}

                {/* ---------------- editor ---------------- */}
                {draft && (
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-gray-900">
                                {draft.comboId ? "Edit combo" : "New combo"}
                            </h2>
                            <button
                                type="button"
                                onClick={() => openDraft(null)}
                                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                aria-label="Cancel"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block">
                                <span className="text-xs font-semibold text-gray-700">Combo name</span>
                                <input
                                    type="text"
                                    value={draft.name}
                                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                    placeholder="Burger + Fries + Coke"
                                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-orange"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs font-semibold text-gray-700">Description (optional)</span>
                                <input
                                    type="text"
                                    value={draft.description}
                                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                                    placeholder="Our best-selling meal, together"
                                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-orange"
                                />
                            </label>
                        </div>

                        <div className="space-y-2">
                            <span className="text-xs font-semibold text-gray-700">Photo (optional)</span>
                            <div className="flex items-center gap-3">
                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                                    {(imagePreview || draft.image) ? (
                                        <img
                                            src={imagePreview || draft.image}
                                            alt=""
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
                                            No photo
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0] || null
                                            setImageFile(file)
                                            setImagePreview(file ? URL.createObjectURL(file) : "")
                                        }}
                                        className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
                                    />
                                    <p className="mt-1 text-[11px] text-gray-500">
                                        Leave this empty and the combo uses the first dish&rsquo;s photo. A picture of
                                        the whole meal sells it better.
                                    </p>
                                    {(imagePreview || draft.image) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setImageFile(null)
                                                setImagePreview("")
                                                setDraft((d) => ({ ...d, image: "" }))
                                            }}
                                            className="mt-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700"
                                        >
                                            Remove photo
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* dish picker */}
                        <div className="space-y-2">
                            <span className="text-xs font-semibold text-gray-700">
                                Dishes in this combo ({draft.rows.filter(isRowFilled).length})
                            </span>

                            {draft.rows.map((row) => {
                                const dish = dishesById.get(row.itemId)
                                const variants = dish?.variants || []
                                const isManual = row.mode === "manual"
                                return (
                                    <div
                                        key={row.localId}
                                        className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-2"
                                    >
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => patchRow(row.localId, { mode: "catalog" })}
                                                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                                    !isManual
                                                        ? "bg-primary-orange text-white"
                                                        : "bg-white text-gray-500 border border-gray-200 hover:text-gray-700"
                                                }`}
                                            >
                                                From your menu
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => patchRow(row.localId, { mode: "manual" })}
                                                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                                    isManual
                                                        ? "bg-primary-orange text-white"
                                                        : "bg-white text-gray-500 border border-gray-200 hover:text-gray-700"
                                                }`}
                                            >
                                                Type manually
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            {isManual ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={row.manualName}
                                                        onChange={(e) =>
                                                            patchRow(row.localId, { manualName: e.target.value })
                                                        }
                                                        placeholder="Item name, e.g. Cold Drink"
                                                        className="min-w-[10rem] flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary-orange"
                                                    />
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={row.manualPrice}
                                                        onChange={(e) =>
                                                            patchRow(row.localId, {
                                                                manualPrice: e.target.value.replace(/[^0-9.]/g, ""),
                                                            })
                                                        }
                                                        placeholder="Price"
                                                        className="w-24 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary-orange"
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    <select
                                                        value={row.itemId}
                                                        onChange={(e) =>
                                                            patchRow(row.localId, {
                                                                itemId: e.target.value,
                                                                variantId: "",
                                                            })
                                                        }
                                                        className="min-w-[10rem] flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary-orange"
                                                    >
                                                        <option value="">Choose a dish...</option>
                                                        {dishes.map((d) => (
                                                            <option key={d.id} value={d.id}>
                                                                {d.name} - {rupees(d.price)}
                                                            </option>
                                                        ))}
                                                    </select>

                                                    {variants.length > 0 && (
                                                        <select
                                                            value={row.variantId}
                                                            onChange={(e) =>
                                                                patchRow(row.localId, { variantId: e.target.value })
                                                            }
                                                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary-orange"
                                                        >
                                                            <option value="">Any size</option>
                                                            {variants.map((v) => (
                                                                <option key={String(v._id)} value={String(v._id)}>
                                                                    {v.name} - {rupees(v.price)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </>
                                            )}

                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={row.quantity}
                                                onChange={(e) =>
                                                    patchRow(row.localId, {
                                                        quantity: e.target.value.replace(/[^0-9]/g, "") || "",
                                                    })
                                                }
                                                className="w-16 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-center outline-none focus:border-primary-orange"
                                                aria-label="Quantity"
                                            />

                                            <span className="w-20 text-right text-sm font-semibold text-gray-700">
                                                {rupees(unitPrice(row) * (Number(row.quantity) || 1))}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setDraft({
                                                        ...draft,
                                                        rows: draft.rows.filter((r) => r.localId !== row.localId),
                                                    })
                                                }
                                                className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                aria-label="Remove dish"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}

                            {draft.rows.length < MAX_COMPONENTS && (
                                <button
                                    type="button"
                                    onClick={() => setDraft({ ...draft, rows: [...draft.rows, emptyRow()] })}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:border-primary-orange hover:text-primary-orange"
                                >
                                    <Plus className="h-4 w-4" />
                                    Add another dish
                                </button>
                            )}
                        </div>

                        {/* price + live saving */}
                        <div className="rounded-xl bg-gray-50 p-3 sm:p-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600">Bought separately</span>
                                <span className="font-semibold text-gray-900">{rupees(componentTotal)}</span>
                            </div>
                            <label className="flex items-center justify-between gap-3 text-sm">
                                <span className="font-semibold text-gray-700">Combo price</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={draft.comboPrice}
                                    onChange={(e) =>
                                        setDraft({ ...draft, comboPrice: e.target.value.replace(/[^0-9.]/g, "") })
                                    }
                                    placeholder="199"
                                    className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-right text-sm font-semibold outline-none focus:border-primary-orange"
                                />
                            </label>
                            {savingAmount > 0 ? (
                                <p className="text-sm font-semibold text-green-700">
                                    Customers save {rupees(savingAmount)} ({savingPercent}%)
                                </p>
                            ) : (
                                <p className="text-xs text-gray-500">
                                    A combo has to be cheaper than its parts, or it is not an offer.
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-1.5 px-6 py-2 rounded-xl text-sm font-semibold text-white bg-primary-orange hover:brightness-95 disabled:opacity-50 transition-all shadow-sm"
                            >
                                <Check className="h-4 w-4" />
                                {saving ? "Saving..." : draft.comboId ? "Save changes" : "Create combo"}
                            </button>
                            <button
                                type="button"
                                onClick={() => openDraft(null)}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
                            >
                                Cancel
                            </button>
                        </div>

                        <p className="text-xs text-gray-500">
                            New and edited combos are reviewed before they appear on the menu, the same as any dish
                            you add.
                        </p>
                    </div>
                )}

                {/* ---------------- existing combos ---------------- */}
                {!loading && !combos.length && !draft && (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
                        <Boxes className="mx-auto h-8 w-8 text-gray-300" />
                        <p className="mt-3 text-sm font-semibold text-gray-900">No combos yet</p>
                        <p className="mt-1 text-xs text-gray-500">
                            Pick two dishes you already sell and offer them together for less.
                        </p>
                        <button
                            type="button"
                            onClick={() => openDraft(emptyDraft())}
                            className="mt-4 inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-primary-orange hover:brightness-95"
                        >
                            <Plus className="h-4 w-4" />
                            Create your first combo
                        </button>
                    </div>
                )}

                {combos.map((combo) => {
                    const parts = combo.comboComponents || []
                    const total = Number(combo.basePrice) || 0
                    const price = Number(combo.price) || 0
                    const save = Math.max(0, total - price)
                    return (
                        <div
                            key={combo._id || combo.id}
                            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-sm font-bold text-gray-900 truncate">{combo.name}</h3>
                                        {combo.approvalStatus !== "approved" && (
                                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                                {combo.approvalStatus === "rejected" ? "Rejected" : "Awaiting approval"}
                                            </span>
                                        )}
                                        {combo.isAvailable === false && (
                                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                                                Off the menu
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500 truncate">
                                        {parts
                                            .map(
                                                (c) =>
                                                    `${c.quantity}x ${c.nameSnapshot}${
                                                        c.variantNameSnapshot ? ` (${c.variantNameSnapshot})` : ""
                                                    }`,
                                            )
                                            .join(" + ")}
                                    </p>
                                    <p className="mt-2 text-sm">
                                        <span className="font-bold text-gray-900">{rupees(price)}</span>
                                        {total > price && (
                                            <>
                                                <span className="ml-2 text-gray-400 line-through">{rupees(total)}</span>
                                                <span className="ml-2 font-semibold text-green-700">
                                                    save {rupees(save)}
                                                </span>
                                            </>
                                        )}
                                    </p>
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => openDraft(draftFromCombo(combo))}
                                        className="rounded-lg p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                                        aria-label="Edit combo"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(combo)}
                                        className="rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                        aria-label="Delete combo"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
