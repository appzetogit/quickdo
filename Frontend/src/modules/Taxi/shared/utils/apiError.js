/**
 * Turn a rejected admin API call into something the admin can act on.
 *
 * The axios layer in shared/api/axiosInstance.js rejects with
 * `{ ...responseBody, status }`, so the server's own message and the HTTP status
 * are both already present. Screens were routinely throwing that away -- either
 * printing a fixed sentence, or catching the error and saying nothing at all.
 *
 * The case that motivated this: saving a taxi zone with an expired session
 * answered "Error connecting to server." The request had reached the server and
 * been answered correctly (401, Authorization token has expired), so the one
 * thing the admin needed to know -- sign in again -- was the one thing the
 * screen did not say. Silent catches were worse still: delete and toggle buttons
 * simply did nothing, which is indistinguishable from a broken button.
 *
 * The server's own wording is nearly always better than anything generic, so it
 * wins whenever there is one. `fallback` is only for the case where there is not.
 */
export const describeApiError = (err, fallback = 'Something went wrong. Please try again.') => {
    const status = err?.status ?? err?.response?.status;
    const message = String(
        err?.message
        || err?.response?.data?.message
        || '',
    ).trim();

    // An expired session is by far the most common failure on a long-lived admin
    // tab, and the least self-explanatory, so it gets its own wording.
    if (status === 401 || /token has expired|token is invalid|token is required|jwt expired/i.test(message)) {
        return 'Your session has expired. Please sign in again, then retry.';
    }
    if (status === 403) {
        return 'You do not have permission to do that.';
    }
    // The interceptor uses this exact string when the request never landed.
    if (message === 'Network error or server down.') {
        return 'Could not reach the server. Check your connection and try again.';
    }

    return message || fallback;
};

export default describeApiError;
