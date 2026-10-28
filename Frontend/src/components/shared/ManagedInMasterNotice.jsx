/**
 * Shown on an older per-service settings screen whose values are now set once
 * for the whole platform in Master Settings (/admin/master/settings).
 */
export default function ManagedInMasterNotice({ what }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <b>{what}</b> is now set once for every service in{" "}
      <a href="/admin/master/settings" className="font-semibold underline">
        Master Settings
      </a>
      . Anything saved there is what every app uses.
    </div>
  )
}
