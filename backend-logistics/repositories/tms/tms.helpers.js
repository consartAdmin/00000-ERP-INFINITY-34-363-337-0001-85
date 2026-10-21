// ╔════════════════════════════════════════════════════════════════════╗
// ║ tms.helpers.js — helpers compartilhados do TMS                     ║
// ║ Reaproveita os conversores do módulo Entregas e acrescenta a       ║
// ║ normalização por tipo de campo usada pelo CRUD genérico.           ║
// ╚════════════════════════════════════════════════════════════════════╝

import {
  httpError, toInt, toNum, toBool, cleanText, toEnum, toDate,
} from '../deliveryTrips/deliveryTrips.schema.js';

export { httpError, toInt, toNum, toBool, cleanText, toEnum, toDate };

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Data local (yyyy-mm-dd) de um Date do driver pg (DATE vem como meia-noite local) */
export function isoDate(d) {
  if (!(d instanceof Date)) return d;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toTimestamp(v) {
  const s = cleanText(v, 40);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw httpError('INVALID_DATETIME', 400);
  return d.toISOString();
}

/**
 * Converte um valor conforme a definição do campo.
 * def: { type: 'text'|'upper'|'int'|'num'|'date'|'ts'|'bool'|'enum', max, values, default }
 */
export function convertField(name, def, value) {
  switch (def.type) {
    case 'int': return toInt(value);
    case 'num': return toNum(value);
    case 'date': return toDate(value);
    case 'ts': return toTimestamp(value);
    case 'bool': return toBool(value, def.default ?? false);
    case 'enum': return toEnum(value, def.values, `INVALID_${name.toUpperCase()}`, def.default ?? null);
    case 'upper': {
      const s = cleanText(value, def.max);
      return s ? s.toUpperCase() : null;
    }
    default: return cleanText(value, def.max);
  }
}

/** Traduz erros do Postgres para códigos da API */
export function mapTmsError(err) {
  if (err?.status) return err;
  if (err?.code === '23505') {
    if (/series_number/.test(err.constraint || '')) return httpError('NUMBER_ALREADY_USED', 409);
    if (/fire_number/.test(err.constraint || '')) return httpError('FIRE_NUMBER_ALREADY_EXISTS', 409);
    return httpError('DUPLICATE', 409);
  }
  if (err?.code === '23503') {
    if (/still referenced/i.test(err.detail || '')) return httpError('IN_USE', 409);
    return httpError('REFERENCE_NOT_FOUND', 404);
  }
  if (err?.code === '23514') return httpError('INVALID_VALUE', 400);
  if (err?.code === '23502') return httpError(`${String(err.column || 'FIELD').toUpperCase()}_REQUIRED`, 400);
  return err;
}
