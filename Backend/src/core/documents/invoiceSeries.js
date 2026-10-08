import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { istParts } from './period.js';
import { logger } from '../../utils/logger.js';

/**
 * Sequential document numbers (GST invoices first), shared by every vertical.
 *
 * A GST tax invoice needs a consecutive serial number, unique for the
 * financial year (April to March, Indian time), within one series. Each seller
 * is its own series -- a restaurant's invoices count 1, 2, 3 ... whatever other
 * restaurants do -- so `series` is a free-form key such as `food:<restaurantId>`.
 *
 *   financialYearOf(date)          -> { label: '2026-27', short: '2627', startYear: 2026 }
 *   nextInSeries(series, { at })   -> { seq, fy }   atomic counter, one per series per FY
 *   formatDocumentNumber(fmt, ...) -> 'R7F3A/2627/00045' (GST: <= 16 chars)
 *   assignDocumentNumber({...})    -> number stored on the document, once
 *
 * The counter is one MongoDB document per (series, FY), bumped with `$inc`, so
 * two deliveries finishing in the same millisecond still get different numbers.
 * Assignment is idempotent: a document that already carries a number keeps it,
 * and concurrent assigners for the SAME document are serialised by a short
 * claim, so a retry never burns a second number (which would leave a gap).
 *
 * Quick commerce and service providers can reuse this as is: add
 * `documentNumberFields()` to their schema under a path of their choosing and
 * call `assignDocumentNumber` from their completion step.
 */

const counterSchema = new mongoose.Schema(
    {
        series: { type: String, required: true, trim: true },
        fy: { type: String, required: true, trim: true },
        seq: { type: Number, default: 0, min: 0 },
    },
    { collection: 'document_counters', timestamps: true },
);
counterSchema.index({ series: 1, fy: 1 }, { unique: true });

export const DocumentCounter = mongoose.models.DocumentCounter
    || mongoose.model('DocumentCounter', counterSchema);

/** The schema fields a numbered document carries (add under e.g. `invoice`). */
export function documentNumberFields() {
    return new mongoose.Schema(
        {
            number: { type: String, default: '', trim: true },
            series: { type: String, default: '', trim: true },
            fy: { type: String, default: '', trim: true },
            seq: { type: Number, default: null },
            issuedAt: { type: Date, default: null },
            /** Set when the document becomes due (e.g. on delivery); a number follows. */
            due: { type: Boolean, default: false },
            /** Internal: the assigner currently holding the right to number it. */
            claim: { type: String, default: '' },
            claimedAt: { type: Date, default: null },
        },
        { _id: false },
    );
}

/** The Indian financial year (1 April - 31 March, IST) an instant falls in. */
export function financialYearOf(at = new Date()) {
    const { y, m } = istParts(at);
    const startYear = m >= 3 ? y : y - 1;
    const end2 = String((startYear + 1) % 100).padStart(2, '0');
    return {
        startYear,
        label: `${startYear}-${end2}`,
        short: `${String(startYear % 100).padStart(2, '0')}${end2}`,
    };
}

/** Take the next number in a series for the financial year `at` falls in. */
export async function nextInSeries(series, { at = new Date() } = {}) {
    const key = String(series || '').trim();
    if (!key) throw new Error('nextInSeries: series is required');
    const fy = financialYearOf(at);
    // The unique (series, fy) index is what makes the first-ever upserts safe;
    // init() resolves once it exists (a no-op after the first call).
    await DocumentCounter.init();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const row = await DocumentCounter.findOneAndUpdate(
                { series: key, fy: fy.label },
                { $inc: { seq: 1 } },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            ).lean();
            return { seq: row.seq, fy };
        } catch (err) {
            // Two first-ever upserts for the same series raced on the unique
            // index; the loser simply increments the row the winner created.
            if (err?.code !== 11000) throw err;
        }
    }
    throw new Error(`nextInSeries: could not take a number in ${key}`);
}

/**
 * GST-compliant by default (CGST rule 46(b)): at most 16 characters, only
 * letters, digits, '/' and '-'. E.g. R7F3A/2627/00045.
 */
export const DEFAULT_DOCUMENT_NUMBER_FORMAT = '{prefix}/{fyShort}/{seq:5}';
export const GST_INVOICE_NUMBER_MAX = 16;

/** True for a number GST accepts as an invoice serial. */
export function isGstCompliantNumber(number) {
    const s = String(number || '');
    return s.length > 0 && s.length <= GST_INVOICE_NUMBER_MAX && /^[A-Za-z0-9/-]+$/.test(s);
}

/**
 * Fill a format. Tokens: {prefix}, {fy} (2026-27), {fyShort} (2627),
 * {fyStart} (2026), {seq} or {seq:N} (zero-padded to N digits).
 * A format without {seq} would repeat numbers, so {seq} is appended.
 */
export function formatDocumentNumber(format, { prefix = '', fy, seq }) {
    let fmt = String(format || '').trim() || DEFAULT_DOCUMENT_NUMBER_FORMAT;
    if (!/\{seq(?::\d{1,2})?\}/.test(fmt)) fmt += '/{seq:5}';
    const year = fy && typeof fy === 'object' ? fy : financialYearOf(new Date());
    return fmt
        .replace(/\{prefix\}/g, String(prefix || ''))
        .replace(/\{fyShort\}/g, year.short)
        .replace(/\{fyStart\}/g, String(year.startYear))
        .replace(/\{fy\}/g, year.label)
        .replace(/\{seq(?::(\d{1,2}))?\}/g, (_, width) => String(seq).padStart(Number(width) || 0, '0'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLAIM_STALE_MS = 30 * 1000;

/**
 * Give a document its number, once.
 *
 * @param {object} opts
 * @param {mongoose.Model} opts.Model  the document's model
 * @param {*} opts.id                  the document's _id
 * @param {string} opts.series         the counter series (one per seller)
 * @param {string} [opts.prefix]       printed in place of {prefix}
 * @param {string} [opts.format]       see formatDocumentNumber
 * @param {Date}   [opts.at]           the document date; picks the financial year
 * @param {string} [opts.field]        where the fields live on the document (default 'invoice')
 * @returns {Promise<{number: string, seq: number, fy: string, assigned: boolean} | null>}
 *          `assigned` is false when the document already had its number.
 *          null only if another assigner holds the claim and has not finished.
 */
export async function assignDocumentNumber({
    Model, id, series, prefix = '', format, at = new Date(), field = 'invoice',
    // When given, a number that is not GST-compliant (see isGstCompliantNumber)
    // is not used: a warning is logged and this { prefix, format } is used
    // instead, so a bad admin setting cannot produce an invalid invoice.
    gstFallback = null,
}) {
    const f = (k) => `${field}.${k}`;
    const existing = async () => {
        const doc = await Model.findById(id).select(field).lean();
        const cur = doc?.[field];
        return cur?.number ? { number: cur.number, seq: cur.seq, fy: cur.fy, assigned: false } : null;
    };
    const already = await existing();
    if (already) return already;

    const now = new Date();
    const token = crypto.randomBytes(8).toString('hex');
    const claimed = await Model.findOneAndUpdate(
        {
            _id: id,
            [f('number')]: { $in: [null, ''] },
            $or: [
                { [f('claim')]: { $in: [null, ''] } },
                { [f('claimedAt')]: { $lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
            ],
        },
        { $set: { [f('claim')]: token, [f('claimedAt')]: now } },
        { new: true },
    ).select(field).lean();

    if (!claimed) {
        // Someone else is numbering it right now: wait for their answer.
        for (let i = 0; i < 20; i += 1) {
            await sleep(50);
            const done = await existing();
            if (done) return done;
        }
        return null;
    }

    const { seq, fy } = await nextInSeries(series, { at });
    let number = formatDocumentNumber(format, { prefix, fy, seq });
    if (gstFallback && !isGstCompliantNumber(number)) {
        const fallback = formatDocumentNumber(gstFallback.format || DEFAULT_DOCUMENT_NUMBER_FORMAT, { prefix: gstFallback.prefix || '', fy, seq });
        logger.warn(`Document number "${number}" (series ${series}) is not GST-compliant (max ${GST_INVOICE_NUMBER_MAX} chars, letters/digits/'/'/'-'); using "${fallback}" instead. Check invoice.numberFormat / invoice.prefix.`);
        number = fallback;
    }
    const res = await Model.updateOne(
        { _id: id, [f('claim')]: token },
        {
            $set: {
                [f('number')]: number,
                [f('series')]: String(series),
                [f('fy')]: fy.label,
                [f('seq')]: seq,
                [f('issuedAt')]: at,
                [f('claim')]: '',
            },
        },
    );
    if (res.modifiedCount !== 1) {
        // The claim went stale and someone else finished first: theirs stands.
        return existing();
    }
    return { number, seq, fy: fy.label, assigned: true };
}
