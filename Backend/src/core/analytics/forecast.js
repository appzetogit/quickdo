/**
 * Daily forecasting for the Insights page. No external model: additive
 * Holt-Winters (level + trend + weekly season) over the daily history, with its
 * three smoothing constants picked by a small grid search on one-step-ahead error.
 * Short histories fall back to a seasonal moving average (the same weekday over
 * the last few weeks), and very short ones to a plain mean.
 *
 * Pure functions: no database, no clock. The nightly job (insights.service.js)
 * feeds them and stores the result.
 */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** One Holt-Winters pass. Returns fitted one-step-ahead values and the final state. */
export function holtWinters(series, { season = 7, alpha, beta, gamma }) {
    const n = series.length;
    const s1 = series.slice(0, season);
    const s2 = series.slice(season, 2 * season);
    let level = mean(s1);
    let trend = s2.length === season ? (mean(s2) - mean(s1)) / season : 0;
    const seasonal = s1.map((x) => x - level);
    const fitted = new Array(n).fill(null);
    let sse = 0;
    let count = 0;
    for (let t = season; t < n; t += 1) {
        const s = seasonal[t % season];
        const predicted = level + trend + s;
        fitted[t] = predicted;
        const err = series[t] - predicted;
        sse += err * err;
        count += 1;
        const prevLevel = level;
        level = alpha * (series[t] - s) + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
        seasonal[t % season] = gamma * (series[t] - level) + (1 - gamma) * s;
    }
    return { fitted, level, trend, seasonal, sse, count, n };
}

const GRID = [0.05, 0.2, 0.4, 0.6, 0.8];
const TREND_GRID = [0, 0.05, 0.2];

/**
 * Forecast `horizon` steps after `series` (oldest first).
 * @returns {{ forecast: number[], low: number[], high: number[], method: string, rmse: number, mape: number|null, params?: object }}
 */
export function forecastSeries(series, { season = 7, horizon = 14 } = {}) {
    const xs = (Array.isArray(series) ? series : []).map((v) => Math.max(0, Number(v) || 0));
    const n = xs.length;
    const clamp = (v) => Math.max(0, v);

    if (n >= 2 * season + 2) {
        let best = null;
        for (const alpha of GRID) {
            for (const beta of TREND_GRID) {
                for (const gamma of GRID) {
                    const r = holtWinters(xs, { season, alpha, beta, gamma });
                    if (!best || r.sse < best.r.sse) best = { r, params: { alpha, beta, gamma } };
                }
            }
        }
        const { r, params } = best;
        // Damp the trend over the horizon so a few busy days do not run away.
        const forecast = [];
        let damp = 0;
        for (let h = 1; h <= horizon; h += 1) {
            damp += 0.9 ** h;
            forecast.push(clamp(r.level + damp * r.trend + r.seasonal[(n + h - 1) % season]));
        }
        const rmse = r.count ? Math.sqrt(r.sse / r.count) : 0;
        const errs = [];
        for (let t = season; t < n; t += 1) if (xs[t] > 0 && r.fitted[t] !== null) errs.push(Math.abs(xs[t] - r.fitted[t]) / xs[t]);
        return {
            forecast: forecast.map(round2),
            low: forecast.map((v) => round2(clamp(v - 1.96 * rmse))),
            high: forecast.map((v) => round2(v + 1.96 * rmse)),
            method: 'holt_winters',
            rmse: round2(rmse),
            mape: errs.length ? round2(mean(errs) * 100) : null,
            params,
        };
    }

    if (n >= season) {
        // Seasonal moving average: each future day is the mean of the same weekday
        // in the last (up to) four weeks.
        const forecast = [];
        for (let h = 1; h <= horizon; h += 1) {
            const same = [];
            for (let k = n + h - 1 - season; k >= 0 && same.length < 4; k -= season) if (k < n) same.push(xs[k]);
            forecast.push(mean(same));
        }
        const resid = [];
        for (let t = season; t < n; t += 1) resid.push(xs[t] - xs[t - season]);
        const rmse = resid.length ? Math.sqrt(mean(resid.map((e) => e * e))) : 0;
        return {
            forecast: forecast.map(round2),
            low: forecast.map((v) => round2(clamp(v - 1.96 * rmse))),
            high: forecast.map((v) => round2(v + 1.96 * rmse)),
            method: 'seasonal_average',
            rmse: round2(rmse),
            mape: null,
        };
    }

    const m = mean(xs);
    return {
        forecast: new Array(horizon).fill(round2(m)),
        low: new Array(horizon).fill(0),
        high: new Array(horizon).fill(round2(m * 2)),
        method: n ? 'mean' : 'none',
        rmse: 0,
        mape: null,
    };
}

/**
 * Expected count per hour of the week (0 = Sunday 00:00 .. 167), from per-week
 * hourly counts. `weeks` is how many weeks the counts cover; `recentFactor`
 * scales for the recent trend (recent weekly volume / long-run weekly volume),
 * bounded so one odd week cannot double the plan.
 */
export function hourOfWeekProfile(counts, weeks, recentFactor = 1) {
    const w = Math.max(1, Number(weeks) || 1);
    const f = Math.min(1.5, Math.max(0.5, Number(recentFactor) || 1));
    const out = new Array(168).fill(0);
    for (let i = 0; i < 168; i += 1) out[i] = round2(((Number(counts[i]) || 0) / w) * f);
    return out;
}
