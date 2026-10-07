import mongoose from 'mongoose';

/**
 * What the nightly insights job computed (core/analytics/insights.service.js).
 *
 *   kind 'forecast'  vertical + zoneId ('all' or a zone): daily orders / revenue
 *                    history and the next 14 days
 *   kind 'together'  vertical + key = item id: items often bought with it
 *   kind 'popular'   vertical + key = grid cell ('all' for the whole vertical):
 *                    the most ordered items and sellers around there
 *   kind 'demand'    vertical + zoneId: expected orders per hour of the week
 *
 * Each run writes a fresh set under its runId, then removes the older ones, so a
 * reader never sees half a run.
 */
const insightSchema = new mongoose.Schema(
    {
        kind: { type: String, enum: ['forecast', 'together', 'popular', 'demand'], required: true },
        vertical: { type: String, required: true },
        zoneId: { type: String, default: 'all' },
        key: { type: String, default: '' },
        runId: { type: String, required: true },
        data: { type: mongoose.Schema.Types.Mixed, default: {} },
        computedAt: { type: Date, default: Date.now },
    },
    { collection: 'platform_insights', minimize: false },
);
insightSchema.index({ kind: 1, vertical: 1, zoneId: 1, key: 1 });
insightSchema.index({ runId: 1 });

const runSchema = new mongoose.Schema(
    {
        night: { type: String, required: true, unique: true }, // 'YYYY-MM-DD' (India), or 'manual-<ts>'
        status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
        startedAt: { type: Date, default: Date.now },
        finishedAt: { type: Date, default: null },
        host: { type: String, default: '' },
        summary: { type: mongoose.Schema.Types.Mixed, default: {} },
        error: { type: String, default: '' },
    },
    { collection: 'platform_insight_runs' },
);

export const PlatformInsight = mongoose.models.PlatformInsight || mongoose.model('PlatformInsight', insightSchema);
export const PlatformInsightRun = mongoose.models.PlatformInsightRun || mongoose.model('PlatformInsightRun', runSchema);
