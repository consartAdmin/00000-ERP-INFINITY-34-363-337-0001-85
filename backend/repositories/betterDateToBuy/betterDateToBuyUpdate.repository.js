// ╔════════════════════════════════════════════════════════════════════╗
// ║ betterDateToBuyUpdate.repository.js — update / contatado / status  ║
// ║ Tabela: "betterDateToBuy"                                          ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TODAY_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;


// ──────────────────────────────────────────────────────────────────────
// UPDATE ALERT
// ──────────────────────────────────────────────────────────────────────
export async function updateBetterDate(id, data) {
  const sql = `
    UPDATE "betterDateToBuy"
    SET
      customer_id = $1,
      alert_day = $2,
      notes = $3,
      status = $4,
      updated_at = NOW()
    WHERE
      better_date_to_buy_id = $5
    RETURNING *
  `;

  const params = [
    data.customer_id,
    data.alert_day,
    data.notes || null,
    data.status === 'inactive' ? 'inactive' : 'active',
    id
  ];

  const { rows } = await pool.query(sql, params);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// MARCAR COMO CONTATADO (some da lista de pendentes até o mês que vem)
// ──────────────────────────────────────────────────────────────────────
export async function markAlertSent(id) {
  const sql = `
    UPDATE "betterDateToBuy"
    SET
      last_alert_sent = ${TODAY_SQL},
      updated_at = NOW()
    WHERE
      better_date_to_buy_id = $1
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [id]);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// DESFAZER CONTATADO (volta para pendente neste mês)
// ──────────────────────────────────────────────────────────────────────
export async function unmarkAlertSent(id) {
  const sql = `
    UPDATE "betterDateToBuy"
    SET
      last_alert_sent = NULL,
      updated_at = NOW()
    WHERE
      better_date_to_buy_id = $1
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [id]);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// PAUSAR / ATIVAR
// ──────────────────────────────────────────────────────────────────────
export async function setBetterDateStatus(id, status) {
  const sql = `
    UPDATE "betterDateToBuy"
    SET
      status = $1,
      updated_at = NOW()
    WHERE
      better_date_to_buy_id = $2
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [status === 'inactive' ? 'inactive' : 'active', id]);

  return rows[0];
}
