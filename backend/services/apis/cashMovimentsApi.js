// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/services/apis/cashMovimentsApi.js                           ║
// ║ Acesso ao Postgres (CRUD + consultas do módulo Caixa)               ║
// ║ CONSART ERP | ESM                                                    ║
// ║ ✅ Usa tabelas/colunas novas em inglês                               ║
// ║ ✅ Mantém aliases antigos para compatibilidade com controller/front   ║
// ║ ✅ Suporta is_deductible por movimentação                            ║
// ║ ✅ Respeita fallback da subcategoria para DRE                        ║
// ║ ✅ Copia anexos do AccountsPayable para GCS no padrão do Caixa       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import pool from '../../config/db.js';

const BUCKET_NAME = process.env.GCS_BUCKET || 'erp-infinity-00000';
const CAIXA_PREFIX = (process.env.CAIXA_PREFIX || 'cashMoviments').replace(/^\/+|\/+$/g, '');
const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

const storage = new Storage(PROJECT_ID ? { projectId: PROJECT_ID } : undefined);

async function q(text, params = []) {
  return pool.query(text, params);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function slugifyFileName(name) {
  return String(name || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function buildCaixaObjectPath({ movimentacao_id, filename, date = new Date() }) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const safe = slugifyFileName(filename);
  const ts = Math.floor(Date.now() / 1000);

  return `${CAIXA_PREFIX}/${y}/${m}/${d}/mov-${movimentacao_id}/${ts}-${safe}`;
}

function resolvePublicFile(fileUrl) {
  const raw = String(fileUrl || '').trim();

  if (raw.startsWith('/public/')) {
    const relative = raw.replace(/^\/public\//, '');

    const candidates = [
      path.resolve(process.cwd(), 'public', relative),
      path.resolve(process.cwd(), 'backend', 'public', relative),
    ];

    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  if (raw.startsWith('https://storage.googleapis.com/')) {
    return raw;
  }

  return null;
}

function normalizeOrderColumn(col) {
  const map = {
    data_hora: 'movement_date',
    tipo_movimentacao: 'movement_type',
    conta_caixa: 'cash_account',
    valor: 'amount',

    movement_date: 'movement_date',
    movement_type: 'movement_type',
    cash_account: 'cash_account',
    amount: 'amount',
  };

  return map[col] || col;
}

function parseOrder(orderBy, allowed = []) {
  if (!orderBy) return '';

  const [rawCol, dirRaw] = String(orderBy).trim().split(/\s+/);
  const col = normalizeOrderColumn(rawCol);
  const colSafe = allowed.includes(col) ? col : null;
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';

  return colSafe ? ` ORDER BY m.${colSafe} ${dir} ` : '';
}

function normalizeTipoMovimentacao(v) {
  if (v == null) return null;

  const raw = String(v).trim();
  if (!raw) return null;

  const up = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();

  if (up.startsWith('ENTR')) return 'ENTRADA';
  if (up.startsWith('SAID')) return 'SAIDA';

  return up;
}

function toBool(v, def = true) {
  if (v === undefined) return def;
  if (v === null) return null;
  if (typeof v === 'boolean') return v;

  const s = String(v).trim().toLowerCase();

  if (['1', 'true', 't', 'yes', 'sim', 'y'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'nao', 'não', 'n'].includes(s)) return false;

  return def;
}

function getPayloadValue(payload, keys = []) {
  for (const key of keys) {
    if (payload?.[key] !== undefined) return payload[key];
  }

  return undefined;
}

function getMovementPayloadValue(payload, column) {
  const map = {
    movement_date: ['movement_date', 'data_hora'],
    movement_type: ['movement_type', 'tipo_movimentacao'],
    cash_account: ['cash_account', 'conta_caixa'],
    amount: ['amount', 'valor'],
    document_type: ['document_type', 'tipo_documento'],
    document_number: ['document_number', 'numero_documento'],
    supplier_name: ['supplier_name', 'fornecedor'],
    notes: ['notes', 'observacao'],
    penalty_amount: ['penalty_amount', 'multa'],
    interest_amount: ['interest_amount', 'juros'],
    fee_amount: ['fee_amount', 'encargos'],
    category: ['category', 'categoria'],
    subcategory: ['subcategory', 'subcategoria'],
    is_deductible: ['is_deductible'],
    is_active: ['is_active'],
  };

  return getPayloadValue(payload, map[column] || [column]);
}

function toBankAccountId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * SQL do bank_account_id da movimentação:
 * 1) ID informado (se existir em "bankAccounts")
 * 2) conta bancária com o mesmo nome de cash_account (sem diferenciar maiúsculas)
 */
function bankAccountIdSql(idParam, nameParam) {
  return `COALESCE(
    (SELECT ba.id FROM "bankAccounts" ba WHERE ba.id = ${idParam}::bigint),
    (
      SELECT ba.id
      FROM "bankAccounts" ba
      WHERE UPPER(TRIM(ba.name)) = UPPER(TRIM(${nameParam}::varchar))
      ORDER BY ba.is_active DESC, ba.id ASC
      LIMIT 1
    )
  )`;
}

function movementTypeSql() {
  return `
    CASE
      WHEN translate(upper(m.movement_type),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC') LIKE 'ENTR%' THEN 'ENTRADA'
      WHEN translate(upper(m.movement_type),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC') LIKE 'SAID%' THEN 'SAIDA'
      ELSE translate(upper(m.movement_type),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC')
    END
  `;
}

function movementSelectSql({ includeAll = false } = {}) {
  const allFields = includeAll
    ? `
      m.movement_date,
      m.movement_type,
      m.cash_account,
      m.amount,
      m.document_type,
      m.document_number,
      m.supplier_name,
      m.notes,
      m.penalty_amount,
      m.interest_amount,
      m.fee_amount,
      m.category,
      m.subcategory,
      m.chart_account_id,
      m.bank_account_id,
    `
    : '';

  return `
    SELECT
      m.id,

      ${allFields}

      m.movement_date AS data_hora,
      m.movement_type AS tipo_movimentacao,
      m.cash_account AS conta_caixa,
      m.amount AS valor,
      m.document_type AS tipo_documento,
      m.document_number AS numero_documento,
      m.supplier_name AS fornecedor,
      m.notes AS observacao,
      m.penalty_amount AS multa,
      m.interest_amount AS juros,
      m.fee_amount AS encargos,
      m.category AS categoria,
      c.name AS categoria_nome,
      m.subcategory AS subcategoria,
      s.name AS subcategoria_nome,

      m.chart_account_id,
      coa.code AS chart_account_code,
      coa.description AS chart_account_description,
      coa.account_type AS chart_account_type,
      coa.nature AS chart_account_nature,

      m.is_deductible,
      s.is_deductible AS subcategoria_is_deductible,
      COALESCE(m.is_deductible, s.is_deductible, FALSE) AS is_deductible_final,
      s.dre_type AS dre_tipo,

      m.created_at,
      m.updated_at,
      m.is_active
    FROM "cashMoviments" m
    LEFT JOIN "cashCategories" c
      ON c.id::text = m.category::text
      OR UPPER(TRIM(c.name)) = UPPER(TRIM(m.category::text))
    LEFT JOIN "cashSubcategories" s
      ON s.id::text = m.subcategory::text
      OR UPPER(TRIM(s.name)) = UPPER(TRIM(m.subcategory::text))
    LEFT JOIN "chartOfAccounts" coa
      ON coa.id = m.chart_account_id
  `;
}

function buildMovementsWhere({
  date_from,
  date_to,
  tipo,
  conta,
  categoria,
  subcategoria,
  search,
  anexos,
}) {
  const where = [];
  const params = [];
  let i = 1;

  if (date_from) {
    where.push(`m.movement_date >= $${i++}`);
    params.push(date_from);
  }

  if (date_to) {
    where.push(`m.movement_date <= $${i++}`);
    params.push(date_to);
  }

  const tipoNorm = normalizeTipoMovimentacao(tipo);

  if (tipoNorm) {
    where.push(`(${movementTypeSql()}) = $${i++}`);
    params.push(tipoNorm);
  }

  if (conta) {
    where.push(`
      (
        UPPER(TRIM(m.cash_account::text)) = UPPER(TRIM($${i}::text))
        OR EXISTS (
          SELECT 1
          FROM "bankAccounts" ba
          WHERE ba.id::text = $${i}::text
            AND UPPER(TRIM(ba.name)) = UPPER(TRIM(m.cash_account::text))
        )
      )
    `);
    params.push(String(conta));
    i++;
  }

  if (categoria) {
    where.push(`
      (
        m.category::text = $${i}::text
        OR m.category::text ILIKE (
          SELECT c.name
          FROM "cashCategories" c
          WHERE c.id::text = $${i}::text
        )
      )
    `);
    params.push(String(categoria));
    i++;
  }

  if (subcategoria) {
    where.push(`
      (
        m.subcategory::text = $${i}::text
        OR m.subcategory::text ILIKE (
          SELECT s.name
          FROM "cashSubcategories" s
          WHERE s.id::text = $${i}::text
        )
      )
    `);
    params.push(String(subcategoria));
    i++;
  }

  if (search) {
    where.push(`(
      m.supplier_name ILIKE $${i}
      OR m.notes ILIKE $${i}
      OR m.document_number ILIKE $${i}
    )`);
    params.push(`%${search}%`);
    i++;
  }

  if (anexos === 'com') {
    where.push(`
      EXISTS (
        SELECT 1
        FROM "cashMovimentsAttachments" a
        WHERE a.cash_movement_id = m.id
      )
    `);
  } else if (anexos === 'sem') {
    where.push(`
      NOT EXISTS (
        SELECT 1
        FROM "cashMovimentsAttachments" a
        WHERE a.cash_movement_id = m.id
      )
    `);
  }

  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')} ` : '';
  return { sqlWhere, params };
}

/* =========================================================================
   MOVIMENTAÇÕES
============================================================================*/

export async function listMovements({
  date_from,
  date_to,
  tipo,
  conta,
  categoria,
  subcategoria,
  search,
  anexos,
  limit = 50,
  offset = 0,
  orderBy = 'movement_date DESC',
} = {}) {
  const allowedOrder = ['movement_date', 'amount', 'movement_type', 'cash_account'];
  const order = parseOrder(orderBy, allowedOrder);

  const { sqlWhere, params } = buildMovementsWhere({
    date_from,
    date_to,
    tipo,
    conta,
    categoria,
    subcategoria,
    search,
    anexos,
  });

  const base = `
    ${movementSelectSql()}
    ${sqlWhere}
    ${order}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const res = await q(base, [...params, Number(limit), Number(offset)]);

  const countSql = `
    SELECT COUNT(*) AS total
    FROM "cashMoviments" m
    LEFT JOIN "cashCategories" c
      ON c.id::text = m.category::text
      OR UPPER(TRIM(c.name)) = UPPER(TRIM(m.category::text))
    LEFT JOIN "cashSubcategories" s
      ON s.id::text = m.subcategory::text
      OR UPPER(TRIM(s.name)) = UPPER(TRIM(m.subcategory::text))
    ${sqlWhere}
  `;

  const count = await q(countSql, params);

  return {
    items: res.rows,
    total: Number(count.rows?.[0]?.total || 0),
    limit: Number(limit),
    offset: Number(offset),
  };
}

export async function listForPdf({
  date_from,
  date_to,
  tipo,
  conta,
  categoria,
  subcategoria,
  search,
  anexos,
  orderBy = 'movement_date ASC',
} = {}) {
  const allowedOrder = ['movement_date', 'amount', 'movement_type', 'cash_account'];
  const order = parseOrder(orderBy, allowedOrder);

  const { sqlWhere, params } = buildMovementsWhere({
    date_from,
    date_to,
    tipo,
    conta,
    categoria,
    subcategoria,
    search,
    anexos,
  });

  const sql = `
    SELECT
      m.id,
      m.movement_date AS data_hora,
      m.movement_type AS tipo_movimentacao,
      m.cash_account AS conta_caixa,
      m.document_type AS tipo_documento,
      m.document_number AS numero_documento,

      m.chart_account_id,
      coa.code AS chart_account_code,
      coa.description AS chart_account_description,

      COALESCE(
        NULLIF(CONCAT(coa.code, ' - ', coa.description), ' - '),
        'Não Informado'
      ) AS plano_contas,

      m.supplier_name AS fornecedor,
      m.notes AS observacao,
      m.amount AS valor,
      m.penalty_amount AS multa,
      m.interest_amount AS juros,
      m.fee_amount AS encargos,

      m.is_deductible,
      s.is_deductible AS subcategoria_is_deductible,
      COALESCE(m.is_deductible, s.is_deductible, FALSE) AS is_deductible_final,
      s.dre_type AS dre_tipo,

      (
        SELECT COUNT(*)::int
        FROM "cashMovimentsAttachments" a
        WHERE a.cash_movement_id = m.id
      ) AS anexos_count

    FROM "cashMoviments" m

    LEFT JOIN "cashCategories" c
      ON c.id::text = m.category::text
      OR UPPER(TRIM(c.name)) = UPPER(TRIM(m.category::text))

    LEFT JOIN "cashSubcategories" s
      ON s.id::text = m.subcategory::text
      OR UPPER(TRIM(s.name)) = UPPER(TRIM(m.subcategory::text))

    LEFT JOIN "chartOfAccounts" coa
      ON coa.id = m.chart_account_id

    ${sqlWhere}
    ${order}
  `;

  const res = await q(sql, params);

  return res.rows.map((r) => ({
    ...r,
    tem_anexo: Number(r.anexos_count || 0) > 0,
  }));
}

export async function getMovementById(id) {
  const sql = `
    ${movementSelectSql({ includeAll: true })}
    WHERE m.id = $1
  `;

  const res = await q(sql, [Number(id)]);
  return res.rows[0] || null;
}

export async function createMovement(payload = {}) {
  const cols = [
    'movement_date',
    'movement_type',
    'cash_account',
    'amount',
    'document_type',
    'document_number',
    'supplier_name',
    'notes',
    'penalty_amount',
    'interest_amount',
    'fee_amount',
    'category',
    'subcategory',
    'chart_account_id',
    'is_deductible',
    'is_active',
  ];

  const vals = cols.map((_, i) => `$${i + 1}`);

  const params = cols.map((c) => {
    const value = getMovementPayloadValue(payload, c);

    if (c === 'is_active') {
      return value === undefined ? true : !!value;
    }

    if (c === 'is_deductible') {
      return value === undefined ? null : toBool(value, null);
    }

    if (c === 'movement_type') {
      return normalizeTipoMovimentacao(value);
    }

    if (c === 'chart_account_id') {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }

    return value ?? null;
  });

  // bank_account_id: ID enviado (ex.: Contas a Pagar) ou resolvido pelo nome da conta
  const cashAccountParam = cols.indexOf('cash_account') + 1;
  params.push(toBankAccountId(payload.bank_account_id));
  const bankAccountSql = bankAccountIdSql(`$${params.length}`, `$${cashAccountParam}`);

  const sql = `
    INSERT INTO "cashMoviments" (${cols.join(',')}, bank_account_id)
    VALUES (${vals.join(',')}, ${bankAccountSql})
    RETURNING *
  `;

  const res = await q(sql, params);
  return getMovementById(res.rows[0].id);
}

export async function updateMovement(id, payload = {}) {
  const cols = [
    'movement_date',
    'movement_type',
    'cash_account',
    'amount',
    'document_type',
    'document_number',
    'supplier_name',
    'notes',
    'penalty_amount',
    'interest_amount',
    'fee_amount',
    'category',
    'subcategory',
    'chart_account_id',
    'is_deductible',
    'is_active',
  ];

  const sets = [];
  const params = [];
  let i = 1;

  for (const c of cols) {
    const v = getMovementPayloadValue(payload, c);
    if (v === undefined) continue;

    if (c === 'is_active') {
      sets.push(`${c} = $${i++}`);
      params.push(v === null ? null : !!v);
      continue;
    }

    if (c === 'is_deductible') {
      sets.push(`${c} = $${i++}`);
      params.push(v === null ? null : toBool(v, null));
      continue;
    }

    if (c === 'movement_type') {
      sets.push(`${c} = $${i++}`);
      params.push(normalizeTipoMovimentacao(v));
      continue;
    }

    sets.push(`${c} = $${i++}`);
    params.push(v);
  }

  // bank_account_id acompanha a conta: ID enviado, ou pelo novo nome da conta.
  // Nome sem conta cadastrada mantém o vínculo atual se o nome não mudou.
  const newCashAccount = getMovementPayloadValue(payload, 'cash_account');
  if (payload.bank_account_id !== undefined || newCashAccount !== undefined) {
    const idParam = `$${i++}`;
    params.push(toBankAccountId(payload.bank_account_id));
    const nameParam = `$${i++}`;
    params.push(newCashAccount ?? null);
    sets.push(`bank_account_id = COALESCE(
      ${bankAccountIdSql(idParam, nameParam)},
      CASE WHEN UPPER(TRIM(cash_account)) = UPPER(TRIM(${nameParam}::varchar)) THEN bank_account_id END
    )`);
  }

  if (!sets.length) return getMovementById(id);

  sets.push('updated_at = now()');

  const sql = `
    UPDATE "cashMoviments"
    SET ${sets.join(', ')}
    WHERE id = $${i}
    RETURNING id
  `;

  const res = await q(sql, [...params, Number(id)]);
  const updatedId = res.rows?.[0]?.id;

  return updatedId ? getMovementById(updatedId) : null;
}

export async function deleteMovement(id) {
  await q(
    `DELETE FROM "cashMovimentsAttachments" WHERE cash_movement_id = $1`,
    [Number(id)]
  );

  const res = await q(
    `DELETE FROM "cashMoviments" WHERE id = $1 RETURNING id`,
    [Number(id)]
  );

  return res.rowCount > 0;
}

export async function summary({
  date_from,
  date_to,
  tipo,
  conta,
  categoria,
  subcategoria,
  search,
  anexos,
} = {}) {
  const { sqlWhere, params } = buildMovementsWhere({
    date_from,
    date_to,
    tipo,
    conta,
    categoria,
    subcategoria,
    search,
    anexos,
  });

  const typeSql = movementTypeSql();

  const sql = `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN (${typeSql}) = 'ENTRADA'
          THEN (
            m.amount
            + COALESCE(m.penalty_amount, 0)
            + COALESCE(m.interest_amount, 0)
            + COALESCE(m.fee_amount, 0)
          )
          ELSE 0
        END
      ), 0) AS total_entradas,

      COALESCE(SUM(
        CASE
          WHEN (${typeSql}) = 'SAIDA'
          THEN (
            m.amount
            + COALESCE(m.penalty_amount, 0)
            + COALESCE(m.interest_amount, 0)
            + COALESCE(m.fee_amount, 0)
          )
          ELSE 0
        END
      ), 0) AS total_saidas
    FROM "cashMoviments" m
    ${sqlWhere}
  `;

  const res = await q(sql, params);
  const row = res.rows[0] || { total_entradas: 0, total_saidas: 0 };
  const saldo = Number(row.total_entradas || 0) - Number(row.total_saidas || 0);

  return { ...row, saldo };
}

/* =========================================================================
   CATEGORIAS
============================================================================*/

export async function listCategorias() {
  const res = await q(
    `
    SELECT
      id,
      name,
      name AS nome,
      is_active,
      created_at,
      updated_at
    FROM "cashCategories"
    ORDER BY name ASC
    `
  );

  return res.rows;
}

export async function createCategoria({ nome, name, is_active = true }) {
  const finalName = name ?? nome;

  const res = await q(
    `
    INSERT INTO "cashCategories" (name, is_active)
    VALUES ($1, $2)
    RETURNING
      id,
      name,
      name AS nome,
      is_active,
      created_at,
      updated_at
    `,
    [finalName, is_active]
  );

  return res.rows[0];
}

export async function updateCategoria(id, { nome, name, is_active } = {}) {
  const sets = [];
  const params = [];
  let i = 1;

  const finalName = name ?? nome;

  if (finalName !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(finalName);
  }

  if (is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(is_active);
  }

  if (!sets.length) {
    const res = await q(
      `
      SELECT
        id,
        name,
        name AS nome,
        is_active,
        created_at,
        updated_at
      FROM "cashCategories"
      WHERE id = $1
      `,
      [Number(id)]
    );

    return res.rows[0] || null;
  }

  sets.push('updated_at = now()');

  const sql = `
    UPDATE "cashCategories"
    SET ${sets.join(', ')}
    WHERE id = $${i}
    RETURNING
      id,
      name,
      name AS nome,
      is_active,
      created_at,
      updated_at
  `;

  const res = await q(sql, [...params, Number(id)]);
  return res.rows[0] || null;
}

export async function deleteCategoria(id) {
  await q(`DELETE FROM "cashSubcategories" WHERE category_id = $1`, [Number(id)]);

  const res = await q(
    `DELETE FROM "cashCategories" WHERE id = $1 RETURNING id`,
    [Number(id)]
  );

  return res.rowCount > 0;
}

/* =========================================================================
   SUBCATEGORIAS
============================================================================*/

export async function listSubcategorias({ categoria_id, category_id } = {}) {
  const params = [];
  let where = '';

  const finalCategoryId = category_id ?? categoria_id;

  if (finalCategoryId) {
    where = ' WHERE category_id = $1 ';
    params.push(Number(finalCategoryId));
  }

  const res = await q(
    `
    SELECT
      id,
      category_id,
      category_id AS categoria_id,
      name,
      name AS nome,
      is_active,
      is_deductible,
      dre_type,
      dre_type AS dre_tipo,
      created_at,
      updated_at
    FROM "cashSubcategories"
    ${where}
    ORDER BY name ASC
    `,
    params
  );

  return res.rows;
}

export async function createSubcategoria({
  categoria_id,
  category_id,
  nome,
  name,
  is_active = true,
  is_deductible = true,
  dre_tipo = null,
  dre_type = null,
}) {
  const finalCategoryId = category_id ?? categoria_id;
  const finalName = name ?? nome;
  const finalDreType = dre_type ?? dre_tipo;

  const res = await q(
    `
    INSERT INTO "cashSubcategories"
    (
      category_id,
      name,
      is_active,
      is_deductible,
      dre_type
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id,
      category_id,
      category_id AS categoria_id,
      name,
      name AS nome,
      is_active,
      is_deductible,
      dre_type,
      dre_type AS dre_tipo,
      created_at,
      updated_at
    `,
    [
      Number(finalCategoryId),
      finalName,
      is_active,
      is_deductible ?? true,
      finalDreType,
    ]
  );

  return res.rows[0];
}

export async function updateSubcategoria(id, {
  categoria_id,
  category_id,
  nome,
  name,
  is_active,
  is_deductible,
  dre_tipo,
  dre_type,
} = {}) {
  const sets = [];
  const params = [];
  let i = 1;

  const finalCategoryId = category_id ?? categoria_id;
  const finalName = name ?? nome;
  const finalDreType = dre_type ?? dre_tipo;

  if (finalCategoryId !== undefined) {
    sets.push(`category_id = $${i++}`);
    params.push(Number(finalCategoryId));
  }

  if (finalName !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(finalName);
  }

  if (is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(is_active);
  }

  if (is_deductible !== undefined) {
    sets.push(`is_deductible = $${i++}`);
    params.push(is_deductible === null ? null : toBool(is_deductible, true));
  }

  if (finalDreType !== undefined) {
    sets.push(`dre_type = $${i++}`);
    params.push(finalDreType || null);
  }

  if (!sets.length) {
    const res = await q(
      `
      SELECT
        id,
        category_id,
        category_id AS categoria_id,
        name,
        name AS nome,
        is_active,
        is_deductible,
        dre_type,
        dre_type AS dre_tipo,
        created_at,
        updated_at
      FROM "cashSubcategories"
      WHERE id = $1
      `,
      [Number(id)]
    );

    return res.rows[0] || null;
  }

  sets.push('updated_at = now()');

  const sql = `
    UPDATE "cashSubcategories"
    SET ${sets.join(', ')}
    WHERE id = $${i}
    RETURNING
      id,
      category_id,
      category_id AS categoria_id,
      name,
      name AS nome,
      is_active,
      is_deductible,
      dre_type,
      dre_type AS dre_tipo,
      created_at,
      updated_at
  `;

  const res = await q(sql, [...params, Number(id)]);
  return res.rows[0] || null;
}

export async function deleteSubcategoria(id) {
  const res = await q(
    `DELETE FROM "cashSubcategories" WHERE id = $1 RETURNING id`,
    [Number(id)]
  );

  return res.rowCount > 0;
}

export async function listSubcategoriasByCategoria({
  categoria_id,
  category_id,
  incluirInativos = true,
} = {}) {
  const finalCategoryId = category_id ?? categoria_id;
  const catId = Number(finalCategoryId);

  if (!Number.isFinite(catId)) throw new Error('categoria_id inválido');

  const inc = toBool(incluirInativos, true);

  const sql = inc
    ? `
      SELECT
        id,
        category_id,
        category_id AS categoria_id,
        name,
        name AS nome,
        is_active,
        is_deductible,
        dre_type,
        dre_type AS dre_tipo,
        created_at,
        updated_at
      FROM "cashSubcategories"
      WHERE category_id = $1
      ORDER BY name ASC
    `
    : `
      SELECT
        id,
        category_id,
        category_id AS categoria_id,
        name,
        name AS nome,
        is_active,
        is_deductible,
        dre_type,
        dre_type AS dre_tipo,
        created_at,
        updated_at
      FROM "cashSubcategories"
      WHERE category_id = $1
        AND is_active = true
      ORDER BY name ASC
    `;

  const res = await q(sql, [catId]);
  return res.rows;
}

export async function setCategoriaActive(id, { is_active } = {}) {
  const _id = Number(id);
  if (!Number.isFinite(_id)) throw new Error('id inválido');

  const ativo = toBool(is_active, true);

  const res = await q(
    `
    UPDATE "cashCategories"
    SET is_active = $1,
        updated_at = now()
    WHERE id = $2
    RETURNING
      id,
      name,
      name AS nome,
      is_active,
      created_at,
      updated_at
    `,
    [ativo, _id]
  );

  return res.rows[0] || null;
}

export async function setSubcategoriaActive(id, { is_active } = {}) {
  const _id = Number(id);
  if (!Number.isFinite(_id)) throw new Error('id inválido');

  const ativo = toBool(is_active, true);

  const res = await q(
    `
    UPDATE "cashSubcategories"
    SET is_active = $1,
        updated_at = now()
    WHERE id = $2
    RETURNING
      id,
      category_id,
      category_id AS categoria_id,
      name,
      name AS nome,
      is_active,
      is_deductible,
      dre_type,
      dre_type AS dre_tipo,
      created_at,
      updated_at
    `,
    [ativo, _id]
  );

  return res.rows[0] || null;
}

/* =========================================================================
   ANEXOS
============================================================================*/

export async function listAnexos({ movimentacao_id, cash_movement_id }) {
  const finalMovementId = cash_movement_id ?? movimentacao_id;

  const res = await q(
    `
    SELECT
      id,
      cash_movement_id,
      cash_movement_id AS movimentacao_id,
      file_name,
      file_name AS filename,
      mime_type,
      file_size_bytes,
      file_size_bytes AS size_bytes,
      storage_bucket,
      storage_bucket AS gcs_bucket,
      storage_path,
      storage_path AS gcs_path,
      created_at
    FROM "cashMovimentsAttachments"
    WHERE cash_movement_id = $1
    ORDER BY created_at DESC
    `,
    [Number(finalMovementId)]
  );

  return res.rows;
}

export async function addAnexo({
  movimentacao_id,
  cash_movement_id,
  filename,
  file_name,
  mime_type,
  size_bytes,
  file_size_bytes,
  gcs_bucket,
  storage_bucket,
  gcs_path,
  storage_path,
}) {
  const finalMovementId = cash_movement_id ?? movimentacao_id;
  const finalFileName = file_name ?? filename;
  const finalSize = file_size_bytes ?? size_bytes;
  const finalBucket = storage_bucket ?? gcs_bucket;
  const finalPath = storage_path ?? gcs_path;

  const res = await q(
    `
    INSERT INTO "cashMovimentsAttachments"
    (
      cash_movement_id,
      file_name,
      mime_type,
      file_size_bytes,
      storage_bucket,
      storage_path
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id,
      cash_movement_id,
      cash_movement_id AS movimentacao_id,
      file_name,
      file_name AS filename,
      mime_type,
      file_size_bytes,
      file_size_bytes AS size_bytes,
      storage_bucket,
      storage_bucket AS gcs_bucket,
      storage_path,
      storage_path AS gcs_path,
      created_at
    `,
    [
      Number(finalMovementId),
      finalFileName,
      mime_type,
      finalSize,
      finalBucket,
      finalPath,
    ]
  );

  return res.rows[0];
}

export async function deleteAnexo(id) {
  const res = await q(
    `DELETE FROM "cashMovimentsAttachments" WHERE id = $1 RETURNING id`,
    [Number(id)]
  );

  return res.rowCount > 0;
}

export async function copyAttachmentsFromAccountsPayable({
  account_payable_id,
  movimentacao_id,
  cash_movement_id,
}) {
  const finalMovementId = cash_movement_id ?? movimentacao_id;

  if (!account_payable_id || !finalMovementId) return [];

  const attRes = await q(
    `
    SELECT
      file_type,
      file_name,
      file_url
    FROM public."accountsPayableAttachments"
    WHERE account_payable_id = $1
    ORDER BY id ASC
    `,
    [Number(account_payable_id)]
  );

  const created = [];
  const bucket = storage.bucket(BUCKET_NAME);

  for (const att of attRes.rows) {
    if (!att.file_url) continue;

    const fileType = String(att.file_type || '').toUpperCase();

    const filename =
      att.file_name ||
      `${fileType || 'ANEXO'}-${account_payable_id}`;

    const mimeType =
      fileType === 'XML'
        ? 'application/xml'
        : fileType === 'DANFE'
          ? 'application/pdf'
          : 'application/octet-stream';

    const localPath = resolvePublicFile(att.file_url);

    if (!localPath) {
      console.warn('[CAIXA][ANEXOS][AP_FILE_NOT_FOUND]', {
        account_payable_id,
        movimentacao_id: finalMovementId,
        file_url: att.file_url,
      });
      continue;
    }

    const exists = await q(
      `
      SELECT id
      FROM "cashMovimentsAttachments"
      WHERE cash_movement_id = $1
        AND file_name = $2
      `,
      [Number(finalMovementId), filename]
    );

    if (exists.rowCount) continue;

    const gcsPath = buildCaixaObjectPath({
      movimentacao_id: finalMovementId,
      filename,
    });

    if (localPath.startsWith('https://storage.googleapis.com/')) {
      const sourceUrl = new URL(localPath);
      const sourcePath = sourceUrl.pathname.replace(/^\/[^/]+\//, '');

      await bucket
        .file(sourcePath)
        .copy(bucket.file(gcsPath));
    } else {
      await bucket.upload(localPath, {
        destination: gcsPath,
        resumable: false,
        metadata: {
          contentType: mimeType,
          cacheControl: 'no-store',
        },
      });
    }

    let fileSize = 0;

    if (localPath.startsWith('https://storage.googleapis.com/')) {
      const [meta] = await bucket.file(gcsPath).getMetadata();
      fileSize = Number(meta.size || 0);
    } else {
      const stat = fs.statSync(localPath);
      fileSize = Number(stat.size || 0);
    }

    const ins = await addAnexo({
      cash_movement_id: finalMovementId,
      file_name: filename,
      mime_type: mimeType,
      file_size_bytes: fileSize,
      storage_bucket: BUCKET_NAME,
      storage_path: gcsPath,
    });

    created.push(ins);
  }

  console.log('[CAIXA][ANEXOS][COPIED_FROM_AP_TO_GCS]', {
    account_payable_id,
    movimentacao_id: finalMovementId,
    bucket: BUCKET_NAME,
    count: created.length,
    paths: created.map((x) => x.gcs_path || x.storage_path),
  });

  return created;
}

export async function ping() {
  const r = await q('SELECT 1 AS ok');
  return r.rows?.[0]?.ok === 1;
}

export async function listChartAccountsForCaixa() {
  const res = await q(`
    SELECT
      id,
      code,
      description,
      account_type,
      nature,
      level,
      parent_account_id,
      allows_posting,
      is_active
    FROM "chartOfAccounts"
    WHERE is_active = true
      AND allows_posting = true
    ORDER BY code ASC
  `);

  return res.rows;
}

/**
 * Alteração em lote das movimentações selecionadas.
 * Somente os campos presentes em `changes` são alterados:
 *   movement_type      'ENTRADA' | 'SAIDA'
 *   document_type_id   id de "cashDocumentTypes" (grava o nome em document_type)
 *   bank_account_id    id de "bankAccounts" (grava o nome em cash_account)
 *   chart_account_id   id de "chartOfAccounts" ou null (remove)
 *   category_id        id de "cashCategories" (sem subcategory_id → limpa a subcategoria)
 *   subcategory_id     id de "cashSubcategories" ou null; exige category_id
 */
export async function updateMovementsBatch(ids = [], changes = {}) {
  const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
  const has = (key) => Object.prototype.hasOwnProperty.call(changes || {}, key);
  const positive = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const normalizedIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (!normalizedIds.length) throw badRequest('Selecione pelo menos uma movimentação.');
  if (normalizedIds.length > 500) {
    throw badRequest('É permitido alterar no máximo 500 movimentações por operação.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sets = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      sets.push(sql.replace('?', `$${params.length}`));
    };

    if (has('movement_type')) {
      const type = normalizeTipoMovimentacao(changes.movement_type);
      if (type !== 'ENTRADA' && type !== 'SAIDA') throw badRequest('Tipo inválido.');
      add('movement_type = ?', type);
    }

    if (has('document_type_id')) {
      const id = positive(changes.document_type_id);
      const { rows } = id
        ? await client.query(`SELECT name FROM "cashDocumentTypes" WHERE id = $1`, [id])
        : { rows: [] };
      if (!rows[0]) throw badRequest('Tipo de documento não encontrado.');
      add('document_type = ?', String(rows[0].name).trim().slice(0, 20));
    }

    if (has('bank_account_id')) {
      const id = positive(changes.bank_account_id);
      const { rows } = id
        ? await client.query(`SELECT id, name FROM "bankAccounts" WHERE id = $1`, [id])
        : { rows: [] };
      if (!rows[0]) throw badRequest('Conta não encontrada.');
      add('cash_account = ?', String(rows[0].name).trim().slice(0, 50));
      add('bank_account_id = ?', Number(rows[0].id));
    }

    if (has('chart_account_id')) {
      if (changes.chart_account_id === null || changes.chart_account_id === '') {
        add('chart_account_id = ?', null);
      } else {
        const id = positive(changes.chart_account_id);
        const { rows } = id
          ? await client.query(`SELECT id FROM "chartOfAccounts" WHERE id = $1`, [id])
          : { rows: [] };
        if (!rows[0]) throw badRequest('Conta contábil não encontrada.');
        add('chart_account_id = ?', id);
      }
    }

    if (has('subcategory_id') && !has('category_id')) {
      throw badRequest('Para alterar a subcategoria, informe também a categoria.');
    }

    if (has('category_id')) {
      const categoryId = positive(changes.category_id);
      const { rows } = categoryId
        ? await client.query(`SELECT id FROM "cashCategories" WHERE id = $1`, [categoryId])
        : { rows: [] };
      if (!rows[0]) throw badRequest('Categoria não encontrada.');
      add('category = ?', String(categoryId));

      const subcategoryId = has('subcategory_id') ? positive(changes.subcategory_id) : null;
      if (subcategoryId) {
        const { rows: subRows } = await client.query(
          `SELECT id FROM "cashSubcategories" WHERE id = $1 AND category_id = $2`,
          [subcategoryId, categoryId]
        );
        if (!subRows[0]) throw badRequest('A subcategoria não pertence à categoria escolhida.');
      }
      // Subcategoria antiga pertence à categoria antiga → limpa quando não informada
      add('subcategory = ?', subcategoryId ? String(subcategoryId) : null);
    }

    if (!sets.length) throw badRequest('Escolha pelo menos um campo para alterar.');

    params.push(normalizedIds);
    const result = await client.query(
      `
        UPDATE "cashMoviments"
        SET ${sets.join(', ')}, updated_at = now()
        WHERE id = ANY($${params.length}::bigint[])
        RETURNING id
      `,
      params
    );

    await client.query('COMMIT');

    return {
      requested: normalizedIds.length,
      updated: result.rowCount,
      ids: result.rows.map((row) => Number(row.id)),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteMovementsBatch(ids = []) {
  const normalizedIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (!normalizedIds.length) {
    return {
      requested: 0,
      deleted: 0,
      ids: [],
    };
  }

  if (normalizedIds.length > 500) {
    throw new Error(
      'É permitido excluir no máximo 500 movimentações por operação.'
    );
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        DELETE FROM "cashMovimentsAttachments"
        WHERE cash_movement_id = ANY($1::bigint[])
      `,
      [normalizedIds]
    );

    const result = await client.query(
      `
        DELETE FROM "cashMoviments"
        WHERE id = ANY($1::bigint[])
        RETURNING id
      `,
      [normalizedIds]
    );

    await client.query('COMMIT');

    return {
      requested: normalizedIds.length,
      deleted: result.rowCount,
      ids: result.rows.map((row) => Number(row.id)),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default {
  copyAttachmentsFromAccountsPayable,

  listMovements,
  getMovementById,
  createMovement,
  updateMovement,
  deleteMovement,

  listForPdf,

  summary,

  listCategorias,
  createCategoria,
  updateCategoria,
  deleteCategoria,

  listSubcategorias,
  createSubcategoria,
  updateSubcategoria,
  deleteSubcategoria,

  listSubcategoriasByCategoria,
  setCategoriaActive,
  setSubcategoriaActive,

  listChartAccountsForCaixa,

  listAnexos,
  addAnexo,
  deleteAnexo,
  deleteMovementsBatch,
  updateMovementsBatch,

  ping,
};