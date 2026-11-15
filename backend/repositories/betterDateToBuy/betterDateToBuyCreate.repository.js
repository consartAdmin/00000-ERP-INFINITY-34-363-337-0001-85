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


// ──────────────────────────────────────────────────────────────────────
// GERAR PELA ÚLTIMA VENDA. Cliente sem alerta → cria. Cliente com
// alerta → só troca o dia (mantém observação, status e "contatado")
// quando updateExisting = true; senão pula. Tudo numa transação.
// ──────────────────────────────────────────────────────────────────────
export async function upsertBetterDatesFromLastSale(items = [], { updateExisting = false } = {}) {
  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const item of items) {
      const { rows } = await client.query(
        `SELECT better_date_to_buy_id, alert_day
           FROM "betterDateToBuy"
          WHERE customer_id = $1
          ORDER BY better_date_to_buy_id
          LIMIT 1
          FOR UPDATE`,
        [item.customer_id]
      );

      const existing = rows[0];

      if (!existing) {
        await createBetterDate(item, client);
        created += 1;
        continue;
      }

      if (!updateExisting || Number(existing.alert_day) === Number(item.alert_day)) {
        skipped += 1;
        continue;
      }

      await client.query(
        `UPDATE "betterDateToBuy"
            SET alert_day = $1, updated_at = NOW()
          WHERE better_date_to_buy_id = $2`,
        [item.alert_day, existing.better_date_to_buy_id]
      );
      updated += 1;
    }

    await client.query('COMMIT');
    return { created, updated, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
