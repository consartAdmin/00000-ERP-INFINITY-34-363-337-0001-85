// ╔══════════════════════════════════════════════════════════════════════╗
// ║ labelPrintModels.repository.js — Modelos de etiqueta de Localização ║
// ║ Table: public."labelPrintModels" (vários modelos nomeados)          ║
// ║ Criada sob demanda (CREATE TABLE IF NOT EXISTS) no 1º acesso.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const LABEL_PRINT_MODELS_TABLE = 'public."labelPrintModels"';

const BARCODE_TYPES = ['CODE128', 'CODE39', 'QR'];
const PAPERS = ['thermal', 'a4'];
/* Caminho da localização: single = 1 linha (corta com …), wrap = quebra quando não cabe, levels = 1 nível por linha */
const LOCATION_WRAPS = ['single', 'wrap', 'levels'];

/* Campos graváveis: [coluna, tipo, padrão, min, max] */
const FIELDS = [
  ['name', 'text', null],
  ['description', 'text', null],
  ['width_mm', 'number', 60, 10, 300],
  ['height_mm', 'number', 40, 10, 300],
  ['margin_mm', 'number', 2, 0, 20],
  ['paper', 'paper', 'thermal'],
  ['barcode_type', 'barcode', 'CODE128'],
  ['barcode_height_mm', 'number', 17, 3, 200],
  ['barcode_width_pct', 'int', 90, 30, 100],
  ['show_title', 'bool', true],
  ['title_text', 'text', 'LOCALIZAÇÃO'],
  ['title_font_pt', 'number', 11, 4, 72],
  ['show_location', 'bool', true],
  ['location_font_pt', 'number', 9, 4, 72],
  ['location_wrap', 'wrap', 'single'],
  ['show_barcode_text', 'bool', true],
  ['barcode_text_font_pt', 'number', 10, 4, 72],
  ['show_footer', 'bool', true],
  ['footer_text', 'text', 'CONSART ERP'],
  ['show_border', 'bool', true],
  ['copies', 'int', 1, 1, 50],
  ['is_active', 'bool', true],
];

const COLUMNS = FIELDS.map(([name]) => name);

let ensured = null;

export function ensureLabelPrintModelsTable() {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${LABEL_PRINT_MODELS_TABLE} (
          id                   SERIAL PRIMARY KEY,
          name                 VARCHAR(80)  NOT NULL,
          description          VARCHAR(200),
          width_mm             NUMERIC(6,2) NOT NULL DEFAULT 60,
          height_mm            NUMERIC(6,2) NOT NULL DEFAULT 40,
          margin_mm            NUMERIC(5,2) NOT NULL DEFAULT 2,
          paper                VARCHAR(20)  NOT NULL DEFAULT 'thermal',
          barcode_type         VARCHAR(20)  NOT NULL DEFAULT 'CODE128',
          barcode_height_mm    NUMERIC(6,2) NOT NULL DEFAULT 17,
          barcode_width_pct    INTEGER      NOT NULL DEFAULT 90,
          show_title           BOOLEAN      NOT NULL DEFAULT TRUE,
          title_text           VARCHAR(60)  DEFAULT 'LOCALIZAÇÃO',
          title_font_pt        NUMERIC(5,2) NOT NULL DEFAULT 11,
          show_location        BOOLEAN      NOT NULL DEFAULT TRUE,
          location_font_pt     NUMERIC(5,2) NOT NULL DEFAULT 9,
          location_wrap        VARCHAR(10)  NOT NULL DEFAULT 'single',
          show_barcode_text    BOOLEAN      NOT NULL DEFAULT TRUE,
          barcode_text_font_pt NUMERIC(5,2) NOT NULL DEFAULT 10,
          show_footer          BOOLEAN      NOT NULL DEFAULT TRUE,
          footer_text          VARCHAR(60)  DEFAULT 'CONSART ERP',
          show_border          BOOLEAN      NOT NULL DEFAULT TRUE,
          copies               INTEGER      NOT NULL DEFAULT 1,
          is_default           BOOLEAN      NOT NULL DEFAULT FALSE,
          is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
          created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
          updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
        );
      `);
      // Colunas adicionadas depois da 1ª versão da tabela
      await pool.query(`
        ALTER TABLE ${LABEL_PRINT_MODELS_TABLE}
          ADD COLUMN IF NOT EXISTS location_wrap VARCHAR(10) NOT NULL DEFAULT 'single';
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "labelPrintModels_name_uq"
          ON ${LABEL_PRINT_MODELS_TABLE} (LOWER(name));
      `);
      // Primeiro acesso: cria o modelo padrão igual à etiqueta que já era impressa (60 × 40 mm).
      await pool.query(`
        INSERT INTO ${LABEL_PRINT_MODELS_TABLE} (name, description, is_default)
        SELECT 'Padrão 60 × 40 mm', 'Etiqueta térmica padrão de localização', TRUE
        WHERE NOT EXISTS (SELECT 1 FROM ${LABEL_PRINT_MODELS_TABLE});
      `);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (['true', '1', 1, 'sim'].includes(value)) return true;
  if (['false', '0', 0, 'nao', 'não'].includes(value)) return false;
  return fallback;
}

const LABELS = {
  width_mm: 'Largura', height_mm: 'Altura', margin_mm: 'Margem',
  barcode_height_mm: 'Altura do código', barcode_width_pct: 'Largura do código (%)',
  title_font_pt: 'Fonte do título', location_font_pt: 'Fonte da localização',
  barcode_text_font_pt: 'Fonte do código', copies: 'Cópias',
};

/** Normaliza e valida o corpo. partial=true aceita só os campos enviados. */
function sanitize(payload = {}, { partial = false } = {}) {
  const out = {};
  for (const [col, type, def, min, max] of FIELDS) {
    if (!(col in payload)) {
      if (!partial && def !== null) out[col] = def;
      continue;
    }
    const raw = payload[col];
    if (type === 'text') {
      const txt = raw === null || raw === undefined ? '' : String(raw).trim();
      out[col] = txt || null;
    } else if (type === 'bool') {
      out[col] = toBool(raw, def);
    } else if (type === 'paper') {
      out[col] = PAPERS.includes(raw) ? raw : def;
    } else if (type === 'wrap') {
      out[col] = LOCATION_WRAPS.includes(raw) ? raw : def;
    } else if (type === 'barcode') {
      const v = String(raw || '').toUpperCase();
      out[col] = BARCODE_TYPES.includes(v) ? v : def;
    } else {
      let n = toNumber(raw);
      if (n === null) n = def;
      if (type === 'int') n = Math.round(n);
      if (n < min || n > max) {
        throw badRequest(`${LABELS[col] || col}: informe um valor entre ${String(min).replace('.', ',')} e ${String(max).replace('.', ',')}.`);
      }
      out[col] = n;
    }
  }
  if ((!partial || 'name' in out) && !out.name) {
    throw badRequest('Informe o nome do modelo.');
  }
  if (out.name && out.name.length > 80) throw badRequest('O nome do modelo pode ter no máximo 80 caracteres.');
  return out;
}

function mapDbError(err) {
  if (err?.code === '23505') return badRequest('Já existe um modelo com esse nome.');
  return err;
}

export async function listLabelModels({ includeInactive = false } = {}) {
  await ensureLabelPrintModelsTable();
  const { rows } = await pool.query(`
    SELECT * FROM ${LABEL_PRINT_MODELS_TABLE}
     ${includeInactive ? '' : 'WHERE is_active = TRUE'}
     ORDER BY is_default DESC, LOWER(name) ASC;
  `);
  return rows;
}

export async function getLabelModel(id) {
  await ensureLabelPrintModelsTable();
  const { rows } = await pool.query(`SELECT * FROM ${LABEL_PRINT_MODELS_TABLE} WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getDefaultLabelModel() {
  await ensureLabelPrintModelsTable();
  const { rows } = await pool.query(`
    SELECT * FROM ${LABEL_PRINT_MODELS_TABLE}
     WHERE is_active = TRUE
     ORDER BY is_default DESC, id ASC
     LIMIT 1;
  `);
  return rows[0] || null;
}

async function setDefaultInTx(client, id) {
  await client.query(`UPDATE ${LABEL_PRINT_MODELS_TABLE} SET is_default = (id = $1), updated_at = NOW()`, [id]);
}

export async function createLabelModel(payload = {}) {
  await ensureLabelPrintModelsTable();
  const data = sanitize(payload);
  const cols = Object.keys(data).filter((c) => COLUMNS.includes(c));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO ${LABEL_PRINT_MODELS_TABLE} (${cols.map((c) => `"${c}"`).join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *;`,
      cols.map((c) => data[c])
    );
    let row = rows[0];
    if (toBool(payload.is_default, false) && row.is_active) {
      await setDefaultInTx(client, row.id);
      row = { ...row, is_default: true };
    }
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDbError(err);
  } finally {
    client.release();
  }
}

export async function updateLabelModel(id, payload = {}) {
  await ensureLabelPrintModelsTable();
  const current = await getLabelModel(id);
  if (!current) return null;
  const data = sanitize(payload, { partial: true });
  if (current.is_default && data.is_active === false) {
    throw badRequest('O modelo padrão não pode ser desativado. Defina outro modelo como padrão antes.');
  }
  const cols = Object.keys(data).filter((c) => COLUMNS.includes(c));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let row = current;
    if (cols.length) {
      const { rows } = await client.query(
        `UPDATE ${LABEL_PRINT_MODELS_TABLE}
            SET ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ')}, updated_at = NOW()
          WHERE id = $${cols.length + 1}
          RETURNING *;`,
        [...cols.map((c) => data[c]), id]
      );
      row = rows[0];
    }
    if (toBool(payload.is_default, false) && row.is_active && !row.is_default) {
      await setDefaultInTx(client, row.id);
      row = { ...row, is_default: true };
    }
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDbError(err);
  } finally {
    client.release();
  }
}

export async function setDefaultLabelModel(id) {
  const current = await getLabelModel(id);
  if (!current) return null;
  if (!current.is_active) throw badRequest('Reative o modelo antes de defini-lo como padrão.');
  await pool.query(`UPDATE ${LABEL_PRINT_MODELS_TABLE} SET is_default = (id = $1), updated_at = NOW()`, [id]);
  return { ...current, is_default: true };
}

export async function deleteLabelModel(id) {
  const current = await getLabelModel(id);
  if (!current) return null;
  if (current.is_default) {
    throw badRequest('O modelo padrão não pode ser excluído. Defina outro modelo como padrão antes.');
  }
  await pool.query(`DELETE FROM ${LABEL_PRINT_MODELS_TABLE} WHERE id = $1`, [id]);
  return current;
}
