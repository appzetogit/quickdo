import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid menu item id');

/** Empty/omitted = the add-on applies to the whole menu, as before this field existed. */
const foodIdsSchema = z.array(objectId).max(200).optional();

/** Presentation/selection rules for the Zomato-style grouped item sheet. */
const groupSchema = z
    .object({
        name: z.string().max(120).optional().default(''),
        minSelect: z.coerce.number().int().min(0).max(20).optional().default(0),
        maxSelect: z.coerce.number().int().min(1).max(20).optional().default(1),
        sortOrder: z.coerce.number().int().min(0).max(999).optional().default(0)
    })
    .refine((g) => g.maxSelect >= g.minSelect, {
        message: 'maxSelect must be greater than or equal to minSelect'
    })
    .optional();

/** The moderated content: what admin approves. Excludes foodIds by design. */
const addonContentSchema = z.object({
    name: z.string().min(1, 'Add-on name is required').max(200),
    description: z.string().max(2000).optional().default(''),
    foodType: z.enum(['veg', 'non-veg']).optional().default('veg'),
    price: z.coerce.number().min(0, 'Price must be >= 0'),
    image: z.string().max(2000).optional().default(''),
    images: z.array(z.string().max(2000)).max(10).optional().default([])
});

/** Create takes a flat body, so foodIds rides along with the content here. */
const addonPayloadSchema = addonContentSchema.extend({
    foodIds: foodIdsSchema,
    group: groupSchema
});

const listSchema = z.object({
    foodId: objectId.optional(),
    includeDeleted: z.coerce.boolean().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().max(80).optional()
});

const updateSchema = z.object({
    draft: addonContentSchema.partial().optional(),
    isAvailable: z.boolean().optional(),
    // Top-level: re-linking an add-on to menu items does not need re-approval.
    foodIds: foodIdsSchema,
    group: groupSchema
});

export const validateAddonListQuery = (query) => {
    const result = listSchema.safeParse(query);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0]?.message || 'Invalid query');
    }
    return result.data;
};

export const validateAddonCreateDto = (body) => {
    const result = addonPayloadSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0]?.message || 'Invalid add-on data');
    }
    const d = result.data;
    const images = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    const image = d.image || images[0] || '';
    return { ...d, images, image };
};

export const validateAddonUpdateDto = (body) => {
    const result = updateSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0]?.message || 'Invalid add-on data');
    }
    const d = result.data;
    let draft = d.draft;
    if (draft) {
        const images = Array.isArray(draft.images) ? draft.images.filter(Boolean) : undefined;
        const image = draft.image !== undefined ? draft.image : (images && images[0]) ? images[0] : undefined;
        draft = { ...draft, ...(images !== undefined ? { images } : {}), ...(image !== undefined ? { image } : {}) };
    }
    return { ...d, ...(draft ? { draft } : {}) };
};
