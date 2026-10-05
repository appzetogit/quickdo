/**
 * Vertical vocabulary: the words a shared screen should use in each vertical.
 *
 * The quick-commerce admin renders the same screens as the food admin, pointed at
 * /v1/qc instead of /v1/food. Those screens are written in food's language -- "Food",
 * "Restaurant" -- in a vertical that sells groceries through sellers.
 *
 * This module is the single source of truth for that mapping. It is used two ways:
 *
 *   translate()   - for chrome a component renders itself (menu labels, page titles,
 *                   table headers). Preferred: it is explicit, it happens in React,
 *                   and it cannot touch data.
 *   the DOM shim  - VerticalVocabulary.jsx, for the copy still hardcoded inside the
 *                   165 shared screens. Transitional; see the note there.
 */

export const VERTICAL = Object.freeze({
    FOOD: 'food',
    QUICK_COMMERCE: 'quickCommerce',
    /**
     * Pharmacies, which are quick-commerce sellers narrowed to storeType
     * 'pharmacy'. Same screens, same API, so the same rewrites plus the two
     * words that genuinely differ: a seller is a pharmacy and a product is a
     * medicine.
     */
    MEDICAL: 'medical',
});

/**
 * Ordered longest-first within each pair so "Restaurants" is matched before
 * "Restaurant" -- the shorter rule would otherwise turn it into "Sellers" via
 * "Seller" + a stranded "s".
 */
const RULES = {
    [VERTICAL.QUICK_COMMERCE]: [
        [/\bFoods\b/g, 'Products'],
        [/\bFood\b/g, 'Product'],
        [/\bfoods\b/g, 'products'],
        [/\bfood\b/g, 'product'],
        [/\bRestaurants\b/g, 'Sellers'],
        [/\bRestaurant\b/g, 'Seller'],
        [/\brestaurants\b/g, 'sellers'],
        [/\brestaurant\b/g, 'seller'],
    ],
    [VERTICAL.FOOD]: [],
};

/*
 * Medical builds on quick-commerce rather than restating it, so a word added
 * there is never missing here. Its own pairs come second: they rewrite the
 * OUTPUT of the quick-commerce pass ("Seller" is already "Seller" by then), and
 * they are ordered longest-first for the same reason as above.
 */
RULES[VERTICAL.MEDICAL] = [
    ...RULES[VERTICAL.QUICK_COMMERCE],
    [/\bSellers\b/g, 'Pharmacies'],
    [/\bSeller\b/g, 'Pharmacy'],
    [/\bsellers\b/g, 'pharmacies'],
    [/\bseller\b/g, 'pharmacy'],
    [/\bProducts\b/g, 'Medicines'],
    [/\bProduct\b/g, 'Medicine'],
    [/\bproducts\b/g, 'medicines'],
    [/\bproduct\b/g, 'medicine'],
];

/** Rewrite one string into a vertical's vocabulary. Unknown verticals pass through. */
export const translate = (text, vertical = VERTICAL.FOOD) => {
    const rules = RULES[vertical];
    if (!rules || rules.length === 0 || typeof text !== 'string') return text;
    return rules.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
};

/**
 * The raw rule pairs, for callers that already have their own label pipeline.
 *
 * AdminSidebar rebases and relabels the whole menu tree in one pass, so it needs the
 * pairs rather than the function. Exported so it does not keep a second, drifting
 * copy of the same table -- its version had only the title-case half.
 */
export const rulesFor = (vertical) => RULES[vertical] || [];

/**
 * Nodes the DOM shim must never rewrite.
 *
 * Everything here holds VALUES rather than labels. A seller genuinely named
 * "Restaurant Paradise" appears in a table cell, and rewriting it displayed
 * "Seller Paradise" -- the shim was corrupting the record it was supposed to be
 * labelling. `th` is deliberately absent: a column heading is chrome and should
 * translate.
 */
export const isDataNode = (element) => {
    if (!element) return false;
    const tag = element.tagName;
    if (!tag) return false;
    return (
        tag === 'TD'
        || tag === 'INPUT'
        || tag === 'TEXTAREA'
        || tag === 'OPTION'
        || tag === 'CODE'
        || tag === 'PRE'
        || element.hasAttribute?.('data-no-vocab')
        || element.isContentEditable === true
    );
};
