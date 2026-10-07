import ExcelJS from 'exceljs';
import { processBulkMenuUpload } from './bulkUpload.service.js';
import { logger } from '../../../../utils/logger.js';

/**
 * The optional "add your first items / upload your menu sheet" step at the end
 * of restaurant onboarding (SOW plan 6.6).
 *
 * Both routes go through the existing bulk importer (processBulkMenuUpload,
 * the code behind POST /restaurant/bulk-upload), so a dish created during
 * onboarding is created exactly as one uploaded later from the menu screen:
 * same validation, same categories, same approval queue. Typed items are
 * written into a sheet in the template's column order and imported as one.
 *
 * Runs after the restaurant document exists. A bad sheet never fails the
 * registration -- the restaurant is told what was imported and what was not,
 * and can fix the rest from the menu screen once approved.
 */

export const MAX_FIRST_ITEMS = 25;
const DEFAULT_PREP_TIME = '15-20 mins';

/** Parse and bound the typed items. Returns { items, errors }. */
export function normalizeFirstItems(raw) {
    let list = raw;
    if (typeof raw === 'string') {
        if (!raw.trim()) return { items: [], errors: [] };
        try {
            list = JSON.parse(raw);
        } catch {
            return { items: [], errors: [{ row: 'firstItems', error: 'Items could not be read' }] };
        }
    }
    if (!Array.isArray(list)) return { items: [], errors: [] };
    const items = [];
    const errors = [];
    list.slice(0, MAX_FIRST_ITEMS).forEach((it, i) => {
        const name = String(it?.name || '').trim().slice(0, 120);
        const price = Number(it?.price);
        if (!name && !it?.price) return;
        if (!name) { errors.push({ row: i + 1, error: 'Item name is required' }); return; }
        if (!Number.isFinite(price) || price <= 0) { errors.push({ row: i + 1, error: `"${name}": enter a price above 0` }); return; }
        const foodType = /non/i.test(String(it?.foodType || '')) ? 'Non-Veg' : 'Veg';
        items.push({
            category: String(it?.category || '').trim().slice(0, 60) || 'Menu',
            name,
            description: String(it?.description || '').trim().slice(0, 500),
            price: Math.round(price * 100) / 100,
            foodType,
            prepTime: String(it?.prepTime || '').trim() || DEFAULT_PREP_TIME,
        });
    });
    if (Array.isArray(list) && list.length > MAX_FIRST_ITEMS) {
        errors.push({ row: 'firstItems', error: `Only the first ${MAX_FIRST_ITEMS} items were added; upload a menu sheet for more` });
    }
    return { items, errors };
}

/** An .xlsx the bulk importer reads: columns 1-7 of the bulk template. */
export async function firstItemsWorkbook(items) {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Menu Template');
    sheet.addRow(['Category*', 'Item Name*', 'Description', 'Base Price*', 'Food Type (Veg/Non-Veg)*', 'Recommended (Yes/No)', 'Preparation Time*']);
    for (const it of items) {
        sheet.addRow([it.category, it.name, it.description, it.price, it.foodType, 'No', it.prepTime]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Import whatever the onboarding form sent. Never throws.
 *
 * @returns {Promise<null | { sheet?, firstItems? }>} null when nothing was sent
 */
export async function importOnboardingMenu(restaurantId, { menuSheet, firstItems } = {}) {
    const out = {};
    if (menuSheet?.buffer?.length) {
        try {
            out.sheet = await processBulkMenuUpload(restaurantId, menuSheet.buffer);
        } catch (err) {
            out.sheet = { success: 0, failed: 0, error: err.message || 'The menu sheet could not be imported' };
        }
    }
    const { items, errors } = normalizeFirstItems(firstItems);
    if (items.length || errors.length) {
        if (!items.length) {
            out.firstItems = { success: 0, failed: errors.length, details: errors };
        } else {
            try {
                const res = await processBulkMenuUpload(restaurantId, await firstItemsWorkbook(items));
                out.firstItems = { ...res, failed: (res.failed || 0) + errors.length, details: [...(res.details || []), ...errors] };
            } catch (err) {
                out.firstItems = { success: 0, failed: items.length, error: err.message || 'Items could not be added' };
            }
        }
    }
    if (!out.sheet && !out.firstItems) return null;
    logger.info(`[ONBOARDING] menu import for ${restaurantId}: sheet=${out.sheet?.success ?? '-'} items=${out.firstItems?.success ?? '-'}`);
    return out;
}
