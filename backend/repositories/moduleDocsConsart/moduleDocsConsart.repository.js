// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleDocsConsart.repository.js — Documentação dos módulos         ║
// ║ CONSART ERP                                                        ║
// ║ • Lê a árvore de public."moduleSystem" (tela Criação de Módulos)   ║
// ║ • Guarda descrição / funções / observações / status em             ║
// ║   public."moduleDocsConsart" (criada no primeiro uso, 1 por módulo)║
// ║ • Nome, caminho e posição no menu continuam na Criação de Módulos  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TABLE as MODULES_TB } from '../moduleSystem/moduleSystem.constants.js';

export const TB = 'public."moduleDocsConsart"';

/** Status da documentação (o que não tem linha na tabela conta como PENDENTE) */
export const DOC_STATUS = Object.freeze({
  PENDENTE: 'Pendente',
  REVISAR: 'Revisar',
  DOCUMENTADO: 'Documentado',
});

/** Tipos do menu (NULL = fora do menu) */
export const TYPE_LABELS = Object.freeze({
  dropdown: 'Módulo',
  submenu: 'Submenu',
  link: 'Tela',
  none: 'Fora do menu',
});

let ready = null;

export function ensureModuleDocsConsartTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        module_id    BIGINT PRIMARY KEY REFERENCES ${MODULES_TB} (id) ON DELETE CASCADE,
        description  TEXT,
        functions    TEXT,
        notes        TEXT,
        status       VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        updated_by   VARCHAR(150),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function text(value, max) {
  const s = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** "Cadastrar\n- Editar\n\n• Excluir" → ['Cadastrar', 'Editar', 'Excluir'] */
export function splitFunctions(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function typeKey(menuType) {
  return TYPE_LABELS[menuType] ? menuType : 'none';
}

// ─────────────────────────────────────────────────────────────────────
// Árvore (menu) + documentação
// ─────────────────────────────────────────────────────────────────────

/**
 * Todos os módulos na ordem do menu (pai, depois filhos por sort_order),
 * cada um com nível, módulo raiz, caminho "A › B › C" e a documentação.
 */
async function loadTree() {
  await ensureModuleDocsConsartTable();

  const { rows } = await pool.query(`
    SELECT m.id, m.name, m.path, m.menu_type, m.parent_id, m.sort_order, m.is_active,
           d.description, d.functions, d.notes, d.status AS doc_status,
           d.updated_by AS doc_updated_by, d.updated_at AS doc_updated_at
      FROM ${MODULES_TB} m
      LEFT JOIN ${TB} d ON d.module_id = m.id
     ORDER BY m.sort_order ASC NULLS LAST, m.id ASC
  `);

  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const byParent = new Map();
  rows.forEach((row) => {
    const parentKey = row.parent_id != null && byId.has(String(row.parent_id)) ? String(row.parent_id) : 'root';
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(row);
  });

  const ordered = [];
  const seen = new Set();

  function walk(parentKey, level, root, trail) {
    (byParent.get(parentKey) || []).forEach((row) => {
      const key = String(row.id);
      if (seen.has(key)) return; // proteção contra ciclo pai/filho
      seen.add(key);

      const moduleRow = root || row;
      const path = [...trail, row.name];
      const status = DOC_STATUS[row.doc_status] ? row.doc_status : 'PENDENTE';
      const functions = splitFunctions(row.functions);

      ordered.push({
        id: Number(row.id),
        name: row.name,
        path: row.path,
        menu_type: row.menu_type,
        type: typeKey(row.menu_type),
        type_label: TYPE_LABELS[typeKey(row.menu_type)],
        parent_id: row.parent_id == null ? null : Number(row.parent_id),
        sort_order: row.sort_order,
        is_active: row.is_active !== false,
        level,
        module_id: Number(moduleRow.id),
        module_name: moduleRow.name,
        breadcrumb: path.join(' › '),
        description: row.description || '',
        functions: row.functions || '',
        functions_list: functions,
        functions_count: functions.length,
        notes: row.notes || '',
        doc_status: status,
        doc_status_label: DOC_STATUS[status],
        doc_updated_by: row.doc_updated_by || null,
        doc_updated_at: row.doc_updated_at || null,
      });

      walk(key, level + 1, moduleRow, path);
    });
  }

  walk('root', 0, null, []);

  // Sobras (ciclo pai/filho): entram no fim, como raiz
  rows.filter((r) => !seen.has(String(r.id))).forEach((row) => {
    byParent.set(`orphan-${row.id}`, [row]);
    walk(`orphan-${row.id}`, 0, null, []);
  });

  return ordered;
}

/**
 * Filtros:
 *  q        texto em nome, caminho, descrição, funções, observações
 *  module   id do módulo raiz (traz ele e tudo abaixo)
 *  type     dropdown | submenu | link | none
 *  status   PENDENTE | REVISAR | DOCUMENTADO
 *  active   true | false ('' = todos)
 */
export async function list({ q, module, type, status, active } = {}) {
  const tree = await loadTree();

  const moduleId = positiveId(module);
  const typeFilter = TYPE_LABELS[type] ? type : '';
  const statusFilter = DOC_STATUS[status] ? status : '';
  const act = String(active ?? '').trim().toLowerCase();
  const search = text(q)?.toLowerCase();

  const rows = tree.filter((r) => {
    if (moduleId && r.module_id !== moduleId) return false;
    if (typeFilter && r.type !== typeFilter) return false;
    if (statusFilter && r.doc_status !== statusFilter) return false;
    if (act === 'true' && !r.is_active) return false;
    if (act === 'false' && r.is_active) return false;
    if (search) {
      const haystack = [r.name, r.path, r.breadcrumb, r.description, r.functions, r.notes]
        .join('\n').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const summary = { total: rows.length, PENDENTE: 0, REVISAR: 0, DOCUMENTADO: 0 };
  rows.forEach((r) => { summary[r.doc_status] += 1; });

  return { rows, summary };
}

/** Módulos raiz (para o filtro "Módulo") */
export async function listModules() {
  const tree = await loadTree();
  return tree
    .filter((r) => r.level === 0)
    .map((r) => ({ id: r.id, name: r.name, type: r.type, is_active: r.is_active }));
}

export async function getById(id) {
  const moduleId = positiveId(id);
  if (!moduleId) return null;
  const tree = await loadTree();
  return tree.find((r) => r.id === moduleId) || null;
}

// ─────────────────────────────────────────────────────────────────────
// Escrita (documentação; exclusão do módulo segue a Criação de Módulos)
// ─────────────────────────────────────────────────────────────────────

export async function save(id, body = {}, user = null) {
  await ensureModuleDocsConsartTable();
  const moduleId = positiveId(id);
  if (!moduleId) return null;

  const { rows: [exists] } = await pool.query(`SELECT id FROM ${MODULES_TB} WHERE id = $1`, [moduleId]);
  if (!exists) return null;

  const status = String(body.status || '').trim().toUpperCase();
  if (status && !DOC_STATUS[status]) throw validationError('Status inválido.');

  const description = text(body.description, 5000);
  const functions = text(body.functions, 10000);
  const notes = text(body.notes, 5000);

  await pool.query(
    `INSERT INTO ${TB} (module_id, description, functions, notes, status, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (module_id) DO UPDATE SET
       description = EXCLUDED.description,
       functions   = EXCLUDED.functions,
       notes       = EXCLUDED.notes,
       status      = EXCLUDED.status,
       updated_by  = EXCLUDED.updated_by,
       updated_at  = NOW()`,
    [moduleId, description, functions, notes, status || (description ? 'DOCUMENTADO' : 'PENDENTE'), text(user, 150)]
  );

  return getById(moduleId);
}

/**
 * Exclui o módulo do sistema (sai do menu; a documentação vai junto por
 * ON DELETE CASCADE). Mesma regra da Criação de Módulos: item com filhos
 * no menu não pode ser excluído.
 */
export async function removeModule(id) {
  await ensureModuleDocsConsartTable();
  const moduleId = positiveId(id);
  if (!moduleId) return null;

  const { rows: children } = await pool.query(`SELECT id FROM ${MODULES_TB} WHERE parent_id = $1`, [moduleId]);
  if (children.length) {
    throw validationError(
      `Este item tem ${children.length} item(ns) dentro dele no menu; exclua ou mova esses itens antes.`,
      409
    );
  }

  const { rows: [row] } = await pool.query(
    `DELETE FROM ${MODULES_TB} WHERE id = $1 RETURNING id, name, path`,
    [moduleId]
  );
  return row || null;
}
