import mongoose from 'mongoose';
import { Faq, FAQ_VERTICALS } from './faq.model.js';
import { ValidationError, NotFoundError } from '../auth/errors.js';

/** Aliases the apps already use for their vertical. */
const ALIASES = { quick: 'quickCommerce', qc: 'quickCommerce', sp: 'serviceProvider', services: 'serviceProvider', rides: 'taxi' };
export const normalizeFaqVertical = (v) => {
    const raw = String(v || '').trim();
    const mapped = ALIASES[raw.toLowerCase()] || raw;
    return FAQ_VERTICALS.includes(mapped) ? mapped : null;
};

/**
 * What a customer sees: the active questions for one vertical, plus the
 * general ones (unless `includeGeneral=false`), grouped by category, in the
 * admin's order.
 */
export async function listPublicFaqs({ vertical, category, includeGeneral = true } = {}) {
    const v = vertical ? normalizeFaqVertical(vertical) : null;
    if (vertical && !v) throw new ValidationError('Unknown vertical');
    const q = { isActive: true };
    if (v) q.vertical = includeGeneral && v !== 'general' ? { $in: [v, 'general'] } : v;
    if (category) q.category = String(category);
    const rows = await Faq.find(q)
        .sort({ vertical: 1, category: 1, sortOrder: 1, createdAt: 1 })
        .select('vertical category question answer sortOrder')
        .lean();
    const groups = new Map();
    for (const r of rows) {
        const key = r.category || 'General';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id: String(r._id), vertical: r.vertical, question: r.question, answer: r.answer, sortOrder: r.sortOrder });
    }
    return {
        vertical: v,
        faqs: rows.map((r) => ({ id: String(r._id), vertical: r.vertical, category: r.category, question: r.question, answer: r.answer, sortOrder: r.sortOrder })),
        categories: [...groups.entries()].map(([name, items]) => ({ name, items })),
    };
}

function pick(body = {}, { partial = false } = {}) {
    const out = {};
    if (body.vertical !== undefined || !partial) {
        const v = normalizeFaqVertical(body.vertical ?? 'general');
        if (!v) throw new ValidationError(`vertical must be one of ${FAQ_VERTICALS.join(', ')}`);
        out.vertical = v;
    }
    for (const k of ['category', 'question', 'answer']) {
        if (body[k] !== undefined) out[k] = String(body[k]).trim();
    }
    if (!partial) {
        if (!out.question) throw new ValidationError('question is required');
        if (!out.answer) throw new ValidationError('answer is required');
    }
    if (body.sortOrder !== undefined) {
        const n = Number(body.sortOrder);
        if (!Number.isFinite(n)) throw new ValidationError('sortOrder must be a number');
        out.sortOrder = n;
    }
    if (body.isActive !== undefined) out.isActive = body.isActive === true || body.isActive === 'true';
    return out;
}

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

export async function listFaqsAdmin({ vertical, category, q } = {}) {
    const filter = {};
    if (vertical) {
        const v = normalizeFaqVertical(vertical);
        if (v) filter.vertical = v;
    }
    if (category) filter.category = String(category);
    if (q) {
        const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ question: rx }, { answer: rx }];
    }
    return Faq.find(filter).sort({ vertical: 1, category: 1, sortOrder: 1, createdAt: 1 }).lean();
}

export async function createFaqAdmin(body, adminId) {
    const data = pick(body);
    if (data.sortOrder === undefined) {
        const last = await Faq.findOne({ vertical: data.vertical, category: data.category || 'General' }).sort({ sortOrder: -1 }).select('sortOrder').lean();
        data.sortOrder = (Number(last?.sortOrder) || 0) + 1;
    }
    return (await Faq.create({ ...data, updatedBy: isId(adminId) ? adminId : null })).toObject();
}

export async function updateFaqAdmin(id, body, adminId) {
    if (!isId(id)) throw new NotFoundError('FAQ not found');
    const data = pick(body, { partial: true });
    const doc = await Faq.findByIdAndUpdate(id, { $set: { ...data, updatedBy: isId(adminId) ? adminId : null } }, { new: true, runValidators: true }).lean();
    if (!doc) throw new NotFoundError('FAQ not found');
    return doc;
}

export async function deleteFaqAdmin(id) {
    if (!isId(id)) throw new NotFoundError('FAQ not found');
    const r = await Faq.deleteOne({ _id: id });
    if (!r.deletedCount) throw new NotFoundError('FAQ not found');
    return { deleted: true };
}

/** Save a new order: [{ id, sortOrder }]. */
export async function reorderFaqsAdmin(items = []) {
    if (!Array.isArray(items)) throw new ValidationError('items must be a list');
    const ops = items
        .filter((i) => isId(i?.id) && Number.isFinite(Number(i?.sortOrder)))
        .map((i) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(String(i.id)) }, update: { $set: { sortOrder: Number(i.sortOrder) } } } }));
    if (ops.length) await Faq.bulkWrite(ops);
    return { updated: ops.length };
}
