import { useCallback, useEffect, useMemo, useState } from "react"
import { appServicesAPI } from "@food/api"
import { Switch } from "@food/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@food/components/ui/card"
import { toast } from "sonner"
import { Loader2, MapPin, Search, AlertTriangle } from "lucide-react"

/**
 * Which services the customer app shows, everywhere or zone by zone.
 *
 * One switch per service for the whole platform, and one per zone beneath it.
 * "Off everywhere" wins over any zone, so a zone switch is greyed out while its
 * service is off -- showing it as live would invite someone to flip it and
 * wonder why nothing changed.
 *
 * Lives under /admin/master like Platform Settings: it covers every vertical,
 * so it is one screen, not one per panel.
 */

const whenLabel = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

function ServiceCard({ service, busyKey, onToggleService, onToggleZone }) {
  const [query, setQuery] = useState("")
  const zones = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? service.zones.filter((z) => z.name.toLowerCase().includes(q)) : service.zones
  }, [service.zones, query])

  const hiddenZones = service.zones.filter((z) => !z.enabled).length
  const serviceBusy = busyKey === service.key

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">{service.label}</CardTitle>
            <CardDescription>
              {service.enabled
                ? hiddenZones > 0
                  ? `Shown in the app, except in ${hiddenZones} zone${hiddenZones === 1 ? "" : "s"}.`
                  : "Shown in the app everywhere."
                : "Hidden from the app everywhere."}
              {service.updatedAt && ` Last changed ${whenLabel(service.updatedAt)}.`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {serviceBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <span className={`text-sm font-medium ${service.enabled ? "text-emerald-700" : "text-muted-foreground"}`}>
              {service.enabled ? "On" : "Off"}
            </span>
            <Switch
              checked={service.enabled}
              disabled={serviceBusy}
              onCheckedChange={(checked) => onToggleService(service, checked)}
              aria-label={`Show ${service.label} in the app`}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {service.zonesError && (
          <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {service.zonesError}
          </p>
        )}

        {service.zones.length > 6 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${service.label} zones`}
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            />
          </div>
        )}

        {service.zones.length === 0 && !service.zonesError && (
          <p className="text-sm text-muted-foreground">
            No {service.label} zones drawn yet. The switch above still applies everywhere.
          </p>
        )}

        {zones.length > 0 && (
          <ul className="divide-y rounded-md border">
            {zones.map((zone) => {
              const zoneKey = `${service.key}:${zone.id}`
              const busy = busyKey === zoneKey
              return (
                <li
                  key={zone.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${service.enabled ? "" : "opacity-60"}`}
                >
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{zone.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {!zone.zoneActive && "Zone is inactive in zone setup · "}
                      {zone.enabled ? "Shown here" : "Hidden here"}
                      {zone.updatedAt && ` · changed ${whenLabel(zone.updatedAt)}`}
                    </div>
                  </div>
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Switch
                    checked={zone.enabled}
                    disabled={busy || !service.enabled}
                    onCheckedChange={(checked) => onToggleZone(service, zone, checked)}
                    aria-label={`Show ${service.label} in ${zone.name}`}
                  />
                </li>
              )
            })}
          </ul>
        )}
        {service.zones.length > 0 && zones.length === 0 && (
          <p className="text-sm text-muted-foreground">No zones match that search.</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function AppServices() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState("")

  const apply = (res) => {
    const list = res?.data?.data?.services || res?.data?.services || []
    setServices(Array.isArray(list) ? list : [])
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      apply(await appServicesAPI.getAdminView())
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load app services.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleService = async (service, enabled) => {
    setBusyKey(service.key)
    try {
      apply(await appServicesAPI.setService(service.key, enabled))
      toast.success(`${service.label} is now ${enabled ? "shown" : "hidden"} in the app everywhere.`)
    } catch (error) {
      toast.error(error?.response?.data?.message || `Could not change ${service.label}.`)
    } finally {
      setBusyKey("")
    }
  }

  const toggleZone = async (service, zone, enabled) => {
    setBusyKey(`${service.key}:${zone.id}`)
    try {
      apply(await appServicesAPI.setZone(service.key, zone.id, enabled))
      toast.success(`${service.label} is now ${enabled ? "shown" : "hidden"} in ${zone.name}.`)
    } catch (error) {
      toast.error(error?.response?.data?.message || `Could not change ${service.label} in ${zone.name}.`)
    } finally {
      setBusyKey("")
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">App services</h1>
        <p className="text-muted-foreground max-w-3xl">
          Choose which services customers see in the app. Turn a service off everywhere, or only in some zones.
          Customers in a zone where a service is off do not see its tab. Each service uses its own zones from its
          zone setup. Changes reach the app within about a minute.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading services
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {services.map((service) => (
            <ServiceCard
              key={service.key}
              service={service}
              busyKey={busyKey}
              onToggleService={toggleService}
              onToggleZone={toggleZone}
            />
          ))}
        </div>
      )}
    </div>
  )
}
