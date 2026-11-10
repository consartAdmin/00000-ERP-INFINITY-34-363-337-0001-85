// ╔════════════════════════════════════════════════════════════════════╗
// ║ betterDateToBuyCreate.repository.js — create / create em lote      ║
// ║ Tabela: "betterDateToBuy"                                          ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';


// ──────────────────────────────────────────────────────────────────────
// CREATE ALERT
// ──────────────────────────────────────────────────────────────────────
export async function createBetterDate(data, client = pool) {
  const sql = `
    INSERT INTO "betterDateToBuy" (
      customer_id,
      alert_day,
      notes,
      status
    )
    VALUES (
      $1,
      $2,
      $3,
      $4
    )
    RETURNING *
  `;

  const params = [
    data.customer_id,
    data.alert_day,
    data.notes || null,
    data.status === 'inactive' ? 'inactive' : 'active'
  ];

  const { rows } = await client.query(sql, params);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// CREATE EM LOTE (sugestões pelo histórico). Pula cliente que já tem
// alerta. Tudo numa transação.
// ──────────────────────────────────────────────────────────────────────
export async function createBetterDatesBulk(items = []) {
  const client = await pool.connect();
  const created = [];
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const item of items) {
      const { rows } = await client.query(
        'SELECT 1 FROM "betterDateToBuy" WHERE customer_id = $1 LIMIT 1',
        [item.customer_id]
      );

      if (rows.length) {
        skipped += 1;
        continue;
      }

      created.push(await createBetterDate(item, client));
    }

    await client.query('COMMIT');
    return { created, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
