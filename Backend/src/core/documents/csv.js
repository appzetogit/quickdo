/**
 * CSV for downloadable reports.
 *
 * - RFC 4180 quoting (commas, quotes, newlines);
 * - formula-injection guard: a cell that starts with = + - @ (or a tab / CR)
 *   is prefixed with an apostrophe so a spreadsheet shows it as text instead
 *   of running it. Item names and customer notes are typed by other people,
 *   so this matters for a file a restaurant opens in Excel. Numbers are left
 *   alone: a negative payout must stay a number;
 * - a UTF-8 byte-order mark, so Excel reads non-ASCII item names correctly.
 */

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    let s = value instanceof Date ? value.toISOString() : String(value);
    if (FORMULA_START.test(s)) s = `'${s}`;
    if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

/**
 * columns: [{ header, key | value(row) }]
 */
export function toCsv(columns, rows) {
    const lines = [columns.map((c) => csvCell(c.header)).join(',')];
    for (const row of rows) {
        lines.push(columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
}
