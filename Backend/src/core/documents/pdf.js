import PDFDocument from 'pdfkit';

/**
 * Small pdfkit helpers shared by every server-generated document: restaurant
 * reports and settlement statements, the food order invoice.
 *
 * Deliberately thin. It knows how to collect a document into a Buffer, print a
 * header block, a key/value block and a paged table -- nothing about orders,
 * restaurants or money rules, so any vertical can call it without importing
 * another vertical's models.
 *
 * pdfkit's built-in Helvetica has no rupee glyph, so amounts print as "Rs."
 * (the same convention as the service-provider invoice).
 */

export const PAGE = Object.freeze({ left: 40, right: 555, top: 40, bottom: 790 });

export const round2 = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round((v + Number.EPSILON) * 100) / 100;
};

export const money = (n) => `Rs. ${round2(n).toFixed(2)}`;
export const amount = (n) => round2(n).toFixed(2);

const IST = 'Asia/Kolkata';
export const formatDate = (value, { time = false } = {}) => {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', {
        timeZone: IST,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
};

/**
 * Build a PDF and resolve with its bytes.
 *
 * `draw(doc)` may be async. Anything it throws rejects the promise instead of
 * leaving a half-written stream behind.
 */
export function renderPdf(draw, { info = {}, size = 'A4', margin = 40 } = {}) {
    return new Promise((resolve, reject) => {
        let doc;
        try {
            doc = new PDFDocument({ size, margin, info, bufferPages: true });
        } catch (err) {
            reject(err);
            return;
        }
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        Promise.resolve()
            .then(() => draw(doc))
            .then(() => {
                // Page numbers once every page exists.
                const range = doc.bufferedPageRange();
                for (let i = range.start; i < range.start + range.count; i += 1) {
                    doc.switchToPage(i);
                    doc.fontSize(7).fillColor('#888')
                        .text(`Page ${i + 1} of ${range.count}`, PAGE.left, PAGE.bottom + 18, {
                            width: PAGE.right - PAGE.left, align: 'right', lineBreak: false,
                        });
                }
                doc.end();
            })
            .catch((err) => {
                try { doc.end(); } catch { /* already ended */ }
                reject(err);
            });
    });
}

/** Title, optional subtitle lines, and a rule under them. */
export function drawHeader(doc, { title, subtitle = [], right = [] } = {}) {
    const top = doc.y;
    doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text(title || '', PAGE.left, top, { width: 330 });
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    for (const line of subtitle.filter(Boolean)) doc.text(String(line), { width: 330 });
    const leftBottom = doc.y;
    if (right.length) {
        doc.fontSize(9).fillColor('#000');
        let y = top;
        for (const line of right.filter(Boolean)) {
            doc.text(String(line), 380, y, { width: PAGE.right - 380, align: 'right' });
            y = doc.y;
        }
        doc.y = Math.max(leftBottom, doc.y);
    }
    doc.moveDown(0.5);
    doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.right, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.6);
    doc.fillColor('#000');
}

export function drawSectionTitle(doc, title) {
    ensureSpace(doc, 40);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(title, PAGE.left, doc.y);
    doc.font('Helvetica').moveDown(0.3);
}

/** Label / value rows, right-aligned values; `bold` rows for totals. */
export function drawKeyValues(doc, rows, { x = PAGE.left, width = PAGE.right - PAGE.left, valueWidth = 120 } = {}) {
    for (const row of rows) {
        if (!row) continue;
        ensureSpace(doc, 16);
        const y = doc.y;
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.bold ? 10 : 9).fillColor(row.muted ? '#666' : '#000');
        doc.text(String(row.label ?? ''), x, y, { width: width - valueWidth - 10 });
        const labelBottom = doc.y;
        doc.text(String(row.value ?? ''), x + width - valueWidth, y, { width: valueWidth, align: 'right' });
        doc.y = Math.max(labelBottom, doc.y) + 2;
    }
    doc.font('Helvetica').fillColor('#000');
}

export function ensureSpace(doc, needed) {
    if (doc.y + needed > PAGE.bottom) {
        doc.addPage();
        doc.y = PAGE.top;
    }
}

/**
 * A table that continues across pages, repeating its header.
 *
 * columns: [{ header, key | value(row), width, align }]
 * Widths are scaled to fit the printable width when they add up to more.
 */
export function drawTable(doc, { columns, rows, fontSize = 8, emptyText = 'No records for this period.' }) {
    const total = columns.reduce((s, c) => s + (c.width || 60), 0);
    const avail = PAGE.right - PAGE.left;
    const scale = total > avail ? avail / total : 1;
    const cols = [];
    let x = PAGE.left;
    for (const c of columns) {
        const w = (c.width || 60) * scale;
        cols.push({ ...c, x, w });
        x += w;
    }

    const header = () => {
        ensureSpace(doc, 30);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000');
        let bottom = y;
        for (const c of cols) {
            doc.text(String(c.header), c.x + 2, y, { width: c.w - 4, align: c.align || 'left' });
            bottom = Math.max(bottom, doc.y);
        }
        doc.y = bottom + 2;
        doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.right, doc.y).strokeColor('#999').stroke();
        doc.y += 3;
        doc.font('Helvetica');
    };

    header();
    if (!rows.length) {
        doc.fontSize(fontSize).fillColor('#666').text(emptyText, PAGE.left, doc.y);
        doc.fillColor('#000');
        return;
    }
    for (const row of rows) {
        if (doc.y + fontSize * 2.5 > PAGE.bottom) {
            doc.addPage();
            doc.y = PAGE.top;
            header();
        }
        const y = doc.y;
        let bottom = y;
        doc.fontSize(fontSize).fillColor('#000').font(row?.__bold ? 'Helvetica-Bold' : 'Helvetica');
        for (const c of cols) {
            const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
            doc.text(raw === undefined || raw === null ? '' : String(raw), c.x + 2, y, { width: c.w - 4, align: c.align || 'left' });
            bottom = Math.max(bottom, doc.y);
        }
        doc.y = bottom + 2;
    }
    doc.font('Helvetica');
}

export const PDF_CONTENT_TYPE = 'application/pdf';
