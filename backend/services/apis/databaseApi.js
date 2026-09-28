// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: backend/services/apis/databaseApi.js                          ║
// ║ MODULE: Database Viewer / Editor                                    ║
// ║ CONSART ERP | PostgreSQL | ESM                                      ║
// ║ OBJETIVO: Visualizar e editar tabelas do banco com segurança         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const DEFAULT_SCHEMA = 'public';

const BLOCKED_TABLES = new Set([
  'cadastro_usuarios',
  'users',
  'sessions',
  'tokens',
  'passwords',
  'knex_migrations',
  'sequelize_meta',
]);

function assertSafeIdentifier(value, label = 'identificador') {
  const v = String(value || '').trim();

  if (!v) {
    const err = new Error(`${label} obrigatório.`);
    err.status = 400;
    throw err;
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) {
    const err = new Error(`${label} inválido: ${v}`);
    err.status = 400;
    throw err;
  }

  return v;
}

function quoteIdent(value) {
  const safe = assertSafeIdentifier(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

function assertTableAllowed(tableName) {
  const safeTable = assertSafeIdentifier(tableName, 'Tabela');

  if (BLOCKED_TABLES.has(safeTable)) {
    const err = new Error(`Tabela bloqueada por segurança: ${safeTable}`);
    err.status = 403;
    throw err;
  }

  return safeTable;
}

async function getPrimaryKey(schemaName, tableName) {

  const sql = `
    SELECT
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2
    ORDER BY kcu.ordinal_position
  `;

  const { rows } = await pool.query(sql, [
    schemaName,
    tableName
  ]);

  return rows.map(r => r.column_name);
}

export async function listTables({ schema = DEFAULT_SCHEMA } = {}) {
  const schemaName = assertSafeIdentifier(schema, 'Schema');

  const sql = `
    SELECT 
      table_schema,
      table_name,
      table_type
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `;

  const { rows } = await pool.query(sql, [schemaName]);

  return rows.filter((r) => !BLOCKED_TABLES.has(r.table_name));
}

export async function getTableColumns({ schema = DEFAULT_SCHEMA, table }) {
  const schemaName = assertSafeIdentifier(schema, 'Schema');
  const tableName = assertTableAllowed(table);

  const sql = `
    SELECT
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position ASC
  `;

  const { rows } = await pool.query(sql, [schemaName, tableName]);
  const primaryKey = await getPrimaryKey(schemaName, tableName);

  return {
    schema: schemaName,
    table: tableName,
    primaryKey,
    columns: rows,
  };
}

export async function countTableRows({ schema = DEFAULT_SCHEMA, table, search = '' }) {
  const schemaName = assertSafeIdentifier(schema, 'Schema');
  const tableName = assertTableAllowed(table);

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  let sql = `SELECT COUNT(*)::bigint AS total FROM ${fullTable}`;
  const params = [];

  if (search) {
    const columns = await getTableColumns({ schema: schemaName, table: tableName });
    const textColumns = columns.columns.filter((c) =>
      ['character varying', 'text', 'char', 'uuid'].includes(c.data_type)
    );

    if (textColumns.length) {
      params.push(`%${search}%`);
      const where = textColumns
        .map((c) => `${quoteIdent(c.column_name)}::text ILIKE $1`)
        .join(' OR ');
      sql += ` WHERE ${where}`;
    }
  }

  const { rows } = await pool.query(sql, params);
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
  const schemaName = assertSafeIdentifier(schema, 'Schema');
  const tableName = assertTableAllowed(table);

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = (safePage - 1) * safeLimit;

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const columnNames = columnsInfo.columns.map((c) => c.column_name);

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  const params = [];
  let whereSql = '';

  if (search) {
    const textColumns = columnsInfo.columns.filter((c) =>
      ['character varying', 'text', 'char', 'uuid'].includes(c.data_type)
    );

    if (textColumns.length) {
      params.push(`%${search}%`);
      whereSql = `WHERE ${textColumns
        .map((c) => `${quoteIdent(c.column_name)}::text ILIKE $1`)
        .join(' OR ')}`;
    }
  }

  let orderSql = '';
  if (orderBy && columnNames.includes(orderBy)) {
    const dir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    orderSql = `ORDER BY ${quoteIdent(orderBy)} ${dir}`;
  } else if (columnsInfo.primaryKey.length) {
    orderSql = `ORDER BY ${quoteIdent(columnsInfo.primaryKey[0])} ASC`;
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

  const { rows } = await pool.query(sql, params);
  const total = await countTableRows({ schema: schemaName, table: tableName, search });

  return {
    schema: schemaName,
    table: tableName,
    page: safePage,
    limit: safeLimit,
    total,
    primaryKey: columnsInfo.primaryKey,
    columns: columnsInfo.columns,
    rows,
  };
}

export async function insertRow({ schema = DEFAULT_SCHEMA, table, data }) {
  const schemaName = assertSafeIdentifier(schema, 'Schema');
  const tableName = assertTableAllowed(table);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const err = new Error('Dados inválidos para inserção.');
    err.status = 400;
    throw err;
  }

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const allowedColumns = new Set(columnsInfo.columns.map((c) => c.column_name));

  const entries = Object.entries(data).filter(([key]) => allowedColumns.has(key));

  if (!entries.length) {
    const err = new Error('Nenhuma coluna válida enviada.');
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

  const { rows } = await pool.query(sql, params);
  return rows[0];
}

export async function updateRow({ schema = DEFAULT_SCHEMA, table, pk, data }) {
  const schemaName = assertSafeIdentifier(schema, 'Schema');
  const tableName = assertTableAllowed(table);

  if (!pk || typeof pk !== 'object') {
    const err = new Error('Chave primária inválida.');
    err.status = 400;
    throw err;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const err = new Error('Dados inválidos para atualização.');
    err.status = 400;
    throw err;
  }

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const allowedColumns = new Set(columnsInfo.columns.map((c) => c.column_name));

  const pkColumns = columnsInfo.primaryKey;

  if (!pkColumns.length) {
    const err = new Error('Esta tabela não possui chave primária. Edição bloqueada.');
    err.status = 400;
    throw err;
  }

  for (const col of pkColumns) {
    if (!(col in pk)) {
      const err = new Error(`Chave primária incompleta. Campo ausente: ${col}`);
      err.status = 400;
      throw err;
    }
  }

  const entries = Object.entries(data).filter(
    ([key]) => allowedColumns.has(key) && !pkColumns.includes(key)
  );

  if (!entries.length) {
    const err = new Error('Nenhuma coluna válida para atualizar.');
    err.status = 400;
    throw err;
  }

  const params = [];
  const setSql = entries.map(([key, value], index) => {
    params.push(value);
    return `${quoteIdent(key)} = $${index + 1}`;
  });

  const whereSql = pkColumns.map((col) => {
    params.push(pk[col]);
    return `${quoteIdent(col)} = $${params.length}`;
  });

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  const sql = `
    UPDATE ${fullTable}
    SET ${setSql.join(', ')}
    WHERE ${whereSql.join(' AND ')}
    RETURNING *
  `;

  const { rows } = await pool.query(sql, params);

  if (!rows.length) {
    const err = new Error('Registro não encontrado para atualização.');
    err.status = 404;
    throw err;
  }

  return rows[0];
}

export async function deleteRow({ schema = DEFAULT_SCHEMA, table, pk }) {
  const schemaName = assertSafeIdentifier(schema, 'Schema');
  const tableName = assertTableAllowed(table);

  const columnsInfo = await getTableColumns({ schema: schemaName, table: tableName });
  const pkColumns = columnsInfo.primaryKey;

  if (!pkColumns.length) {
    const err = new Error('Esta tabela não possui chave primária. Exclusão bloqueada.');
    err.status = 400;
    throw err;
  }

  const params = [];
  const whereSql = pkColumns.map((col) => {
    if (!(col in pk)) {
      const err = new Error(`Chave primária incompleta. Campo ausente: ${col}`);
      err.status = 400;
      throw err;
    }

    params.push(pk[col]);
    return `${quoteIdent(col)} = $${params.length}`;
  });

  const fullTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

  const sql = `
    DELETE FROM ${fullTable}
    WHERE ${whereSql.join(' AND ')}
    RETURNING *
  `;

  const { rows } = await pool.query(sql, params);

  if (!rows.length) {
    const err = new Error('Registro não encontrado para exclusão.');
    err.status = 404;
    throw err;
  }

  return rows[0];
}