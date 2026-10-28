import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@food/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { restaurantAPI } from "@food/api"

const errorText = (error, fallback) =>
  error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback

/**
 * Change the login number: enter the new number, we text it a code, and the
 * code moves the account onto it. Serves restaurants, stores and medical
 * stores alike (the dashboard's requests go to /food or /qc as signed in).
 */
export default function ChangeLoginNumberDialog({ open, onOpenChange, currentPhone, onChanged }) {
  const [step, setStep] = useState("enter")
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [devOtp, setDevOtp] = useState("")
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!open) {
      setStep("enter")
      setPhone("")
      setOtp("")
      setError("")
      setDevOtp("")
      setCooldown(0)
    }
  }, [open])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const sendCode = async (e) => {
    e?.preventDefault()
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter a valid 10-digit mobile number.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await restaurantAPI.requestPhoneChangeOtp(phone)
      const data = res?.data?.data || {}
      setDevOtp(data.otp ? String(data.otp) : "")
      setOtp("")
      setStep("code")
      setCooldown(30)
    } catch (err) {
      setError(errorText(err, "Could not send the code. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    if (otp.trim().length < 4) {
      setError("Enter the code we sent to your new number.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await restaurantAPI.verifyPhoneChange(phone, otp.trim())
      const data = res?.data?.data || {}
      toast.success(`Login number changed to +91 ${data.ownerPhone || phone}`)
      onChanged?.(data.ownerPhone || phone)
      onOpenChange(false)
    } catch (err) {
      setError(errorText(err, "That code did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const field =
    "h-11 w-full rounded-xl border border-gray-300 px-3 text-base outline-none focus:ring-2 focus:ring-gray-900"

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-sm rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-gray-900">Change login number</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-gray-600">
            {step === "enter"
              ? `You sign in with ${currentPhone ? `+91 ${currentPhone}` : "your current number"}. Enter the new number and we'll send it a code.`
              : <>We sent a code to <span className="font-semibold text-gray-900">+91 {phone}</span>.</>}
          </DialogDescription>
        </DialogHeader>

        {step === "enter" ? (
          <form onSubmit={sendCode} className="mt-2 space-y-3" noValidate>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-700">New mobile number</span>
              <div className="flex overflow-hidden rounded-xl border border-gray-300 focus-within:ring-2 focus-within:ring-gray-900">
                <span className="flex items-center bg-gray-50 px-3 text-sm text-gray-500">+91</span>
                <input
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); if (error) setError("") }}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  className="h-11 w-full px-3 text-base outline-none"
                  autoFocus
                />
              </div>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || phone.length !== 10} className="w-full rounded-xl bg-gray-900 font-semibold text-white hover:bg-black">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send code
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-2 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-700">Code</span>
              <input
                value={otp}
                onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); if (error) setError("") }}
                inputMode="numeric"
                autoComplete="one-time-code"
                className={`${field} text-center text-xl tracking-[0.4em]`}
                autoFocus
              />
            </label>
            {devOtp && <p className="text-xs text-gray-400">Test code: {devOtp}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full rounded-xl bg-gray-900 font-semibold text-white hover:bg-black">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify and change
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => { setStep("enter"); setError("") }} disabled={busy} className="font-medium text-gray-700 hover:underline">
                Use a different number
              </button>
              <button type="button" onClick={sendCode} disabled={busy || cooldown > 0} className="text-gray-500 disabled:opacity-60">
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
