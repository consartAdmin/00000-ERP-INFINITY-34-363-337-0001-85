// ╔══════════════════════════════════════════════════════════════════════╗
// ║ debtsTypes.repository.js — Tipos de dívida (Compromissos Financeiros) ║
// ║ Tabela: public."debtsTypes" (criada sob demanda, idempotente)        ║
// ║ public.debts.debt_type continua guardando o código (ex.: ALUGUEL).   ║
// ║ Carga inicial: os 8 tipos que eram fixos na tela + códigos já usados ║
// ║ em public.debts que não estejam na lista.                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB_DEBTS_TYPES = 'public."debtsTypes"';
export const PK_DEBTS_TYPES = 'debt_type_id';

const DEFAULT_TYPES = [
  ['FORNECEDOR', 'Fornecedor'],
  ['IMPOSTO', 'Imposto'],
  ['ALUGUEL', 'Aluguel'],
  ['EMPRESTIMO', 'Empréstimo'],
  ['CARTAO', 'Cartão'],
  ['FOLHA', 'Folha'],
  ['SERVICOS', 'Serviços'],
  ['OUTROS', 'Outros'],
];

let _ensurePromise = null;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function ensureDebtsTypes() {
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    const client = await pool.connect();
    const LOCK_KEY = 'consart.ensureTable.debtsTypes';

    try {
      await client.query(`SET lock_timeout TO '5s'`);
      await client.query(`SELECT pg_advisory_lock(hashtext($1)::bigint)`, [LOCK_KEY]);
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB_DEBTS_TYPES} (
          ${PK_DEBTS_TYPES} SERIAL PRIMARY KEY,
          code              VARCHAR(50) NOT NULL,
          name              VARCHAR(100) NOT NULL,
          active            BOOLEAN NOT NULL DEFAULT TRUE,
          created_at        TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_types_code_unique
          ON ${TB_DEBTS_TYPES} (code);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_types_name_unique
          ON ${TB_DEBTS_TYPES} (LOWER(TRIM(name)));
      `);

      const values = DEFAULT_TYPES.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
      await client.query(
        `INSERT INTO ${TB_DEBTS_TYPES} (code, name) VALUES ${values} ON CONFLICT DO NOTHING`,
        DEFAULT_TYPES.flat(),
      );

      // Códigos já gravados em dívidas e que não estão no cadastro
      const debtsTable = await client.query(`SELECT to_regclass('public.debts') AS t`);
      if (debtsTable.rows[0]?.t) {
        await client.query(`
          INSERT INTO ${TB_DEBTS_TYPES} (code, name)
          SELECT DISTINCT TRIM(d.debt_type), TRIM(d.debt_type)
          FROM public.debts d
          WHERE COALESCE(TRIM(d.debt_type), '') <> ''
          ON CONFLICT DO NOTHING
        `);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      _ensurePromise = null;
      throw error;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [LOCK_KEY]).catch(() => {});
      client.release();
    }
  })();

  return _ensurePromise;
}

/** "Manutenção Predial" → "MANUTENCAO_PREDIAL" */
export function codeFromName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export async function listDebtsTypes({ active } = {}) {
  await ensureDebtsTypes();

  const onlyActive = ['true', '1', 'sim'].includes(String(active ?? '').toLowerCase());
  const { rows } = await pool.query(`
    SELECT ${PK_DEBTS_TYPES}, code, name, active
    FROM ${TB_DEBTS_TYPES}
    ${onlyActive ? 'WHERE active = TRUE' : ''}
    ORDER BY LOWER(name)
  `);

  return rows;
}

export async function createDebtsType({ name } = {}) {
  await ensureDebtsTypes();

  const cleanName = String(name ?? '').trim().slice(0, 100);
  if (!cleanName) throw httpError(400, 'Informe o nome do tipo.');

  const code = codeFromName(cleanName);
  if (!code) throw httpError(400, 'Nome do tipo inválido.');

  const { rows: existing } = await pool.query(
    `SELECT ${PK_DEBTS_TYPES} FROM ${TB_DEBTS_TYPES} WHERE code = $1 OR LOWER(TRIM(name)) = LOWER($2) LIMIT 1`,
    [code, cleanName],
  );
  if (existing.length) throw httpError(409, `Já existe um tipo chamado "${cleanName}".`);

  const { rows } = await pool.query(
    `INSERT INTO ${TB_DEBTS_TYPES} (code, name) VALUES ($1, $2)
     RETURNING ${PK_DEBTS_TYPES}, code, name, active`,
    [code, cleanName],
  );

  return rows[0];
}
