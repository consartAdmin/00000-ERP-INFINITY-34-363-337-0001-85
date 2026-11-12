// ╔════════════════════════════════════════════════════════════════════╗
// ║ databaseRowAudit.js — Auditoria das alterações de registros       ║
// ║ Inserir / editar / excluir pela tela Banco de Dados grava em       ║
// ║ auditLogs na mesma transação (valores sensíveis mascarados).       ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { createAuditLog } from '../auditLogs/auditLogs.index.js';
import { MASKED_VALUE } from './database.constants.js';
import { isSensitiveColumn, maskRow } from './database.sanitizers.js';

// register_id só quando a PK é uma coluna inteira (ex.: customer_id = 15)
function registerIdFrom(pkColumns, row) {
  if (pkColumns.length !== 1 || !row) return null;

  const value = Number(row[pkColumns[0]]);
  return Number.isSafeInteger(value) ? value : null;
}

// Tira do payload o "••••••" que a tela mostra nas colunas sensíveis:
// se ele voltar, significa "não mexi", e o valor real fica como está.
export function dropMaskedEntries(entries) {
  return entries.filter(([key, value]) => !(isSensitiveColumn(key) && value === MASKED_VALUE));
}

// Executa fn(client) numa transação e registra a auditoria antes do COMMIT
export async function withRowAudit({ schemaName, tableName, pkColumns, operation, userId }, fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { before = null, after = null, result } = await fn(client);

    await createAuditLog({
      tabela: `${schemaName}.${tableName}`,
      register_id: registerIdFrom(pkColumns, after || before),
      operation: `DB_${operation}`,
      user_id: userId ?? null,
      before: before ? maskRow(before) : null,
      after: after ? maskRow(after) : null,
      db: client,
    });

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    // Erros do PostgreSQL (NOT NULL, FK, tipo inválido...) voltam como 400 com a mensagem original
    if (err.code && !err.status) {
      err.status = 400;
      err.message = `PostgreSQL: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`;
    }

    throw err;
  } finally {
    client.release();
  }
}
