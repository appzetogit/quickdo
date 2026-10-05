import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import axios from 'axios';
import { saveImageFromUrl, isHostedUploadUrl } from '../../../../services/storage.service.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { config } from '../../../../config/env.js';
import { resolveSeedRatioForRestaurant } from '../../shared/otherPlatformSeed.service.js';

const PREP_TIME_OPTIONS = [
    '5-10 mins', '10-15 mins', '15-20 mins', '20-25 mins', 
    '25-30 mins', '30-40 mins', '40-50 mins', '50+ mins'
];

/**
 * Generates an Excel template for bulk menu upload.
 */
/**
 * The bulk sheet, pre-filled with the restaurant's current menu.
 *
 * It used to download empty apart from a hardcoded "Paneer Tikka" sample, so
 * editing an existing menu in bulk meant retyping all of it, and anyone who
 * uploaded the sheet as-downloaded created a Paneer Tikka they never asked for.
 *
 * Upload matches rows on { name, restaurantId }, so a downloaded sheet edited
 * and sent back updates those dishes in place rather than duplicating them --
 * which is what makes pre-filling safe as well as useful.
 */
export async function generateBulkMenuTemplate(restaurantId = null) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Menu Template');

    // Define Columns
    sheet.columns = [
        { header: 'Category*', key: 'category', width: 20 },
        { header: 'Item Name*', key: 'name', width: 30 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Base Price*', key: 'price', width: 15 },
        { header: 'Food Type (Veg/Non-Veg)*', key: 'foodType', width: 25 },
        { header: 'Recommended (Yes/No)', key: 'isRecommended', width: 25 },
        { header: 'Preparation Time*', key: 'prepTime', width: 25 },
        { header: 'Image URL', key: 'imageUrl', width: 40 },
        { header: 'Variant 1 Name', key: 'v1Name', width: 20 },
        { header: 'Variant 1 Price', key: 'v1Price', width: 15 },
        { header: 'Variant 2 Name', key: 'v2Name', width: 20 },
        { header: 'Variant 2 Price', key: 'v2Price', width: 15 },
        { header: 'Variant 3 Name', key: 'v3Name', width: 20 },
        { header: 'Variant 3 Price', key: 'v3Price', width: 15 },
        /*
         * Appended, never inserted. The importer reads cells by position, so a
         * new column in the middle would silently misread every sheet a
         * restaurant had already downloaded.
         */
        { header: 'Discount %', key: 'discountPercent', width: 14 },
        { header: 'MRP', key: 'mrp', width: 12 },
        { header: 'Available (Yes/No)', key: 'isAvailable', width: 20 },
        { header: 'Min Order Qty', key: 'minOrderQuantity', width: 16 },
        { header: 'Max Order Qty', key: 'maxOrderQuantity', width: 16 },
        { header: 'Packaging Charge', key: 'packagingCharge', width: 18 },
        { header: 'Approval Status (read-only)', key: 'approvalStatus', width: 26 },
    ];

    // Style headers
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };

    /*
     * Validation is applied AFTER the rows exist.
     *
     * getCell('E2') materialises a row, so validating a fixed 2..501 range
     * before adding the menu pushed every real dish down to row 502 -- a
     * restaurant opened its export, saw five hundred blank rows, and could not
     * find its own menu. Rows first, then validate what is there plus room to
     * add more.
     */
    const applyValidation = (firstRow, lastRow) => {
        for (let i = firstRow; i <= lastRow; i++) {
            sheet.getCell(`E${i}`).dataValidation = {
                type: 'list',
                allowBlank: false,
                formulae: ['"Veg,Non-Veg"']
            };

            sheet.getCell(`F${i}`).dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: ['"Yes,No"']
            };

            sheet.getCell(`Q${i}`).dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: ['"Yes,No"']
            };

            sheet.getCell(`G${i}`).dataValidation = {
                type: 'list',
                allowBlank: false,
                formulae: [`"${PREP_TIME_OPTIONS.join(',')}"`]
            };

            // Prices, and the appended numeric columns.
            const numericCells = [`D${i}`, `J${i}`, `L${i}`, `N${i}`, `P${i}`, `T${i}`];
            numericCells.forEach((cell) => {
                sheet.getCell(cell).dataValidation = {
                    type: 'decimal',
                    operator: 'greaterThanOrEqual',
                    showErrorMessage: true,
                    allowBlank: true,
                    formulae: [0],
                    errorTitle: 'Invalid number',
                    error: 'Must be a number greater than or equal to 0'
                };
            });

            sheet.getCell(`O${i}`).dataValidation = {
                type: 'decimal',
                operator: 'between',
                showErrorMessage: true,
                allowBlank: true,
                formulae: [0, 100],
                errorTitle: 'Invalid discount',
                error: 'Discount must be between 0 and 100'
            };
        }
    };



    // Existing menu first, so the sheet is an editable copy of what is live.
    let existing = [];
    if (restaurantId && mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        existing = await FoodItem.find({ restaurantId: new mongoose.Types.ObjectId(String(restaurantId)) })
            .sort({ categoryName: 1, name: 1 })
            .lean();
    }

    for (const item of existing) {
        // Only the variants the sheet has columns for. A dish with more keeps
        // them in the database; they are simply not editable here.
        const variants = Array.isArray(item.variants) ? item.variants.slice(0, 3) : [];
        sheet.addRow({
            category: item.categoryName || '',
            name: item.name || '',
            description: item.description || '',
            // basePrice is what the admin form calls "Base Price" and what upload
            // writes back; price alone would silently drop any discount.
            price: Number(item.basePrice ?? item.price ?? 0),
            foodType: item.foodType === 'Veg' ? 'Veg' : 'Non-Veg',
            isRecommended: item.isRecommended === true ? 'Yes' : 'No',
            prepTime: item.preparationTime || '',
            imageUrl: item.image || '',
            v1Name: variants[0]?.name || '',
            v1Price: variants[0]?.price ?? '',
            v2Name: variants[1]?.name || '',
            v2Price: variants[1]?.price ?? '',
            v3Name: variants[2]?.name || '',
            v3Price: variants[2]?.price ?? '',
            discountPercent: Number(item.discountPercent ?? 0),
            mrp: item.mrp ?? '',
            isAvailable: item.isAvailable === false ? 'No' : 'Yes',
            minOrderQuantity: item.minOrderQuantity ?? '',
            maxOrderQuantity: item.maxOrderQuantity ?? '',
            packagingCharge: item.packagingCharge?.isEnabled ? (item.packagingCharge?.amount ?? 0) : '',
            // Informational: the importer ignores this column. A restaurant
            // cannot approve its own dishes, and editing it must not look like
            // it might work.
            approvalStatus: item.approvalStatus || '',
        });
    }

    // Spare rows so a restaurant can append new dishes with the dropdowns
    // already working, without burying what it already sells.
    const lastDataRow = Math.max(sheet.rowCount, 1);
    applyValidation(2, lastDataRow + 200);

    /*
     * The worked example gets its own sheet, because the importer only ever reads
     * the first one.
     *
     * It used to sit on the menu sheet whenever the menu was empty -- which is
     * precisely a new restaurant's first download -- so uploading the sheet as
     * downloaded created a "Paneer Tikka" nobody ordered, and the importer then
     * tried to fetch its example.com placeholder and logged a 404. Off the first
     * sheet it stays useful as a reference and can no longer be imported at all.
     */
    const example = workbook.addWorksheet('Example (not imported)');
    example.columns = sheet.columns.map(({ header, key, width }) => ({ header, key, width }));
    example.getRow(1).font = { bold: true };
    example.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };
    example.addRow({
        category: 'Starters',
        name: 'Paneer Tikka',
        description: 'Spicy marinated paneer grilled to perfection',
        price: 250,
        foodType: 'Veg',
        isRecommended: 'Yes',
        prepTime: '20-25 mins',
        imageUrl: 'https://example.com/paneer.jpg',
        v1Name: 'Half',
        v1Price: 150,
        v2Name: 'Full',
        v2Price: 280
    });
    example.addRow({});
    example.getCell(`A${example.rowCount + 1}`).value =
        'Reference only — nothing on this sheet is imported. '
        + 'Copy a row into the "Menu Template" sheet to use it.';

    return workbook;
}

/**
 * ExcelJS reads .xlsx only. Handed a legacy .xls it neither throws nor produces
 * worksheets, so getWorksheet(1) returns undefined and the parse used to die on
 * `sheet.eachRow` sixty lines later as an opaque 500. Name the real problem here.
 */
function describeUnreadableWorkbook(fileBuffer) {
    const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer ?? []);

    // OLE2 compound-file header: the legacy .xls container.
    if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
        return 'This is an old-format .xls file, which cannot be read. Open it in Excel, '
            + 'choose File > Save As > "Excel Workbook (.xlsx)", and upload that instead.';
    }
    // Every .xlsx is a zip, so it must start with "PK".
    if (buf.subarray(0, 2).toString('latin1') !== 'PK') {
        return 'That file is not an .xlsx workbook. Download the template above, fill it in, '
            + 'and upload it without changing the format.';
    }
    // A valid zip that ExcelJS found no sheets in: .ods and other zip-based
    // documents land here, as does an .xlsx saved with every sheet removed.
    return 'This file is not a readable .xlsx workbook — an .ods, or another format renamed '
        + 'to .xls/.xlsx, will do this. Open it in Excel, choose File > Save As > '
        + '"Excel Workbook (.xlsx)", and upload that.';
}

/**
 * Processes the uploaded bulk menu Excel file.
 */
export async function processBulkMenuUpload(restaurantId, fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(fileBuffer);
    } catch {
        // A corrupt or truncated zip throws here; anything else is a bad format.
        throw new ValidationError(describeUnreadableWorkbook(fileBuffer));
    }
    // By position, not getWorksheet(1): that argument is a worksheet *id*, and a
    // workbook whose first sheet carries a different id -- ordinary after sheets
    // have been deleted and the file re-saved -- would come back undefined.
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ValidationError(describeUnreadableWorkbook(fileBuffer));

    const restaurant = await FoodRestaurant.findById(restaurantId).lean();
    if (!restaurant) throw new ValidationError('Restaurant not found');

    const items = [];
    const parsingErrors = [];
    const maxItems = 500;
    let rowCount = 0;

    const getNumericValue = (cell) => {
        if (!cell || cell.value === null || cell.value === undefined) return 0;
        if (typeof cell.value === 'object' && cell.value.result !== undefined) {
            return parseFloat(cell.value.result) || 0;
        }
        return parseFloat(cell.value) || 0;
    };

    const getTextValue = (cell) => {
        if (!cell || cell.value === null || cell.value === undefined) return '';
        
        // Handle Hyperlinks (often how URLs are stored in Excel)
        if (typeof cell.value === 'object') {
            if (cell.value.hyperlink) return String(cell.value.hyperlink).trim();
            if (cell.value.text) return String(cell.value.text).trim();
        }
        
        // Handle Rich Text
        if (cell.value.richText) {
            return cell.value.richText.map(rt => rt.text).join('').trim();
        }
        
        // Handle Formula Result
        if (typeof cell.value === 'object' && cell.value.result !== undefined) {
            return String(cell.value.result).trim();
        }
        
        // Handle Shared Strings / Plain Values
        return String(cell.value).trim();
    };

    /** null for a blank cell, so the caller can tell "unset" from "zero". */
    const getOptionalNumber = (cell) => {
        const raw = cell?.value;
        if (raw === null || raw === undefined || String(raw).trim() === '') return null;
        const n = Number(String(raw).trim());
        return Number.isFinite(n) && n >= 0 ? n : null;
    };

    /** true/false for yes/no, null for anything else including blank. */
    const getOptionalYesNo = (cell) => {
        const raw = String(cell?.value ?? '').trim().toLowerCase();
        if (raw === 'yes' || raw === 'y' || raw === 'true') return true;
        if (raw === 'no' || raw === 'n' || raw === 'false') return false;
        return null;
    };

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip Header
        if (rowCount >= maxItems) return;

        try {
            const data = {
                category: getTextValue(row.getCell(1)),
                name: getTextValue(row.getCell(2)),
                description: getTextValue(row.getCell(3)),
                price: getNumericValue(row.getCell(4)),
                foodType: getTextValue(row.getCell(5)),
                isRecommended: String(row.getCell(6).value || '').toLowerCase() === 'yes',
                prepTime: getTextValue(row.getCell(7)),
                imageUrl: getTextValue(row.getCell(8)),
                // Columns 15+. Blank means "leave whatever is stored alone",
                // which is why these stay null rather than defaulting to 0 --
                // a blank cell on an older sheet must not zero a live discount.
                discountPercent: getOptionalNumber(row.getCell(15)),
                mrp: getOptionalNumber(row.getCell(16)),
                isAvailable: getOptionalYesNo(row.getCell(17)),
                minOrderQuantity: getOptionalNumber(row.getCell(18)),
                maxOrderQuantity: getOptionalNumber(row.getCell(19)),
                packagingCharge: getOptionalNumber(row.getCell(20)),
                // Column 21 (approval status) is deliberately not read.
                variants: []
            };

            // Mandatory Field Check
            if (!data.category || !data.name) {
                // Only report as error if row is not completely empty
                const hasAnyData = row.values.some(v => v !== null && v !== undefined && v !== '');
                if (hasAnyData) {
                    parsingErrors.push({ row: rowNumber, error: 'Category and Item Name are mandatory' });
                }
                return;
            }

            rowCount++;

            // Parse Variants (Columns 9 to 14)
            for (let j = 0; j < 3; j++) {
                const vName = getTextValue(row.getCell(9 + j * 2));
                const vPrice = getNumericValue(row.getCell(10 + j * 2));
                if (vName && vPrice > 0) {
                    data.variants.push({ name: vName, price: vPrice });
                }
            }

            items.push({ data, rowNumber });
        } catch (err) {
            parsingErrors.push({ row: rowNumber, error: `Parsing error: ${err.message}` });
        }
    });

    if (items.length === 0 && parsingErrors.length === 0) {
        throw new ValidationError('No valid items found in the Excel sheet');
    }

    const results = {
        success: 0,
        failed: 0,
        details: [...parsingErrors]
    };

    // --- OPTIMIZATION: Resolve All Categories First ---
    const categoryCache = new Map();
    const uniqueCategoryNames = [...new Set(items.map(it => it.data.category))];
    
    for (const catName of uniqueCategoryNames) {
        const normalized = catName.trim();
        let cat = await FoodCategory.findOne({
            name: { $regex: new RegExp(`^${escapeRegExp(normalized)}$`, 'i') },
            $or: [{ restaurantId: null }, { restaurantId: restaurant._id }]
        });

        if (!cat) {
            cat = await FoodCategory.create({
                name: normalized,
                restaurantId: restaurant._id,
                createdByRestaurantId: restaurant._id,
                approvalStatus: 'approved',
                zoneId: restaurant.zoneId,
                isActive: true
            });
        }
        categoryCache.set(normalized.toLowerCase(), cat);
    }

    // --- OPTIMIZATION: Batch process items with concurrency ---
    const CONCURRENCY = 10;
    const itemChunks = [];
    for (let i = 0; i < items.length; i += CONCURRENCY) {
        itemChunks.push(items.slice(i, i + CONCURRENCY));
    }

    const bulkOps = [];

    /*
     * The comparison figure new dishes start from, resolved once for the whole
     * upload.
     *
     * A global price adjustment writes the stored otherPrice on the dishes that
     * exist when it runs, so a menu uploaded afterwards carried nothing and fell
     * back to the blanket markup -- a restaurant onboarding today advertised a
     * smaller saving than every established one, and no past adjustment reached
     * it. A bulk upload is the usual way a new restaurant's whole menu arrives,
     * which made it the widest version of that gap.
     *
     * A ratio rather than a price, because each row multiplies its own. 0 means
     * there is nothing to go on, and the seeding stage is then left out
     * entirely rather than writing a figure nobody derived.
     */
    const seedRatio = await resolveSeedRatioForRestaurant(restaurant._id);

    for (const chunk of itemChunks) {
        const chunkPromises = chunk.map(async (item) => {
            try {
                const { data, rowNumber } = item;

                // 1. Get Pre-Resolved Category
                const category = categoryCache.get(data.category.toLowerCase());
                if (!category) throw new Error(`Category ${data.category} could not be resolved`);

                // 2. Handle Image Parallel Upload
                let finalImageUrl = '';
                if (data.imageUrl) {
                    const trimmedUrl = data.imageUrl.trim();
                    // Already on our own storage: keep it as-is. This used to
                    // spare Cloudinary URLs the same way, but that account is
                    // disabled, so re-hosting them is now the correct move.
                    if (isHostedUploadUrl(trimmedUrl)) {
                        finalImageUrl = trimmedUrl;
                    } else if (trimmedUrl.startsWith('http') || trimmedUrl.startsWith('//')) {
                        try {
                            const urlToUpload = trimmedUrl.startsWith('//') ? `https:${trimmedUrl}` : trimmedUrl;
                            const stored = await saveImageFromUrl(
                                urlToUpload,
                                `restaurants/${restaurantId}/food`
                            );
                            finalImageUrl = stored.url;
                        } catch (imgErr) {
                            console.error(`Row ${rowNumber}: Image upload failed [${trimmedUrl}]:`, imgErr.message);
                        }
                    }
                }

                // 3. Prepare Bulk Operation
                /*
                 * An aggregation-pipeline update rather than a plain $set, so a
                 * value can be derived from what is already stored.
                 *
                 * Two things this fixes. Column D is labelled "Base Price" and
                 * the export writes basePrice into it, but the import used to
                 * write it to `price` and never touch basePrice -- so a dish at
                 * base 250 less 20% (selling for 200) came back charging 250,
                 * the discount silently destroyed on a round trip the sheet
                 * itself invites. And a blank cell in one of the new columns has
                 * to mean "leave this alone", which $set cannot express.
                 */
                const wantsDiscount = data.discountPercent !== null;
                const setStage = {
                    categoryId: category._id,
                    categoryName: category.name,
                    description: data.description,
                    variants: data.variants,
                    ...(finalImageUrl && { image: finalImageUrl }),
                    foodType: data.foodType === 'Veg' ? 'Veg' : 'Non-Veg',
                    isRecommended: data.isRecommended,
                    preparationTime: data.prepTime,
                    approvalStatus: 'pending',
                    requestedAt: '$$NOW',
                    rejectionReason: '',
                    approvedAt: null,
                    rejectedAt: null,

                    // The sheet's "Base Price" is the base, not the selling price.
                    basePrice: data.price,
                    ...(wantsDiscount && { discountPercent: data.discountPercent }),
                    ...(data.mrp !== null && { mrp: data.mrp }),
                    ...(data.isAvailable !== null && { isAvailable: data.isAvailable }),
                    ...(data.minOrderQuantity !== null && { minOrderQuantity: data.minOrderQuantity }),
                    ...(data.maxOrderQuantity !== null && { maxOrderQuantity: data.maxOrderQuantity }),
                    ...(data.packagingCharge !== null && {
                        packagingCharge: {
                            isEnabled: data.packagingCharge > 0,
                            amount: data.packagingCharge,
                        },
                    }),
                };

                // Selling price, derived after the base and discount have landed.
                // Sold by variants: the cheapest size, as everywhere else.
                const priceStage = data.variants.length > 0
                    ? { price: Math.min(...data.variants.map((v) => v.price)) }
                    : {
                        price: {
                            $round: [
                                {
                                    $multiply: [
                                        '$basePrice',
                                        { $subtract: [1, { $divide: [{ $ifNull: ['$discountPercent', 0] }, 100] }] },
                                    ],
                                },
                                2,
                            ],
                        },
                    };

                /*
                 * Seed the comparison figure from the resolved ratio, but only
                 * where the dish does not already carry one -- this write is an
                 * upsert, so it also lands on dishes that already exist, and
                 * overwriting their figure would undo whatever an adjustment or
                 * the admin had set. Runs after priceStage because it multiplies
                 * the price that stage has just computed.
                 */
                const seedStages = seedRatio > 1
                    ? [{
                        $set: {
                            otherPrice: {
                                $cond: [
                                    { $gt: [{ $ifNull: ['$otherPrice', 0] }, 0] },
                                    '$otherPrice',
                                    { $round: [{ $multiply: ['$price', seedRatio] }, 2] },
                                ],
                            },
                        },
                    }]
                    : [];

                bulkOps.push({
                    updateOne: {
                        filter: { name: data.name, restaurantId: restaurant._id },
                        update: [{ $set: setStage }, { $set: priceStage }, ...seedStages],
                        upsert: true
                    }
                });

                results.success++;
            } catch (err) {
                results.failed++;
                results.details.push({ row: item.rowNumber, error: err.message });
            }
        });

        await Promise.all(chunkPromises);
    }

    // --- OPTIMIZATION: Execute Bulk Write ---
    if (bulkOps.length > 0) {
        try {
            await FoodItem.bulkWrite(bulkOps);
        } catch (bulkErr) {
            console.error('Bulk write failed:', bulkErr.message);
            results.details.push({ row: 'N/A', error: `Database saving failed: ${bulkErr.message}` });
        }
    }

    if (results.success > 0) {
        try {
            // The whole menu clear. `restaurant_menu:<id>` could never match a
            // key -- they are prefix:METHOD:url -- so this cleared nothing and a
            // bulk upload's prices reached customers only once the cache expired.
            const { invalidateMenuCaches } = await import('../../../../middleware/cache.js');
            await invalidateMenuCaches();
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after bulk upload:', cacheErr);
        }
    }

    return results;
}

/**
 * Escapes characters for use in a regular expression.
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
