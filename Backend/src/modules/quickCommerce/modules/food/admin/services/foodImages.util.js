/**
 * Normalises the dish image fields so `image` and `images` can never disagree.
 *
 * Shared by the admin and restaurant food services rather than duplicated: they
 * write the same two fields on the same documents, and two copies of this rule
 * would eventually drift into a dish whose primary image differs depending on
 * which panel last saved it.
 *
 * Callers send either shape. The admin panel and restaurant panel send `images`;
 * the restaurant app and older builds send a single `image`. Whichever arrives,
 * `image` ends up as `images[0]`.
 *
 * Keeping them in sync matters because different screens read different fields —
 * the dish detail gallery uses `images`, while menu lists, cart lines, share
 * previews and push payloads use `image`. Drift means a dish that shows one photo
 * in the list and a different one when opened.
 *
 * Returns undefined when the caller mentioned neither, so an unrelated update
 * (a price edit, say) does not wipe existing images.
 */
export function normalizeFoodImages(body = {}, existing = {}) {
    const clean = (list) =>
        (Array.isArray(list) ? list : [])
            .map((v) => String(v || '').trim())
            .filter(Boolean);

    const hasImages = body.images !== undefined;
    const hasImage = body.image !== undefined;
    if (!hasImages && !hasImage) return undefined;

    let images = hasImages ? clean(body.images) : clean(existing.images);

    if (hasImage) {
        const primary = String(body.image || '').trim();
        if (!hasImages) {
            // Single-image caller: replace the primary, keep any extras behind it,
            // so a client that predates galleries cannot silently delete one.
            images = primary ? [primary, ...images.filter((u) => u !== primary)] : [];
        } else if (primary && !images.includes(primary)) {
            images = [primary, ...images];
        }
    }

    // De-duplicate: a panel can re-attach a file that is already there, and a
    // repeated URL renders as a duplicate slide in the gallery.
    images = [...new Set(images)];

    return { images, image: images[0] || '' };
}
