// ╔════════════════════════════════════════════════════════════════════╗
// ║ databaseUpdate.repository.js — updateRow (por chave primária)      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { DEFAULT_SCHEMA } from './database.constants.js';
import { assertSchemaAllowed, assertTableAllowed, coerceEntries, maskRow, quoteIdent } from './database.sanitizers.js';
import { dropMaskedEntries, withRowAudit } from './databaseRowAudit.js';
import { getTableColumns } from './databaseSchema.repository.js';

function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// WHERE pela PK original; params recebe os valores a partir de params.length + 1
export function buildPkWhere(pkColumns, pk, params) {
  if (!pk || typeof pk !== 'object' || Array.isArray(pk)) {
    throw badRequest('Chave primária inválida.');
  }

  return pkColumns.map((col) => {
    if (!(col in pk)) throw badRequest(`Chave primária incompleta. Campo ausente: ${col}`);

    params.push(pk[col]);
    return `${quoteIdent(col)} = $${params.length}`;
  }).join(' AND ');
}

export async function updateRow({ schema = DEFAULT_SCHEMA, table, pk, data, userId = null }) {
  const schemaName = assertSchemaAllowed(schema);
  const tableName = assertTableAllowed(table);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badRequest('Dados inválidos para atualização.');
  }

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const allowedColumns = new Set(columnsInfo.columns.map((c) => c.column_name));
  const pkColumns = columnsInfo.primaryKey;

  if (!pkColumns.length) {
    throw badRequest('Esta tabela não possui chave primária. Edição bloqueada.');
  }

  // Colunas da PK também podem ser alteradas: o WHERE usa o valor original (pk)
  const entries = coerceEntries(
    columnsInfo.columns,
    dropMaskedEntries(Object.entries(data).filter(([key]) => allowedColumns.has(key)))
  );

  if (!entries.length) {
    throw badRequest('Nenhuma alteração para salvar.');
  }

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  const selectParams = [];
  const selectWhere = buildPkWhere(pkColumns, pk, selectParams);

  const params = entries.map(([, value]) => value);
  const setSql = entries.map(([key], index) => `${quoteIdent(key)} = $${index + 1}`);
  const whereSql = buildPkWhere(pkColumns, pk, params);

  return withRowAudit(
    { schemaName, tableName, pkColumns, operation: 'UPDATE', userId },
    async (client) => {
      const current = await client.query(`SELECT * FROM ${fullTable} WHERE ${selectWhere} FOR UPDATE`, selectParams);

      if (!current.rows.length) throw badRequest('Registro não encontrado para atualização.', 404);

      const { rows } = await client.query(
        `UPDATE ${fullTable} SET ${setSql.join(', ')} WHERE ${whereSql} RETURNING *`,
        params
      );

      return { before: current.rows[0], after: rows[0], result: maskRow(rows[0]) };
    }
  );
}
