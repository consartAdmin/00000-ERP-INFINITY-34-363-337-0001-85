// ╔════════════════════════════════════════════════════════════════════╗
// ║ databaseQuery.repository.js — countTableRows / getTableRows        ║
// ║ (leitura paginada de qualquer tabela permitida)                    ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { DEFAULT_SCHEMA } from './database.constants.js';
import {
  assertSchemaAllowed,
  assertTableAllowed,
  escapeLike,
  isSensitiveColumn,
  maskRow,
  quoteIdent,
} from './database.sanitizers.js';
import { getTableColumns } from './databaseSchema.repository.js';

// Tipos que não fazem sentido pesquisar como texto
const NOT_SEARCHABLE_TYPES = new Set(['bytea']);

// Pesquisa em todas as colunas (inclusive números, datas e booleanos, via ::text),
// menos binárias e sensíveis. Devolve o WHERE e já coloca o termo em params.
function buildSearchWhere(columns, search, params) {
  const term = String(search || '').trim();
  if (!term) return '';

  const searchable = columns.filter((c) =>
    !NOT_SEARCHABLE_TYPES.has(c.data_type) && !isSensitiveColumn(c.column_name)
  );

  if (!searchable.length) return '';

  params.push(`%${escapeLike(term)}%`);
  const ref = `$${params.length}`;

  return `WHERE ${searchable
    .map((c) => `${quoteIdent(c.column_name)}::text ILIKE ${ref}`)
    .join(' OR ')}`;
}

export async function countTableRows({ schema = DEFAULT_SCHEMA, table, search = '', columnsInfo = null }) {
  const schemaName = assertSchemaAllowed(schema);
  const tableName = assertTableAllowed(table);
  const info = columnsInfo || await getTableColumns({ schema: schemaName, table: tableName });

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
  const params = [];
  const whereSql = buildSearchWhere(info.columns, search, params);

  const { rows } = await pool.query(`SELECT COUNT(*)::bigint AS total FROM ${fullTable} ${whereSql}`, params);
  return Number(rows[0]?.total || 0);
}

export async function getTableRows({
  schema = DEFAULT_SCHEMA,
  table,
  page = 1,
  limit = 50,
  search = '',
  orderBy = '',
  orderDir = 'ASC',
}) {
  const schemaName = assertSchemaAllowed(schema);
  const tableName = assertTableAllowed(table);

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = (safePage - 1) * safeLimit;

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const columnNames = columnsInfo.columns.map((c) => c.column_name);

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  const params = [];
  const whereSql = buildSearchWhere(columnsInfo.columns, search, params);

  let orderSql = '';
  if (orderBy && columnNames.includes(orderBy)) {
    const dir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    orderSql = `ORDER BY ${quoteIdent(orderBy)} ${dir}`;
  } else if (columnsInfo.primaryKey.length) {
    // Ordena pela PK inteira: com PK composta a paginação fica estável
    orderSql = `ORDER BY ${columnsInfo.primaryKey.map((c) => quoteIdent(c)).join(', ')}`;
  }

  params.push(safeLimit, offset);

  const sql = `
    SELECT *
    FROM ${fullTable}
    ${whereSql}
    ${orderSql}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const [{ rows }, total] = await Promise.all([
    pool.query(sql, params),
    countTableRows({ schema: schemaName, table: tableName, search, columnsInfo }),
  ]);

  return {
    schema: schemaName,
    table: tableName,
    page: safePage,
    limit: safeLimit,
    total,
    primaryKey: columnsInfo.primaryKey,
    columns: columnsInfo.columns,
    maskedColumns: columnsInfo.maskedColumns,
    rows: rows.map(maskRow),
  };
}
