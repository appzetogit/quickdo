import os from 'node:os';
import { logger } from '../../utils/logger.js';

/**
 * The nightly ledger run: project, reconcile, record.
 *
 * Phase 0 moves no read to the ledger. What it has to produce instead is evidence
 * -- fourteen consecutive nights on which the ledger agreed with the authoritative
 * figures -- and evidence nobody schedules is evidence nobody has. This is that
 * schedule.
 *
 * Each night, in order:
 *
 *   1. delivery projection (LEDGER_PROJECTION_ENABLED): project every food and
 *      quick-commerce partner, then reconcile each against riderFinance.
 *   2. taxi mirror (LEDGER_DUAL_WRITE_ENABLED + LEDGER_MIRROR_SINCE): every wallet
 *      transaction in the last two days has its ledger entry. Two days, not since
 *      enabling, so the check stays bounded; each row is covered on two nights.
 *   3. internal consistency, always: every owner's running balance equals the fold
 *      of their entries.
 *
 * A night is clean only if every part that ran is clean. A part that is switched
 * off is reported as skipped, and a night on which NOTHING ran is not clean: a
 * streak built from nights that checked nothing would be a lie.
 *
 * ONCE PER NIGHT ACROSS INSTANCES. The run claims its night by inserting the row;
 * the unique index makes every other instance's insert fail, and they skip. A run
 * that died mid-way (process killed) leaves a 'running' row; after STALE_MS another
 * instance takes it over rather than the night being lost.
 */

export const RUN_AFTER_IST_HOUR = 3;
const STALE_MS = 2 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MIRROR_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
// Rows younger than this may belong to a transaction that has not committed its
// mirror yet; checking them would report a false miss.
const MIRROR_SETTLE_MS = 10 * 60 * 1000;
const MAX_LISTED = 50;

const flag = (name) => String(process.env[name] || '').toLowerCase() === 'true';

/** The IST date a moment falls on. Pure. */
export const nightKey = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Whether tonight's run is due: past the IST hour. Pure. */
export const isDue = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).getUTCHours() >= RUN_AFTER_IST_HOUR;

/**
 * The streak after a night. Pure.
 * Consecutive means consecutive: a missed night (no row for yesterday) resets it,
 * because a night nobody checked is a night that proves nothing.
 */
export const nextStreak = ({ previous, night, clean }) => {
    if (!clean) return 0;
    if (!previous || !previous.clean || previous.status !== 'done') return 1;
    const yesterday = new Date(`${night}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return previous.night === yesterday.toISOString().slice(0, 10) ? (previous.cleanStreak || 0) + 1 : 1;
};

/** Combine the parts into a verdict. Pure. */
export const verdict = (parts) => {
    const ran = Object.values(parts).filter((p) => p && !p.skipped);
    return ran.length > 0 && ran.every((p) => p.clean === true);
};

const claimNight = async (Run, night, now) => {
    try {
        return await Run.create({ night, status: 'running', startedAt: now, host: os.hostname() });
    } catch (err) {
        if (err?.code !== 11000) throw err;
    }
    // Someone holds the night. Take it over only if their run is stale.
    return Run.findOneAndUpdate(
        { night, status: 'running', startedAt: { $lt: new Date(now.getTime() - STALE_MS) } },
        { $set: { startedAt: now, host: os.hostname(), error: 'took over a stale run' } },
        { new: true },
    );
};

const runDeliveryProjection = async () => {
    if (!flag('LEDGER_PROJECTION_ENABLED')) return { skipped: true, reason: 'LEDGER_PROJECTION_ENABLED is off' };

    const projector = await import('./deliveryLedgerProjector.js');
    const { DELIVERY_VERTICALS } = await import('./riderFinance.service.js');
    const out = { clean: true, verticals: {} };

    for (const vertical of DELIVERY_VERTICALS) {
        const totals = await projector.projectVertical({ vertical, commit: true });
        const partners = await projector.listPartnersWithMoney(vertical);
        const disagreeing = [];
        for (const partnerId of partners) {
            const r = await projector.reconcilePartner({ partnerId, vertical });
            if (!r.clean) disagreeing.push(r);
        }
        out.verticals[vertical] = {
            ...totals,
            disagreeing: disagreeing.length,
            examples: disagreeing.slice(0, MAX_LISTED),
        };
        if (totals.failed || disagreeing.length) out.clean = false;
    }
    return out;
};

const runTaxiMirror = async (now) => {
    if (!flag('LEDGER_DUAL_WRITE_ENABLED')) return { skipped: true, reason: 'LEDGER_DUAL_WRITE_ENABLED is off' };
    const enabledAt = new Date(process.env.LEDGER_MIRROR_SINCE || '');
    if (Number.isNaN(enabledAt.getTime())) {
        // Without it, rows from before mirroring began would all read as missing.
        return { skipped: true, reason: 'LEDGER_MIRROR_SINCE is not set to the time mirroring was enabled' };
    }

    const { reconcileTaxiWalletMirror } = await import('./ledgerMirror.js');
    const since = new Date(Math.max(enabledAt.getTime(), now.getTime() - MIRROR_WINDOW_MS));
    const until = new Date(now.getTime() - MIRROR_SETTLE_MS);
    const r = await reconcileTaxiWalletMirror({ since, until, limit: 20000 });
    return {
        clean: r.clean,
        since,
        until,
        checked: r.checked,
        missing: r.missing.length,
        mismatched: r.mismatched.length,
        examples: [...r.missing.map((m) => m.idempotencyKey), ...r.mismatched.map((m) => m.key)].slice(0, MAX_LISTED),
    };
};

const runInternalConsistency = async () => {
    const { reconcileAll } = await import('./ledger.service.js');
    const r = await reconcileAll({ limit: 100000 });
    // An empty ledger is consistent, but it checked nothing: skipped, so that it
    // cannot make a night clean on its own.
    if (r.checked === 0) return { skipped: true, reason: 'ledger is empty' };
    return { clean: r.dirty.length === 0, checked: r.checked, dirty: r.dirty.length, examples: r.dirty.slice(0, MAX_LISTED) };
};

/**
 * Run tonight if due and not already run. Safe to call as often as you like.
 * @returns {Promise<object|null>} the run row, or null if not due / claimed elsewhere
 */
export async function runLedgerNightlyIfDue({ now = new Date(), force = false } = {}) {
    if (!force && !isDue(now)) return null;

    const { LedgerReconcileRun: Run } = await import('./ledgerReconcileRun.model.js');
    const night = nightKey(now);
    const claim = await claimNight(Run, night, now);
    if (!claim) return null;

    const started = Date.now();
    logger.info(`[LedgerNightly] ${night} started on ${os.hostname()}`);

    const parts = {};
    const step = async (name, fn) => {
        try {
            parts[name] = await fn();
        } catch (err) {
            // One part failing is a dirty night, not a lost one: the others still run
            // and are recorded.
            parts[name] = { clean: false, error: err.message };
            logger.error(`[LedgerNightly] ${night} ${name} failed: ${err.message}`);
        }
    };

    await step('deliveryProjection', runDeliveryProjection);
    await step('taxiMirror', () => runTaxiMirror(now));
    await step('internalConsistency', runInternalConsistency);

    const clean = verdict(parts);
    const previous = await Run.findOne({ night: { $lt: night } }).sort({ night: -1 }).lean();
    const cleanStreak = nextStreak({ previous, night, clean });

    const row = await Run.findByIdAndUpdate(
        claim._id,
        {
            $set: {
                status: 'done',
                finishedAt: new Date(),
                clean,
                cleanStreak,
                report: { ...parts, durationMs: Date.now() - started },
            },
        },
        { new: true },
    ).lean();

    const summary = `[LedgerNightly] ${night} ${clean ? 'CLEAN' : 'NOT CLEAN'} -- streak ${cleanStreak}/14`;
    if (clean) logger.info(summary); else logger.error(`${summary} -- see ledger_reconcile_runs`);
    return row;
}

/**
 * Start checking every 15 minutes. Off unless LEDGER_NIGHTLY_ENABLED=true.
 * Returns the interval handle so shutdown can clear it.
 */
export const startLedgerNightly = () => {
    if (!flag('LEDGER_NIGHTLY_ENABLED')) return null;
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            await runLedgerNightlyIfDue();
        } catch (err) {
            logger.error(`[LedgerNightly] tick failed: ${err.message}`);
        } finally {
            busy = false;
        }
    };
    tick();
    logger.info('Ledger nightly reconciliation scheduled (after 03:00 IST, once per night across instances)');
    return setInterval(tick, 15 * 60 * 1000);
};
