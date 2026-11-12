// ╔════════════════════════════════════════════════════════════════════╗
// ║ databaseCreate.repository.js — insertRow                           ║
// ╚════════════════════════════════════════════════════════════════════╝

import { DEFAULT_SCHEMA } from './database.constants.js';
import { assertSchemaAllowed, assertTableAllowed, coerceEntries, maskRow, quoteIdent } from './database.sanitizers.js';
import { dropMaskedEntries, withRowAudit } from './databaseRowAudit.js';
import { getTableColumns } from './databaseSchema.repository.js';

export async function insertRow({ schema = DEFAULT_SCHEMA, table, data, userId = null }) {
  const schemaName = assertSchemaAllowed(schema);
  const tableName = assertTableAllowed(table);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const err = new Error('Dados inválidos para inserção.');
    err.status = 400;
    throw err;
  }

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const allowedColumns = new Set(columnsInfo.columns.map((c) => c.column_name));

  const entries = coerceEntries(
    columnsInfo.columns,
    dropMaskedEntries(Object.entries(data).filter(([key]) => allowedColumns.has(key)))
  );

  if (!entries.length) {
    const err = new Error('Preencha ao menos um campo.');
    err.status = 400;
    throw err;
  }

  const cols = entries.map(([key]) => quoteIdent(key));
  const params = entries.map(([, value]) => value);
  const placeholders = params.map((_, i) => `$${i + 1}`);

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  const sql = `
    INSERT INTO ${fullTable} (${cols.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  return withRowAudit(
    { schemaName, tableName, pkColumns: columnsInfo.primaryKey, operation: 'INSERT', userId },
    async (client) => {
      const { rows } = await client.query(sql, params);
      return { after: rows[0], result: maskRow(rows[0]) };
    }
  );
}
