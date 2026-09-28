// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/services/apis/caixaCategoriasApi.js                          ║
// ║ — DB Access (ESM)                                                    ║
// ║ Tabelas: public."caixaCategorias"                                    ║
// ║ Responsável por: CRUD + listagem + toggle ativo                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

export const TB_CAIXA_CATEGORIAS = '"cashCategories"';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function safeStr(v, max = 100) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function asBool(v, fallback = true) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const x = v.trim().toLowerCase();
    if (['true', '1', 't', 'yes', 'y', 'sim'].includes(x)) return true;
    if (['false', '0', 'f', 'no', 'n', 'nao', 'não'].includes(x)) return false;
  }
  if (typeof v === 'number') return v === 1;
  return fallback;
}

function isUniqueViolation(err) {
  // Postgres unique violation: 23505
  return err?.code === '23505';
}

/* ──────────────────────────────────────────────────────────────
   Queries
────────────────────────────────────────────────────────────── */

export async function listarCategorias({ incluirInativos = true } = {}) {
  const where = incluirInativos ? '' : 'WHERE is_active = true';
  const sql = `
    SELECT id, nome, is_active, created_at, updated_at
      FROM ${TB_CAIXA_CATEGORIAS}
      ${where}
     ORDER BY nome ASC
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

export async function obterCategoriaPorId(id) {
  const _id = asInt(id);
  if (!_id) return null;

  const sql = `
    SELECT id, nome, is_active, created_at, updated_at
      FROM ${TB_CAIXA_CATEGORIAS}
     WHERE id = $1
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [_id]);
  return rows[0] ?? null;
}

export async function criarCategoria({ nome, is_active = true }) {
  const _nome = safeStr(nome, 100);
  const _active = asBool(is_active, true);

  if (!_nome) {
    const e = new Error('Nome da categoria é obrigatório.');
    e.statusCode = 400;
    throw e;
  }

  const sql = `
    INSERT INTO ${TB_CAIXA_CATEGORIAS} (nome, is_active)
    VALUES ($1, $2)
    RETURNING id, nome, is_active, created_at, updated_at
  `;

  try {
    const { rows } = await pool.query(sql, [_nome, _active]);
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      const e = new Error('Já existe uma categoria com este nome.');
      e.statusCode = 409;
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

export async function atualizarCategoria(id, { nome, is_active }) {
  const _id = asInt(id);
  const _nome = safeStr(nome, 100);
  const _hasActive = typeof is_active !== 'undefined';

  if (!_id) {
    const e = new Error('ID inválido.');
    e.statusCode = 400;
    throw e;
  }
  if (!_nome) {
    const e = new Error('Nome da categoria é obrigatório.');
    e.statusCode = 400;
    throw e;
  }

  const params = [_id, _nome];
  let setActiveSql = '';
  if (_hasActive) {
    params.push(asBool(is_active, true));
    setActiveSql = `, is_active = $${params.length}`;
  }

  const sql = `
    UPDATE ${TB_CAIXA_CATEGORIAS}
       SET nome = $2
           ${setActiveSql}
           , updated_at = now()
     WHERE id = $1
     RETURNING id, nome, is_active, created_at, updated_at
  `;

  try {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const e = new Error('Já existe uma categoria com este nome.');
      e.statusCode = 409;
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

export async function setCategoriaAtiva(id, is_active) {
  const _id = asInt(id);
  if (!_id) {
    const e = new Error('ID inválido.');
    e.statusCode = 400;
    throw e;
  }

  const _active = asBool(is_active, true);

  const sql = `
    UPDATE ${TB_CAIXA_CATEGORIAS}
       SET is_active = $2,
           updated_at = now()
     WHERE id = $1
     RETURNING id, nome, is_active, created_at, updated_at
  `;
  const { rows } = await pool.query(sql, [_id, _active]);
  return rows[0] ?? null;
}

export async function excluirCategoria(id) {
  const _id = asInt(id);
  if (!_id) {
    const e = new Error('ID inválido.');
    e.statusCode = 400;
    throw e;
  }

  // ON DELETE CASCADE na subcategoria já cuida das dependências.
  const sql = `DELETE FROM ${TB_CAIXA_CATEGORIAS} WHERE id = $1 RETURNING id`;
  const { rows } = await pool.query(sql, [_id]);
  return rows[0] ?? null;
}

export default {
  listarCategorias,
  obterCategoriaPorId,
  criarCategoria,
  atualizarCategoria,
  setCategoriaAtiva,
  excluirCategoria,
};
