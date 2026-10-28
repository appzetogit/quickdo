/*
 * Google Places: run the old (legacy) Places classes on the new Places API.
 *
 * The Maps key's Google project has the new Places API but not the legacy
 * one, and Google no longer lets new projects turn the legacy one on. Every
 * place search in the app (customer address, taxi pickup, admin zone and
 * restaurant forms) was written against the legacy classes, which now answer
 * "This page can't load Google Maps correctly" the moment someone types.
 *
 * Rather than rewrite those screens, this replaces the three legacy classes
 * they use with versions that call the new API underneath and hand back the
 * legacy shapes:
 *   - places.Autocomplete       (the dropdown on an <input>, and the
 *                                @react-google-maps <Autocomplete> built on it)
 *   - places.AutocompleteService.getPlacePredictions
 *   - places.PlacesService.getDetails (other methods go to the original)
 *
 * The maps script can arrive through any of the app's loaders, at any time, so
 * the replacement is installed by watching for `google.maps.places` to be
 * assigned rather than by calling into each loader.
 */

const DETAIL_FIELDS = ["id", "displayName", "formattedAddress", "location", "viewport", "addressComponents", "types"]
const DEBOUNCE_MS = 220

const placesLibrary = async () => {
  const g = window.google
  if (g?.maps?.importLibrary) return g.maps.importLibrary("places")
  return g?.maps?.places
}

/** A new-API Place as the legacy PlaceResult the screens read. */
function toLegacyPlace(place) {
  if (!place) return null
  const name = typeof place.displayName === "string" ? place.displayName : place.displayName?.text || ""
  return {
    place_id: place.id,
    name,
    formatted_address: place.formattedAddress || name,
    geometry: place.location ? { location: place.location, viewport: place.viewport || undefined } : undefined,
    address_components: (place.addressComponents || []).map((c) => ({
      long_name: c.longText,
      short_name: c.shortText,
      types: c.types || [],
    })),
    types: place.types || [],
  }
}

async function fetchDetails(placeId, sessionToken) {
  const lib = await placesLibrary()
  const place = new lib.Place({ id: placeId })
  await place.fetchFields({ fields: DETAIL_FIELDS, ...(sessionToken ? { sessionToken } : {}) })
  return toLegacyPlace(place)
}

const regionCodes = (restrictions) => {
  const raw = restrictions?.country
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => String(c).toLowerCase()).filter(Boolean)
  return list.length ? list : undefined
}

/** Legacy request options to a new-API AutocompleteRequest. */
function toRequest(input, opts = {}) {
  const req = { input }
  const codes = regionCodes(opts.componentRestrictions)
  if (codes) req.includedRegionCodes = codes.slice(0, 15)
  if (opts.sessionToken) req.sessionToken = opts.sessionToken
  if (opts.bounds) {
    req.locationBias = opts.bounds
  } else if (opts.location) {
    const radius = Math.min(Number(opts.radius) || 50000, 50000)
    req.locationBias = { center: opts.location, radius }
  }
  // Legacy type collections ('geocode', '(cities)'...) have no direct
  // equivalent; '(cities)' is the one that changes what people get.
  const types = Array.isArray(opts.types) ? opts.types : []
  if (types.includes("(cities)")) req.includedPrimaryTypes = ["locality", "administrative_area_level_3"]
  return req
}

async function fetchPredictions(input, opts) {
  const lib = await placesLibrary()
  const { suggestions = [] } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(toRequest(input, opts))
  return suggestions
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      description: p.text?.text || "",
      place_id: p.placeId,
      structured_formatting: {
        main_text: p.mainText?.text || p.text?.text || "",
        secondary_text: p.secondaryText?.text || "",
        main_text_matched_substrings: [],
      },
      matched_substrings: [],
      terms: [],
      types: p.types || [],
    }))
}

function makeAutocompleteService(Original, Status) {
  return class AutocompleteServiceCompat {
    getPlacePredictions(request = {}, callback) {
      const run = fetchPredictions(String(request.input || ""), request)
      if (typeof callback === "function") {
        run
          .then((list) => callback(list.length ? list : null, list.length ? Status.OK : Status.ZERO_RESULTS))
          .catch(() => callback(null, Status.UNKNOWN_ERROR))
        return undefined
      }
      return run.then((predictions) => ({ predictions }))
    }

    getQueryPredictions(request, callback) {
      return this.getPlacePredictions(request, callback)
    }
  }
}

function makePlacesService(Original, Status) {
  return class PlacesServiceCompat {
    constructor(container) {
      this._container = container
      this._original = null
    }

    _orig() {
      if (!this._original) this._original = new Original(this._container)
      return this._original
    }

    getDetails(request = {}, callback) {
      fetchDetails(request.placeId, request.sessionToken)
        .then((place) => callback?.(place, place ? Status.OK : Status.NOT_FOUND))
        .catch(() => callback?.(null, Status.UNKNOWN_ERROR))
    }

    textSearch(...args) { return this._orig().textSearch(...args) }
    nearbySearch(...args) { return this._orig().nearbySearch(...args) }
    findPlaceFromQuery(...args) { return this._orig().findPlaceFromQuery(...args) }
    findPlaceFromPhoneNumber(...args) { return this._orig().findPlaceFromPhoneNumber(...args) }
  }
}

/** The dropdown widget, drawn here since the legacy one is what fails. */
function makeAutocomplete(maps) {
  return class AutocompleteCompat extends maps.MVCObject {
    constructor(input, opts = {}) {
      super()
      this._input = input
      this._opts = { ...opts }
      this._place = null
      this._items = []
      this._active = -1
      this._timer = null
      this._seq = 0
      this._token = null
      this._box = document.createElement("div")
      this._box.className = "pac-container pac-logo"
      Object.assign(this._box.style, {
        position: "fixed",
        zIndex: "2147483000",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
        overflow: "hidden",
        display: "none",
        fontFamily: "inherit",
        fontSize: "14px",
      })
      document.body.appendChild(this._box)
      this._onInput = () => this._schedule()
      this._onKey = (e) => this._key(e)
      this._onBlur = () => setTimeout(() => this._hide(), 150)
      this._onReflow = () => this._position()
      input.setAttribute("autocomplete", "off")
      input.addEventListener("input", this._onInput)
      input.addEventListener("keydown", this._onKey)
      input.addEventListener("blur", this._onBlur)
    }

    getPlace() { return this._place }
    getBounds() { return this._opts.bounds }
    getFields() { return this._opts.fields }
    setOptions(opts = {}) { this._opts = { ...this._opts, ...opts } }
    setFields(fields) { this._opts.fields = fields }
    setBounds(bounds) { this._opts.bounds = bounds }
    setTypes(types) { this._opts.types = types }
    setComponentRestrictions(r) { this._opts.componentRestrictions = r }

    _schedule() {
      clearTimeout(this._timer)
      const text = this._input.value.trim()
      if (text.length < 2) return this._hide()
      this._timer = setTimeout(() => this._search(text), DEBOUNCE_MS)
    }

    async _search(text) {
      const seq = ++this._seq
      try {
        const lib = await placesLibrary()
        if (!this._token) this._token = new lib.AutocompleteSessionToken()
        const list = await fetchPredictions(text, { ...this._opts, sessionToken: this._token })
        if (seq !== this._seq || document.activeElement !== this._input) return
        this._render(list)
      } catch {
        this._hide()
      }
    }

    _render(list) {
      this._items = list
      this._active = -1
      this._box.innerHTML = ""
      if (!list.length) return this._hide()
      list.forEach((p, i) => {
        const row = document.createElement("div")
        row.className = "pac-item"
        Object.assign(row.style, { padding: "9px 12px", cursor: "pointer", lineHeight: "1.3", borderTop: i ? "1px solid #f1f5f9" : "0" })
        const main = document.createElement("div")
        main.textContent = p.structured_formatting.main_text
        main.style.fontWeight = "600"
        main.style.color = "#111827"
        const sub = document.createElement("div")
        sub.textContent = p.structured_formatting.secondary_text
        sub.style.color = "#6b7280"
        sub.style.fontSize = "12px"
        row.append(main, sub)
        row.addEventListener("mousedown", (e) => {
          e.preventDefault()
          this._choose(i)
        })
        row.addEventListener("mouseenter", () => this._highlight(i))
        this._box.appendChild(row)
      })
      this._box.style.display = "block"
      this._position()
      window.addEventListener("scroll", this._onReflow, true)
      window.addEventListener("resize", this._onReflow)
    }

    _position() {
      const r = this._input.getBoundingClientRect()
      Object.assign(this._box.style, { left: `${r.left}px`, top: `${r.bottom + 4}px`, width: `${r.width}px` })
    }

    _highlight(i) {
      this._active = i
      Array.from(this._box.children).forEach((el, j) => {
        el.style.background = j === i ? "#f3f4f6" : "#fff"
      })
    }

    _hide() {
      this._box.style.display = "none"
      window.removeEventListener("scroll", this._onReflow, true)
      window.removeEventListener("resize", this._onReflow)
    }

    _key(e) {
      if (this._box.style.display === "none") return
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const n = this._items.length
        this._highlight((this._active + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
      } else if (e.key === "Enter") {
        e.preventDefault()
        this._choose(this._active >= 0 ? this._active : 0)
      } else if (e.key === "Escape") {
        this._hide()
      }
    }

    async _choose(i) {
      const p = this._items[i]
      this._hide()
      if (!p) return
      this._input.value = p.description
      try {
        this._place = await fetchDetails(p.place_id, this._token)
      } catch {
        this._place = { name: p.description }
      }
      this._token = null // a session ends with the details call
      maps.event.trigger(this, "place_changed")
    }
  }
}

const STATUS_FALLBACK = { OK: "OK", ZERO_RESULTS: "ZERO_RESULTS", NOT_FOUND: "NOT_FOUND", UNKNOWN_ERROR: "UNKNOWN_ERROR" }

const MAKERS = {
  Autocomplete: (Original, maps) => makeAutocomplete(maps),
  AutocompleteService: (Original, maps, Status) => makeAutocompleteService(Original, Status),
  PlacesService: (Original, maps, Status) => makePlacesService(Original, Status),
}

/** Replace one legacy class, once. */
function replace(places, key) {
  const maps = window.google?.maps
  const Original = places?.[key]
  if (!Original || Original.__qdCompat || !maps?.MVCObject) return false
  try {
    const Compat = MAKERS[key](Original, maps, places.PlacesServiceStatus || STATUS_FALLBACK)
    Compat.__qdCompat = true
    places[key] = Compat
    return places[key] === Compat
  } catch {
    // Read-only namespace in some future Maps version: leave the original.
    return false
  }
}

const allReplaced = (places) => Object.keys(MAKERS).every((k) => places?.[k]?.__qdCompat)

/**
 * Call `onValue` with obj[key] as soon as it exists, now or when it is first
 * assigned.
 */
function whenAssigned(obj, key, onValue) {
  if (obj[key]) return onValue(obj[key])
  const desc = Object.getOwnPropertyDescriptor(obj, key)
  if (desc && !desc.configurable) return undefined
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get() { return undefined },
    set(value) {
      Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: true })
      if (value) onValue(value)
    },
  })
  return undefined
}

export function installPlacesCompat() {
  if (typeof window === "undefined") return
  try {
    whenAssigned(window, "google", (g) =>
      whenAssigned(g, "maps", (m) =>
        whenAssigned(m, "places", (p) => {
          for (const key of Object.keys(MAKERS)) whenAssigned(p, key, () => replace(p, key))
        }),
      ),
    )
  } catch {
    // Never let this stop the app from starting.
  }
  // Backup for a Maps build that defines these without a plain assignment,
  // which the watch above cannot see: check briefly, then stop.
  let tries = 0
  const timer = setInterval(() => {
    const places = window.google?.maps?.places
    if (!places) return // maps not loaded yet: keep waiting, it loads on demand
    tries += 1
    for (const key of Object.keys(MAKERS)) replace(places, key)
    if (allReplaced(places) || tries > 600) clearInterval(timer)
  }, 100)
}
