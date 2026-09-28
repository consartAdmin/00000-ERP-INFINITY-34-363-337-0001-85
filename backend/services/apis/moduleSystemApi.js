// ╔══════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemApi.js — Acesso ao Postgres (cadastro de módulos)       ║
// ║ CONSART ERP — ESM, SQL parametrizado, pronto p/ controllers         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TABLE = 'public."moduleSystem"';

/** Helper: executa query com log leve */
async function q(text, params = []) {
  // console.debug('[SQL moduleSystem]', text, params);
  const res = await pool.query(text, params);
  return res;
}

/** Garante que a tabela exista e esteja com colunas atualizadas (idempotente) */
export async function ensureTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id         BIGSERIAL     PRIMARY KEY,
      name       VARCHAR(100)  NOT NULL,
      path       VARCHAR(200)  NOT NULL,
      is_active  BOOLEAN       NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
    );
  `);

  // Ajustes de compatibilidade (caso venha de versões antigas)
  await q(`
    ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS name       VARCHAR(100),
      ADD COLUMN IF NOT EXISTS path       VARCHAR(200),
      ADD COLUMN IF NOT EXISTS is_active  BOOLEAN       NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ   NOT NULL DEFAULT now();
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_name
      ON ${TABLE}(name);
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_is_active
      ON ${TABLE}(is_active);
  `);
}

/**
 * Lista módulos.
 * Filtros:
 *  - onlyActive: true → só módulos ativos
 *  - search: termo do nome ou path
 */
export async function list({ onlyActive = false, search } = {}) {
  const where = [];
  const params = [];

  if (onlyActive) {
    where.push('is_active = true');
  }

  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length - 1} OR path ILIKE $${params.length})`);
  }

  const sql = `
    SELECT id, name, path, is_active, created_at, updated_at
    FROM ${TABLE}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id ASC;
  `;

  const { rows } = await q(sql, params);
  return rows;
}

/** Busca módulo por ID */
export async function findById(id) {
  const { rows } = await q(
    `
    SELECT id, name, path, is_active, created_at, updated_at
    FROM ${TABLE}
    WHERE id = $1;
  `,
    [Number(id)]
  );
  return rows[0] || null;
}

/** Cria novo módulo */
export async function create({ name, path, is_active = true }) {
  const { rows } = await q(
    `
    INSERT INTO ${TABLE} (name, path, is_active)
    VALUES ($1, $2, $3)
    RETURNING id, name, path, is_active, created_at, updated_at;
  `,
    [name, path, !!is_active]
  );
  return rows[0];
}

/** Atualiza módulo por ID */
export async function update(id, { name, path, is_active }) {
  const fields = [];
  const params = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    params.push(name);
  }
  if (path !== undefined) {
    fields.push(`path = $${idx++}`);
    params.push(path);
  }
  if (is_active !== undefined) {
    fields.push(`is_active = $${idx++}`);
    params.push(!!is_active);
  }

  if (!fields.length) {
    // nada para atualizar
    return findById(id);
  }

  params.push(Number(id));

  const sql = `
    UPDATE ${TABLE}
    SET ${fields.join(', ')},
        updated_at = now()
    WHERE id = $${params.length}
    RETURNING id, name, path, is_active, created_at, updated_at;
  `;

  const { rows } = await q(sql, params);
  return rows[0] || null;
}

/** Remove módulo por ID */
export async function remove(id) {
  const { rows } = await q(
    `
    DELETE FROM ${TABLE}
    WHERE id = $1
    RETURNING id, name, path;
  `,
    [Number(id)]
  );
  return rows[0] || null;
}

/** Remove módulos de teste (nome iniciando com 'TEST -') para cleanup */
export async function removeTestRecords() {
  const { rowCount } = await q(
    `
    DELETE FROM ${TABLE}
    WHERE name ILIKE 'TEST -%';
  `
  );
  return rowCount;
}
