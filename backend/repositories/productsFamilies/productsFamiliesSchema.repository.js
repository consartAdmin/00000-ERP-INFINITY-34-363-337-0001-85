// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsFamiliesSchema.repository.js — garante a tabela            ║
// ║ "productsFamilies" e a coluna products.product_family_id           ║
// ║ Roda no boot do servidor (idempotente)                             ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, ALIAS, COLS } from './productsFamilies.constants.js';

export async function ensureProductsFamiliesTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${TB} (
        ${COLS.id}          SERIAL PRIMARY KEY,
        ${COLS.name}        VARCHAR(100) NOT NULL,
        ${COLS.subgroup_id} INTEGER,
        ${COLS.created_at}  TIMESTAMP DEFAULT NOW(),
        ${COLS.updated_at}  TIMESTAMP DEFAULT NOW(),
        ${COLS.is_active}   BOOLEAN   DEFAULT TRUE,
        CONSTRAINT ${ALIAS}_subgroup_name_key UNIQUE (${COLS.subgroup_id}, ${COLS.name})
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${ALIAS}_subgroup_id ON public.${TB} (${COLS.subgroup_id});
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${ALIAS}_name_ci ON public.${TB} (LOWER(${COLS.name}));
    `);

    // Coluna no cadastro de produtos (opcional, sem FK — mesmo padrão de grupo/subgrupo)
    await client.query(`
      ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS product_family_id INTEGER;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_product_family_id ON public."products" (product_family_id);
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
