// ╔════════════════════════════════════════════════════════════════════╗
// ║ databaseRemove.repository.js — deleteRow (por chave primária)      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { DEFAULT_SCHEMA } from './database.constants.js';
import { assertSchemaAllowed, assertTableAllowed, maskRow, quoteIdent } from './database.sanitizers.js';
import { withRowAudit } from './databaseRowAudit.js';
import { getTableColumns } from './databaseSchema.repository.js';
import { buildPkWhere } from './databaseUpdate.repository.js';

export async function deleteRow({ schema = DEFAULT_SCHEMA, table, pk, userId = null }) {
  const schemaName = assertSchemaAllowed(schema);
  const tableName = assertTableAllowed(table);

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const pkColumns = columnsInfo.primaryKey;

  if (!pkColumns.length) {
    const err = new Error('Esta tabela não possui chave primária. Exclusão bloqueada.');
    err.status = 400;
    throw err;
  }

  const params = [];
  const whereSql = buildPkWhere(pkColumns, pk, params);
  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  return withRowAudit(
    { schemaName, tableName, pkColumns, operation: 'DELETE', userId },
    async (client) => {
      const { rows } = await client.query(`DELETE FROM ${fullTable} WHERE ${whereSql} RETURNING *`, params);

      if (!rows.length) {
        const err = new Error('Registro não encontrado para exclusão.');
        err.status = 404;
        throw err;
      }

      return { before: rows[0], result: maskRow(rows[0]) };
    }
  );
}
