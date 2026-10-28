import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodAddon } from '../models/foodAddon.model.js';

/**
 * Folds a flat add-on list into the grouped, rule-carrying shape the item sheet
 * renders: a heading, a "Select up to N" subtitle, and radio vs checkbox choice.
 *
 * Rules live on each member (see addonGroupSchema), so members of one group could
 * disagree. The lowest sortOrder wins rather than, say, the max — a restaurant
 * lowering maxSelect from 2 to 1 on the first option should take effect, not be
 * silently overridden by a stale sibling.
 */
export function buildAddonGroups(addons = []) {
    const byName = new Map();

    for (const addon of addons) {
        const key = addon.group?.name || '';
        if (!byName.has(key)) {
            byName.set(key, {
                name: key,
                // Ungrouped extras still need a heading in the sheet.
                title: key || 'Add-ons',
                minSelect: Number(addon.group?.minSelect) || 0,
                maxSelect: Number(addon.group?.maxSelect) || 1,
                sortOrder: Number(addon.group?.sortOrder) || 0,
                options: [],
            });
        }
        const group = byName.get(key);
        const order = Number(addon.group?.sortOrder) || 0;
        if (order < group.sortOrder) {
            group.sortOrder = order;
            group.minSelect = Number(addon.group?.minSelect) || 0;
            group.maxSelect = Number(addon.group?.maxSelect) || 1;
        }
        group.options.push(addon);
    }

    return [...byName.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
        .map((g) => ({
            ...g,
            isRequired: g.minSelect > 0,
            // Exactly how Zomato labels it, so the app does not have to reinvent it.
            selectionLabel:
                g.minSelect > 0
                    ? `Required • Select any ${g.minSelect} option${g.minSelect > 1 ? 's' : ''}`
                    : `Select up to ${g.maxSelect} option${g.maxSelect > 1 ? 's' : ''}`,
            /** 'single' => radio buttons, 'multi' => checkboxes. */
            selectionType: g.maxSelect <= 1 ? 'single' : 'multi',
        }));
}

export async function getPublicApprovedRestaurantAddons(restaurantIdOrSlug, { foodId } = {}) {
    const value = String(restaurantIdOrSlug || '').trim();
    if (!value) throw new ValidationError('Restaurant id is required');

    let restaurant = null;
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        restaurant = await FoodRestaurant.findOne({ _id: value, status: 'approved' })
            .select('_id status')
            .lean();
    } else {
        const normalized = value.trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
        restaurant = await FoodRestaurant.findOne({ restaurantNameNormalized: normalized, status: 'approved' })
            .select('_id status')
            .lean();
    }

    if (!restaurant?._id) {
        return null;
    }

    const filter = {
        restaurantId: new mongoose.Types.ObjectId(String(restaurant._id)),
        isDeleted: { $ne: true },
        approvalStatus: 'approved',
        isAvailable: true,
        published: { $ne: null }
    };

    // Per-item lookup. An add-on with an empty foodIds applies to the whole menu
    // (the only behaviour that existed before item linking), so it must still be
    // offered alongside the item-specific ones rather than being filtered out.
    const wanted = String(foodId || '').trim();
    if (wanted) {
        if (!/^[0-9a-fA-F]{24}$/.test(wanted)) {
            throw new ValidationError('Invalid menu item id');
        }
        filter.$or = [
            { foodIds: new mongoose.Types.ObjectId(wanted) },
            { foodIds: { $size: 0 } },
            { foodIds: { $exists: false } }
        ];
    }

    const addons = await FoodAddon.find(filter)
        .sort({ approvedAt: -1, updatedAt: -1 })
        .select('_id published foodIds group')
        .lean();

    const flat = (addons || [])
        .filter((a) => a && a.published)
        .map((a) => {
            const p = a.published;
            return {
                id: a._id,
                _id: a._id,
                name: p.name || '',
                description: p.description || '',
                foodType: p.foodType === 'non-veg' ? 'non-veg' : 'veg',
                isVeg: p.foodType !== 'non-veg',
                price: Number(p.price) || 0,
                image: p.image || '',
                images: Array.isArray(p.images) ? p.images : [],
                // Lets the app group add-ons per item from one unfiltered fetch.
                foodIds: (Array.isArray(a.foodIds) ? a.foodIds : []).map((v) => String(v)),
                appliesToWholeMenu: !Array.isArray(a.foodIds) || a.foodIds.length === 0,
                group: {
                    name: a.group?.name || '',
                    minSelect: Number(a.group?.minSelect) || 0,
                    maxSelect: Number(a.group?.maxSelect) || 1,
                    sortOrder: Number(a.group?.sortOrder) || 0
                }
            };
        });

    // Flat list stays for existing callers; groups is what the item sheet renders.
    return { addons: flat, groups: buildAddonGroups(flat) };
}
