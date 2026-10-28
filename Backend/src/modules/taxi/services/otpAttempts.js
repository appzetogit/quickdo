import { ApiError } from '../../../utils/ApiError.js';

/**
 * Wrong OTP guesses per code. The taxi codes are 4 digits and a wrong guess
 * used to cost nothing, so all 10,000 could be tried inside the 10-minute
 * window (behind only the per-IP limiter, which rotating IPs walks past).
 * After MAX_ATTEMPTS the code is thrown away and a new one has to be requested.
 *
 * Counted on the raw collection so it works for every session model without a
 * schema change.
 */
export const MAX_OTP_ATTEMPTS = 5;

/**
 * `onLimit: 'delete'` removes the session (login: just ask for a new code).
 * `onLimit: 'expire'` keeps it but kills the code, for sessions that hold
 * other progress (driver onboarding keeps the form filled so far).
 */
export async function rejectWrongOtp(session, { onLimit = 'delete' } = {}) {
  const Model = session?.constructor;
  if (Model?.collection && session?._id) {
    const res = await Model.collection.findOneAndUpdate(
      { _id: session._id },
      { $inc: { otpAttempts: 1 } },
      { returnDocument: 'after' },
    );
    const doc = res?.value ?? res;
    const attempts = Number(doc?.otpAttempts || 0);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      if (onLimit === 'expire') {
        await Model.collection.updateOne(
          { _id: session._id },
          { $set: { otpExpiresAt: new Date(0), otpAttempts: 0 } },
        );
      } else {
        await Model.collection.deleteOne({ _id: session._id });
      }
      throw new ApiError(429, 'Too many wrong codes. Please request a new OTP.');
    }
    const left = MAX_OTP_ATTEMPTS - attempts;
    throw new ApiError(401, `Invalid OTP. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
  }
  throw new ApiError(401, 'Invalid OTP');
}

/** A fresh code gets a fresh count. Call after issuing a new OTP. */
export async function resetOtpAttempts(session) {
  const Model = session?.constructor;
  if (Model?.collection && session?._id) {
    await Model.collection.updateOne({ _id: session._id }, { $set: { otpAttempts: 0 } });
  }
}
