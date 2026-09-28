//==================================================//
// backend/services/apis/auditLogsApi.js            //
// Tabela: public."auditLogs"                       //
// Serviço: Auditoria Central do Sistema            //
//==================================================//

'use strict';

import pool from '../../config/db.js';

/**
 * Registra uma operação na auditoria.
 *
 * O parâmetro `db` pode receber um client PostgreSQL para que
 * a auditoria participe da mesma transação da operação principal.
 */
export async function createAuditLog({
  tabela,
  register_id = null,
  operation,
  user_id = null,
  before = null,
  after = null,
  db = pool,
}) {
  if (!tabela) {
    throw new Error(
      '[AUDIT] O campo tabela é obrigatório.'
    );
  }

  if (!operation) {
    throw new Error(
      '[AUDIT] O campo operation é obrigatório.'
    );
  }

  const sql = `
    INSERT INTO public."auditLogs"
    (
      tabela,
      register_id,
      operation,
      user_id,
      before,
      after
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      $5::jsonb,
      $6::jsonb
    )
    RETURNING *;
  `;

  const values = [
    String(tabela),
    register_id,
    String(operation),
    user_id,
    before !== null
      ? JSON.stringify(before)
      : null,
    after !== null
      ? JSON.stringify(after)
      : null,
  ];

  const { rows } = await db.query(sql, values);

  return rows[0] || null;
}

/**
 * Lista registros da auditoria com filtros e paginação.
 */
export async function listAuditLogs({
  tabela = null,
  register_id = null,
  operation = null,
  limit = 50,
  offset = 0,
} = {}) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (tabela) {
    conditions.push(
      `tabela = $${paramIndex++}`
    );

    values.push(String(tabela));
  }

  if (
    register_id !== null &&
    register_id !== undefined
  ) {
    conditions.push(
      `register_id = $${paramIndex++}`
    );

    values.push(register_id);
  }

  if (operation) {
    conditions.push(
      `operation = $${paramIndex++}`
    );

    values.push(String(operation));
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const normalizedLimit = Math.min(
    200,
    Math.max(1, Number(limit) || 50)
  );

  const normalizedOffset = Math.max(
    0,
    Number(offset) || 0
  );

  values.push(normalizedLimit);
  const limitParameter = paramIndex++;

  values.push(normalizedOffset);
  const offsetParameter = paramIndex++;

  const sql = `
    SELECT
      id,
      tabela,
      register_id,
      operation,
      user_id,
      before,
      after,
      created_at
    FROM public."auditLogs"
    ${where}
    ORDER BY created_at DESC
    LIMIT $${limitParameter}
    OFFSET $${offsetParameter};
  `;

  const { rows } = await pool.query(
    sql,
    values
  );

  return rows;
}

export default {
  createAuditLog,
  listAuditLogs,
};