// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/services/apis/caixaSubcategoriasApi.js                       ║
// ║ — DB Access (ESM)                                                    ║
// ║ Tabelas: public."caixaSubCategorias"                                 ║
// ║ Responsável por: CRUD + listagem + filtro por categoria + toggle     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

export const TB_CAIXA_SUBCATEGORIAS = '"cashSubcategories"';

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
  return err?.code === '23505';
}

/* ──────────────────────────────────────────────────────────────
   Queries
────────────────────────────────────────────────────────────── */

export async function listarSubcategorias({ incluirInativos = true } = {}) {
  const where = incluirInativos ? '' : 'WHERE is_active = true';

  const sql = `
    SELECT id, categoria_id, nome, is_active, created_at, updated_at
      FROM ${TB_CAIXA_SUBCATEGORIAS}
      ${where}
     ORDER BY nome ASC
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

export async function listarSubcategoriasPorCategoria(categoriaId, { incluirInativos = true } = {}) {
  const _categoriaId = asInt(categoriaId);
  if (!_categoriaId) {
    const e = new Error('categoria_id inválido.');
    e.statusCode = 400;
    throw e;
  }

  const whereActive = incluirInativos ? '' : 'AND is_active = true';

  const sql = `
    SELECT id, categoria_id, nome, is_active, created_at, updated_at
      FROM ${TB_CAIXA_SUBCATEGORIAS}
     WHERE categoria_id = $1
       ${whereActive}
     ORDER BY nome ASC
  `;
  const { rows } = await pool.query(sql, [_categoriaId]);
  return rows;
}

export async function obterSubcategoriaPorId(id) {
  const _id = asInt(id);
  if (!_id) return null;

  const sql = `
    SELECT id, categoria_id, nome, is_active, created_at, updated_at
      FROM ${TB_CAIXA_SUBCATEGORIAS}
     WHERE id = $1
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [_id]);
  return rows[0] ?? null;
}

export async function criarSubcategoria({ categoria_id, nome, is_active = true }) {
  const _categoriaId = asInt(categoria_id);
  const _nome = safeStr(nome, 100);
  const _active = asBool(is_active, true);

  if (!_categoriaId) {
    const e = new Error('categoria_id é obrigatório.');
    e.statusCode = 400;
    throw e;
  }
  if (!_nome) {
    const e = new Error('Nome da subcategoria é obrigatório.');
    e.statusCode = 400;
    throw e;
  }

  const sql = `
    INSERT INTO ${TB_CAIXA_SUBCATEGORIAS} (categoria_id, nome, is_active)
    VALUES ($1, $2, $3)
    RETURNING id, categoria_id, nome, is_active, created_at, updated_at
  `;

  try {
    const { rows } = await pool.query(sql, [_categoriaId, _nome, _active]);
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      const e = new Error('Já existe uma subcategoria com este nome dentro desta categoria.');
      e.statusCode = 409;
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

export async function atualizarSubcategoria(id, { nome, is_active, categoria_id }) {
  const _id = asInt(id);
  if (!_id) {
    const e = new Error('ID inválido.');
    e.statusCode = 400;
    throw e;
  }

  const updates = [];
  const values = [_id];

  if (typeof categoria_id !== 'undefined') {
    const _categoriaId = asInt(categoria_id);
    if (!_categoriaId) {
      const e = new Error('categoria_id inválido.');
      e.statusCode = 400;
      throw e;
    }
    values.push(_categoriaId);
    updates.push(`categoria_id = $${values.length}`);
  }

  if (typeof nome !== 'undefined') {
    const _nome = safeStr(nome, 100);
    if (!_nome) {
      const e = new Error('Nome inválido.');
      e.statusCode = 400;
      throw e;
    }
    values.push(_nome);
    updates.push(`nome = $${values.length}`);
  }

  if (typeof is_active !== 'undefined') {
    values.push(asBool(is_active, true));
    updates.push(`is_active = $${values.length}`);
  }

  if (!updates.length) {
    const e = new Error('Nada para atualizar.');
    e.statusCode = 400;
    throw e;
  }

  const sql = `
    UPDATE ${TB_CAIXA_SUBCATEGORIAS}
       SET ${updates.join(', ')},
           updated_at = now()
     WHERE id = $1
     RETURNING id, categoria_id, nome, is_active, created_at, updated_at
  `;

  try {
    const { rows } = await pool.query(sql, values);
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const e = new Error('Já existe uma subcategoria com este nome dentro desta categoria.');
      e.statusCode = 409;
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

export async function setSubcategoriaAtiva(id, is_active) {
  const _id = asInt(id);
  if (!_id) {
    const e = new Error('ID inválido.');
    e.statusCode = 400;
    throw e;
  }

  const _active = asBool(is_active, true);

  const sql = `
    UPDATE ${TB_CAIXA_SUBCATEGORIAS}
       SET is_active = $2,
           updated_at = now()
     WHERE id = $1
     RETURNING id, categoria_id, nome, is_active, created_at, updated_at
  `;
  const { rows } = await pool.query(sql, [_id, _active]);
  return rows[0] ?? null;
}

export async function excluirSubcategoria(id) {
  const _id = asInt(id);
  if (!_id) {
    const e = new Error('ID inválido.');
    e.statusCode = 400;
    throw e;
  }

  const sql = `DELETE FROM ${TB_CAIXA_SUBCATEGORIAS} WHERE id = $1 RETURNING id`;
  const { rows } = await pool.query(sql, [_id]);
  return rows[0] ?? null;
}

export default {
  listarSubcategorias,
  listarSubcategoriasPorCategoria,
  obterSubcategoriaPorId,
  criarSubcategoria,
  atualizarSubcategoria,
  setSubcategoriaAtiva,
  excluirSubcategoria,
};
