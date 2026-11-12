// ╔════════════════════════════════════════════════════════════════════╗
// ║ database.sanitizers.js — Validação de identificadores SQL          ║
// ╚════════════════════════════════════════════════════════════════════╝

import { ALLOWED_SCHEMAS, BLOCKED_TABLES, MASKED_VALUE, SENSITIVE_COLUMN_WORDS } from './database.constants.js';

export function assertSafeIdentifier(value, label = 'identificador') {
  const v = String(value || '').trim();

  if (!v) {
    const err = new Error(`${label} obrigatório.`);
    err.status = 400;
    throw err;
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) {
    const err = new Error(`${label} inválido: ${v}`);
    err.status = 400;
    throw err;
  }

  return v;
}

export function quoteIdent(value) {
  const safe = assertSafeIdentifier(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

// Para objetos que JÁ EXISTEM no catálogo (ex.: constraint ".productsPrices_price_id_fkey").
// Só use depois de confirmar que o nome existe; nomes novos passam por quoteIdent.
export function quoteExistingIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function assertTableAllowed(tableName) {
  const safeTable = assertSafeIdentifier(tableName, 'Tabela');

  if (BLOCKED_TABLES.has(safeTable)) {
    const err = new Error(`Tabela bloqueada por segurança: ${safeTable}`);
    err.status = 403;
    throw err;
  }

  return safeTable;
}

export function assertSchemaAllowed(schemaName) {
  const safeSchema = assertSafeIdentifier(schemaName, 'Schema');

  if (!ALLOWED_SCHEMAS.has(safeSchema)) {
    const err = new Error(`Schema não permitido: ${safeSchema}`);
    err.status = 403;
    throw err;
  }

  return safeSchema;
}

export function isSensitiveColumn(columnName) {
  const words = String(columnName || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  // token_expires_at, password_changed_at, token_type... são metadados, não o segredo
  if (words.some((w) => ['expires', 'expiry', 'expiration', 'changed', 'type', 'count', 'at', 'date'].includes(w))) {
    return false;
  }

  return words.some((w, i) =>
    SENSITIVE_COLUMN_WORDS.has(w)
    || (w === 'key' && ['api', 'private'].includes(words[i - 1]))
  );
}

// Troca o valor das colunas sensíveis por •••••• (null continua null)
export function maskRow(row) {
  if (!row || typeof row !== 'object') return row;

  const out = { ...row };

  for (const key of Object.keys(out)) {
    if (isSensitiveColumn(key) && out[key] !== null && out[key] !== undefined) {
      out[key] = MASKED_VALUE;
    }
  }

  return out;
}

// Valor de pesquisa literal: % e _ digitados não viram curinga
export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// A tela mostra arrays do PostgreSQL como JSON (["a","b"]). Ao salvar, esse texto
// vira array JS de novo para o driver montar o literal {a,b}. Outros formatos passam direto.
export function coerceColumnValue(column, value) {
  if (column?.data_type !== 'ARRAY' || typeof value !== 'string') return value;

  const raw = value.trim();
  if (!raw.startsWith('[')) return value;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

export function coerceEntries(columns, entries) {
  const byName = new Map(columns.map((c) => [c.column_name, c]));
  return entries.map(([key, value]) => [key, coerceColumnValue(byName.get(key), value)]);
}
