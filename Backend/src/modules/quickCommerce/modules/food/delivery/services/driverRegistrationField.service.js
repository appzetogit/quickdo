import mongoose from 'mongoose';
import { FoodDriverRegistrationField } from '../models/driverRegistrationField.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const FIELD_TYPES = ['text', 'number', 'email', 'phone', 'date', 'select', 'document'];
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;

const clean = (v) => String(v ?? '').trim();

const serialize = (doc) => {
    const f = doc?.toObject ? doc.toObject() : doc;
    return {
        id: String(f._id),
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
        page: f.page,
        order: f.order,
        options: f.options || [],
        placeholder: f.placeholder || '',
        helpText: f.helpText || '',
        regex: f.regex || '',
        minLength: f.minLength ?? null,
        maxLength: f.maxLength ?? null,
        isSystem: !!f.isSystem,
        isActive: !!f.isActive
    };
};

// ───────────────────────── Admin CRUD ─────────────────────────

export async function listFields() {
    const docs = await FoodDriverRegistrationField.find({})
        .sort({ page: 1, order: 1, createdAt: 1 })
        .lean();
    return { fields: docs.map(serialize) };
}

export async function createField(body = {}) {
    const key = clean(body.key);
    if (!KEY_RE.test(key)) {
        throw new ValidationError('key must start with a letter and contain only letters, numbers, underscore');
    }
    const type = FIELD_TYPES.includes(body.type) ? body.type : 'text';
    const label = clean(body.label);
    if (!label) throw new ValidationError('label is required');

    const exists = await FoodDriverRegistrationField.findOne({ key }).lean();
    if (exists) throw new ValidationError('A field with this key already exists');

    const doc = await FoodDriverRegistrationField.create({
        key,
        label,
        type,
        required: body.required === true || body.required === 'true',
        page: Math.max(1, parseInt(body.page, 10) || 1),
        order: parseInt(body.order, 10) || 0,
        options: Array.isArray(body.options) ? body.options.map(clean).filter(Boolean) : [],
        placeholder: clean(body.placeholder),
        helpText: clean(body.helpText),
        regex: clean(body.regex),
        minLength: body.minLength != null && body.minLength !== '' ? Number(body.minLength) : null,
        maxLength: body.maxLength != null && body.maxLength !== '' ? Number(body.maxLength) : null,
        isActive: body.isActive !== false && body.isActive !== 'false'
    });
    return serialize(doc);
}

export async function updateField(id, body = {}) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ValidationError('Invalid field id');
    const doc = await FoodDriverRegistrationField.findById(id);
    if (!doc) throw new ValidationError('Field not found');

    // key is immutable — app answers are stored under it.
    if (body.label !== undefined) doc.label = clean(body.label) || doc.label;
    if (body.type !== undefined && FIELD_TYPES.includes(body.type)) doc.type = body.type;
    if (body.required !== undefined) doc.required = body.required === true || body.required === 'true';
    if (body.page !== undefined) doc.page = Math.max(1, parseInt(body.page, 10) || 1);
    if (body.order !== undefined) doc.order = parseInt(body.order, 10) || 0;
    if (body.options !== undefined) doc.options = Array.isArray(body.options) ? body.options.map(clean).filter(Boolean) : [];
    if (body.placeholder !== undefined) doc.placeholder = clean(body.placeholder);
    if (body.helpText !== undefined) doc.helpText = clean(body.helpText);
    if (body.regex !== undefined) doc.regex = clean(body.regex);
    if (body.minLength !== undefined) doc.minLength = body.minLength === '' || body.minLength == null ? null : Number(body.minLength);
    if (body.maxLength !== undefined) doc.maxLength = body.maxLength === '' || body.maxLength == null ? null : Number(body.maxLength);
    if (body.isActive !== undefined) doc.isActive = body.isActive === true || body.isActive === 'true';

    await doc.save();
    return serialize(doc);
}

export async function deleteField(id) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ValidationError('Invalid field id');
    const doc = await FoodDriverRegistrationField.findById(id).lean();
    if (!doc) throw new ValidationError('Field not found');
    if (doc.isSystem) throw new ValidationError('System fields cannot be deleted; deactivate instead');
    await FoodDriverRegistrationField.deleteOne({ _id: id });
    return { deleted: true, id: String(id) };
}

// ───────────────────────── Public (app) ─────────────────────────

/** Active fields grouped by page — what the Flutter form renders. */
export async function getPublicFormSchema() {
    const docs = await FoodDriverRegistrationField.find({ isActive: true })
        .sort({ page: 1, order: 1, createdAt: 1 })
        .lean();

    const byPage = new Map();
    for (const d of docs) {
        const p = d.page || 1;
        if (!byPage.has(p)) byPage.set(p, []);
        byPage.get(p).push(serialize(d));
    }
    const pages = [...byPage.keys()].sort((a, b) => a - b).map((page) => ({
        page,
        fields: byPage.get(page)
    }));

    return { totalPages: pages.length, pages, fields: docs.map(serialize) };
}

// ─────────────── Registration: validate + collect answers ───────────────

/**
 * Validate the dynamic (admin-defined) answers against the active schema.
 * Returns { customFields, requiredDocumentKeys } — the caller uploads the
 * document files and merges the resulting URLs into customDocuments.
 * @param body    the registration request body (contains non-file answers)
 * @param fileKeys Set of fieldnames present in the uploaded files
 */
export async function collectDynamicRegistration(body = {}, fileKeys = new Set()) {
    const fields = await FoodDriverRegistrationField.find({ isActive: true }).lean();
    const customFields = {};
    const requiredDocumentKeys = [];

    for (const f of fields) {
        if (f.type === 'document') {
            if (f.required && !fileKeys.has(f.key)) {
                throw new ValidationError(`${f.label} document is required`);
            }
            if (fileKeys.has(f.key)) requiredDocumentKeys.push(f.key);
            continue;
        }

        const raw = body[f.key];
        const val = raw == null ? '' : String(raw).trim();

        if (f.required && !val) throw new ValidationError(`${f.label} is required`);
        if (!val) continue;

        if (f.minLength != null && val.length < f.minLength) {
            throw new ValidationError(`${f.label} must be at least ${f.minLength} characters`);
        }
        if (f.maxLength != null && val.length > f.maxLength) {
            throw new ValidationError(`${f.label} must be at most ${f.maxLength} characters`);
        }
        if (f.type === 'select' && Array.isArray(f.options) && f.options.length && !f.options.includes(val)) {
            throw new ValidationError(`${f.label} must be one of: ${f.options.join(', ')}`);
        }
        if (f.regex) {
            try {
                if (!new RegExp(f.regex).test(val)) throw new ValidationError(`${f.label} is invalid`);
            } catch (e) {
                if (e instanceof ValidationError) throw e;
                // ignore a malformed admin regex rather than blocking registration
            }
        }
        customFields[f.key] = val;
    }

    // keys of all document fields the app may send (so caller knows which files to upload)
    const allDocumentKeys = fields.filter((f) => f.type === 'document').map((f) => f.key);
    return { customFields, documentKeys: allDocumentKeys };
}
