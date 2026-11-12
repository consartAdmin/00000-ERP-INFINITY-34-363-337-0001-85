// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: backend/public/database/js/database.utils.js                  ║
// ║ MODULE: Database Viewer / Editor                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './database.state.js';

const ISO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/;

// col (opcional) = linha de information_schema.columns da coluna.
// date → 2026-11-12 | timestamp sem fuso → 2026-11-12 10:00:00 (o mesmo valor gravado,
// sem o "T...Z" do JSON). timestamptz continua ISO (com fuso) para não perder o horário.
export function formatValue(value, col = null) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);

    const text = String(value);
    const iso = ISO_RE.exec(text);

    if (iso && col?.data_type === 'date') return iso[1];
    if (iso && col?.data_type === 'timestamp without time zone') return `${iso[1]} ${iso[2]}${iso[3] && iso[3] !== '.000' ? iso[3] : ''}`;

    return text;
}

export function isMaskedColumn(columnName) {
    return state.maskedColumns.includes(columnName);
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function getPkObject(row) {
    const out = {};

    for (const col of state.primaryKey) {
        out[col] = row[col];
    }

    return out;
}

// Mapa coluna → FK (apenas FKs de coluna única ou a 1ª coluna das compostas)
export function getFkByColumn() {
    const map = new Map();

    for (const fk of state.structure?.foreignKeys || []) {
        fk.columns.forEach((col, i) => {
            map.set(col, { ...fk, refColumn: fk.refColumns[i] });
        });
    }

    return map;
}

export function getColumnKeys(columnName) {
    const isPk = state.primaryKey.includes(columnName);
    const fk = getFkByColumn().get(columnName);

    return { isPk, fk };
}

export function describeFk(fk) {
    return `${fk.refTable}.${fk.refColumn ?? fk.refColumns.join(', ')}`;
}
