/**
 * Save a file the server generated (axios `responseType: "blob"`).
 *
 * The filename comes from Content-Disposition when the server sent one, so the
 * name a restaurant sees matches the period it asked for.
 */
export function filenameFromResponse(res, fallback) {
  const header = res?.headers?.["content-disposition"] || res?.headers?.get?.("content-disposition") || ""
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  return match ? decodeURIComponent(match[1]) : fallback
}

export function saveBlobResponse(res, fallbackName = "download") {
  const blob = res?.data instanceof Blob ? res.data : new Blob([res?.data ?? ""])
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filenameFromResponse(res, fallbackName)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The server's JSON error message, even when the request asked for a blob. */
export async function blobErrorMessage(err, fallback = "Download failed") {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      return parsed?.message || parsed?.error || fallback
    } catch {
      return fallback
    }
  }
  return data?.message || data?.error || err?.message || fallback
}

/** YYYY-MM-DD for a local date (the server reads it as an IST day). */
export function isoDay(date) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
