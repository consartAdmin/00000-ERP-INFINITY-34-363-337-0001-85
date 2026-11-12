// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleDocsConsart.repository.js — Documentação dos módulos         ║
// ║ CONSART ERP                                                        ║
// ║ • Controle interno: NÃO altera o menu do sistema                   ║
// ║ • public."moduleDocsConsart" tem a própria árvore (nome, tipo, pai,║
// ║   ordem) + descrição / funções / observações / status / softwares ║
// ║ • 1º uso copia o menu (moduleSystem); depois só pelo botão         ║
// ║   "Importar do menu" (traz o que ainda não foi trazido)            ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TABLE as MODULES_TB } from '../moduleSystem/moduleSystem.constants.js';

export const TB = 'public."moduleDocsConsart"';
export const SOFTWARE_TB = 'public."moduleSoftwareConsart"';

/** Softwares da Consart que já vêm cadastrados (dá para mudar pela tela) */
const SOFTWARE_SEED = [
  ['Consart Infinity', 'Voltado para Distribuidoras', 10],
  ['Consart Logistics', 'Voltado para Transportadoras', 20],
  ['Consart ProdNex', 'Voltado para Indústrias', 30],
];

/** Status da documentação (o que não tem linha na tabela conta como PENDENTE) */
export const DOC_STATUS = Object.freeze({
  PENDENTE: 'Pendente',
  REVISAR: 'Revisar',
  DOCUMENTADO: 'Documentado',
});

/** Sistemas (planos) em que o módulo funciona — ordem de exibição */
export const SYSTEMS = Object.freeze({
  CORE: 'Core',
  EDGE: 'Edge',
  INFINITY: 'Infinity',
});

/** ['edge', 'X', 'CORE'] → ['CORE', 'EDGE'] (só válidos, sem repetir, na ordem de SYSTEMS) */
export function normalizeSystems(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const wanted = new Set(list.map((s) => String(s).trim().toUpperCase()));
  return Object.keys(SYSTEMS).filter((key) => wanted.has(key));
}

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
        module_id    BIGINT PRIMARY KEY,
        description  TEXT,
        functions    TEXT,
        notes        TEXT,
        status       VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        updated_by   VARCHAR(150),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS systems TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS software_ids INTEGER[] NOT NULL DEFAULT '{}';
      -- Árvore própria da documentação (independente do menu)
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS name       VARCHAR(150);
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS path       VARCHAR(255);
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS menu_type  VARCHAR(20);
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS parent_id  BIGINT;
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS sort_order INTEGER;
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS menu_id    BIGINT;
      ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      CREATE SEQUENCE IF NOT EXISTS public."moduleDocsConsart_module_id_seq";
      CREATE TABLE IF NOT EXISTS ${SOFTWARE_TB} (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(80) NOT NULL UNIQUE,
        description  VARCHAR(200),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `).then(async () => {
      await separateFromMenu();
      // Softwares: só na primeira vez (tabela vazia)
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM ${SOFTWARE_TB}`);
      if (total) return;
      for (const [name, description, order] of SOFTWARE_SEED) {
        await pool.query(
          `INSERT INTO ${SOFTWARE_TB} (name, description, sort_order) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
          [name, description, order]
        );
      }
    }).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

/**
 * Migração (uma vez): a documentação deixa de depender do menu.
 *  - tira a FK para moduleSystem (excluir no menu não apaga a documentação)
 *  - copia nome/tipo/pai/ordem/ativo do menu para as linhas que já existiam
 *  - na primeira vez, traz todos os itens do menu (mesmo id, então os pais batem)
 * Roda dentro de um lock para várias instâncias não importarem juntas.
 */
async function separateFromMenu() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('moduleDocsConsart.separateFromMenu'))`);

    const { rows: fks } = await client.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = '${TB}'::regclass AND contype = 'f'`
    );
    for (const { conname } of fks) {
      await client.query(`ALTER TABLE ${TB} DROP CONSTRAINT "${conname.replace(/"/g, '""')}"`);
    }

    const { rows: [{ named }] } = await client.query(`SELECT COUNT(*)::int AS named FROM ${TB} WHERE name IS NOT NULL`);
    if (!named) {
      await client.query(
        `UPDATE ${TB} d
            SET name = m.name, path = m.path, menu_type = m.menu_type, parent_id = m.parent_id,
                sort_order = m.sort_order, is_active = COALESCE(m.is_active, TRUE), menu_id = m.id
           FROM ${MODULES_TB} m
          WHERE m.id = d.module_id AND d.name IS NULL`
      );
      await client.query(
        `INSERT INTO ${TB} (module_id, name, path, menu_type, parent_id, sort_order, is_active, menu_id)
         SELECT m.id, m.name, m.path, m.menu_type, m.parent_id, m.sort_order, COALESCE(m.is_active, TRUE), m.id
           FROM ${MODULES_TB} m
          WHERE NOT EXISTS (SELECT 1 FROM ${TB} d WHERE d.module_id = m.id)`
      );
    }

    // Novos itens da documentação ganham id do sequence (acima dos que já existem)
    await client.query(
      `SELECT setval('public."moduleDocsConsart_module_id_seq"',
                     GREATEST((SELECT COALESCE(MAX(module_id), 0) FROM ${TB}) + 1,
                              nextval('public."moduleDocsConsart_module_id_seq"')),
                     false)`
    );
    await client.query(
      `ALTER TABLE ${TB} ALTER COLUMN module_id SET DEFAULT nextval('public."moduleDocsConsart_module_id_seq"')`
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
// Árvore da documentação
// ─────────────────────────────────────────────────────────────────────

/**
 * Todos os módulos na ordem do menu (pai, depois filhos por sort_order),
 * cada um com nível, módulo raiz, caminho "A › B › C" e a documentação.
 */
async function loadTree() {
  await ensureModuleDocsConsartTable();

  const { rows } = await pool.query(`
    SELECT d.module_id AS id, d.name, d.path, d.menu_type, d.parent_id, d.sort_order, d.is_active,
           d.description, d.functions, d.notes, d.status AS doc_status, d.systems, d.software_ids,
           d.updated_by AS doc_updated_by, d.updated_at AS doc_updated_at
      FROM ${TB} d
     WHERE d.deleted_at IS NULL AND d.name IS NOT NULL
     ORDER BY d.sort_order ASC NULLS LAST, d.module_id ASC
  `);

  const software = await listSoftware();

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
        systems: normalizeSystems(row.systems || []),
        systems_label: normalizeSystems(row.systems || []).map((k) => SYSTEMS[k]).join(', '),
        // Na ordem do cadastro de softwares; ids de software excluído somem
        software_ids: software.filter((sw) => (row.software_ids || []).includes(sw.id)).map((sw) => sw.id),
        software_label: software.filter((sw) => (row.software_ids || []).includes(sw.id)).map((sw) => sw.name).join(', '),
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
 *  system   CORE | EDGE | INFINITY | NONE (sem sistema marcado)
 *  software id do software | NONE (sem software marcado)
 */
export async function list({ q, module, type, status, active, system, software } = {}) {
  const tree = await loadTree();

  const moduleId = positiveId(module);
  const typeFilter = TYPE_LABELS[type] ? type : '';
  const statusFilter = DOC_STATUS[status] ? status : '';
  const sys = String(system ?? '').trim().toUpperCase();
  const systemFilter = SYSTEMS[sys] || sys === 'NONE' ? sys : '';
  const swKey = String(software ?? '').trim().toUpperCase();
  const softwareFilter = swKey === 'NONE' ? 'NONE' : positiveId(swKey);
  const act = String(active ?? '').trim().toLowerCase();
  const search = text(q)?.toLowerCase();

  const rows = tree.filter((r) => {
    if (moduleId && r.module_id !== moduleId) return false;
    if (typeFilter && r.type !== typeFilter) return false;
    if (statusFilter && r.doc_status !== statusFilter) return false;
    if (systemFilter === 'NONE' && r.systems.length) return false;
    if (systemFilter && systemFilter !== 'NONE' && !r.systems.includes(systemFilter)) return false;
    if (softwareFilter === 'NONE' && r.software_ids.length) return false;
    if (softwareFilter && softwareFilter !== 'NONE' && !r.software_ids.includes(softwareFilter)) return false;
    if (act === 'true' && !r.is_active) return false;
    if (act === 'false' && r.is_active) return false;
    if (search) {
      const haystack = [r.name, r.path, r.breadcrumb, r.description, r.functions, r.notes, r.software_label]
        .join('\n').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Itens inativos dentro de cada um, escondidos pelo Status = Ativos
  // (sem isso o item parece vazio, mas não deixa excluir)
  const hidden = new Map();
  if (act === 'true') {
    tree.forEach((r) => {
      if (r.parent_id != null && !r.is_active) hidden.set(r.parent_id, (hidden.get(r.parent_id) || 0) + 1);
    });
  }
  rows.forEach((r) => { r.hidden_children = hidden.get(r.id) || 0; });

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
// Escrita — só na documentação (o menu do sistema não muda)
// ─────────────────────────────────────────────────────────────────────

const MENU_TYPES = ['dropdown', 'submenu', 'link'];

// Onde cada tipo pode ficar (mesmas regras da Criação de Módulos)
const ALLOWED_PARENTS = Object.freeze({ dropdown: [], submenu: ['dropdown'], link: ['dropdown', 'submenu'] });

/** Nome/tipo/pai/endereço/ordem/ativo vindos do body (só o que veio) */
function readTreeFields(body = {}) {
  const fields = {};
  if (body.name !== undefined) {
    fields.name = text(body.name, 150);
    if (!fields.name) throw validationError('Informe o nome.');
  }
  if (body.menu_type !== undefined) {
    const type = text(body.menu_type, 20);
    if (type && !MENU_TYPES.includes(type)) throw validationError(`Tipo inválido: ${type}.`);
    fields.menu_type = type;
  }
  if (body.parent_id !== undefined) {
    fields.parent_id = body.parent_id === null || body.parent_id === '' ? null : positiveId(body.parent_id);
    if (body.parent_id !== null && body.parent_id !== '' && !fields.parent_id) throw validationError('"Dentro de" inválido.');
  }
  if (body.path !== undefined) fields.path = text(body.path, 255);
  if (body.sort_order !== undefined) {
    const raw = String(body.sort_order ?? '').trim();
    fields.sort_order = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isSafeInteger(fields.sort_order)) throw validationError('Ordem inválida.');
  }
  if (body.is_active !== undefined) fields.is_active = body.is_active === true || body.is_active === 'true';
  return fields;
}

/** Regras da árvore, olhando só a documentação */
async function validateTree(id, current, fields) {
  const menuType = fields.menu_type !== undefined ? fields.menu_type : current?.menu_type ?? null;
  const parentId = fields.parent_id !== undefined ? fields.parent_id : current?.parent_id ?? null;
  const path = fields.path !== undefined ? fields.path : current?.path ?? null;

  if (menuType === 'link' && (!path || path === '#')) throw validationError('Informe o endereço da tela.');

  if (parentId != null) {
    if (id != null && Number(parentId) === Number(id)) throw validationError('Um item não pode ficar dentro dele mesmo.');
    const { rows: [parent] } = await pool.query(
      `SELECT module_id, name, menu_type FROM ${TB} WHERE module_id = $1 AND deleted_at IS NULL`, [parentId]
    );
    if (!parent) throw validationError('O item escolhido em "Dentro de" não existe.');
    const allowed = ALLOWED_PARENTS[menuType] || [];
    if (!allowed.includes(parent.menu_type)) {
      throw validationError(
        menuType === 'dropdown' || !menuType
          ? `${TYPE_LABELS[typeKey(menuType)]} fica sempre no topo (sem "Dentro de").`
          : `Um ${TYPE_LABELS[menuType].toLowerCase()} não pode ficar dentro de "${parent.name}" (${TYPE_LABELS[typeKey(parent.menu_type)].toLowerCase()}).`
      );
    }
  }
  if (menuType === 'submenu' && parentId == null) throw validationError('Submenu precisa ficar dentro de um módulo.');

  if (id != null) {
    const { rows: children } = await pool.query(
      `SELECT menu_type FROM ${TB} WHERE parent_id = $1 AND deleted_at IS NULL`, [id]
    );
    if (children.length) {
      if (menuType !== 'dropdown' && menuType !== 'submenu') {
        throw validationError(`Este item tem ${children.length} item(ns) dentro dele; mova-os antes de mudar o tipo.`, 409);
      }
      if (menuType === 'submenu' && children.some((c) => c.menu_type !== 'link')) {
        throw validationError('Submenu só pode conter telas; este item tem submenus dentro.', 409);
      }
    }
  }
}

/** Campos da documentação vindos do body */
async function readDocFields(body = {}) {
  const status = String(body.status || '').trim().toUpperCase();
  if (status && !DOC_STATUS[status]) throw validationError('Status inválido.');
  const description = text(body.description, 5000);
  return {
    description,
    functions: text(body.functions, 10000),
    notes: text(body.notes, 5000),
    status: status || (description ? 'DOCUMENTADO' : 'PENDENTE'),
    systems: normalizeSystems(body.systems),
    software_ids: await validSoftwareIds(body.software_ids),
  };
}

export async function save(id, body = {}, user = null) {
  await ensureModuleDocsConsartTable();
  const moduleId = positiveId(id);
  if (!moduleId) return null;

  const { rows: [current] } = await pool.query(
    `SELECT module_id, menu_type, parent_id, path FROM ${TB} WHERE module_id = $1 AND deleted_at IS NULL AND name IS NOT NULL`,
    [moduleId]
  );
  if (!current) return null;

  const tree = readTreeFields(body);
  if (tree.menu_type !== undefined || tree.parent_id !== undefined || tree.path !== undefined) {
    await validateTree(moduleId, current, tree);
  }
  const doc = await readDocFields(body);
  const fields = { ...tree, ...doc, updated_by: text(user, 150) };

  const keys = Object.keys(fields);
  await pool.query(
    `UPDATE ${TB} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE module_id = $1`,
    [moduleId, ...keys.map((k) => fields[k])]
  );

  return getById(moduleId);
}

/** Novo item só na documentação */
export async function create(body = {}, user = null) {
  await ensureModuleDocsConsartTable();
  const tree = readTreeFields({ menu_type: null, parent_id: null, ...body });
  if (!tree.name) throw validationError('Informe o nome.');
  await validateTree(null, null, tree);
  const doc = await readDocFields(body);

  if (tree.sort_order == null) {
    const { rows: [{ next }] } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM ${TB}
        WHERE deleted_at IS NULL AND parent_id IS NOT DISTINCT FROM $1`,
      [tree.parent_id]
    );
    tree.sort_order = Number(next);
  }

  const fields = { is_active: true, ...tree, ...doc, updated_by: text(user, 150) };
  const keys = Object.keys(fields);
  const { rows: [row] } = await pool.query(
    `INSERT INTO ${TB} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING module_id`,
    keys.map((k) => fields[k])
  );
  return getById(row.module_id);
}

/**
 * "Importar do menu": traz os itens do menu que ainda não estão na
 * documentação (nem foram excluídos dela). O menu não muda.
 */
export async function importFromMenu() {
  await ensureModuleDocsConsartTable();
  const { rows: menu } = await pool.query(
    `SELECT m.id, m.name, m.path, m.menu_type, m.parent_id, m.sort_order, COALESCE(m.is_active, TRUE) AS is_active
       FROM ${MODULES_TB} m
      WHERE NOT EXISTS (SELECT 1 FROM ${TB} d WHERE d.menu_id = m.id)
      ORDER BY m.id`
  );
  if (!menu.length) return { added: 0, items: [] };

  // id do menu → id na documentação (pais primeiro)
  const { rows: known } = await pool.query(`SELECT module_id, menu_id FROM ${TB} WHERE menu_id IS NOT NULL AND deleted_at IS NULL`);
  const docIdByMenuId = new Map(known.map((r) => [String(r.menu_id), r.module_id]));
  const pending = [...menu];
  const added = [];

  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; i += 1) {
      const m = pending[i];
      const parentWaiting = m.parent_id != null && pending.some((p) => String(p.id) === String(m.parent_id));
      if (parentWaiting) continue;
      const parentId = m.parent_id != null ? docIdByMenuId.get(String(m.parent_id)) ?? null : null;
      const { rows: [row] } = await pool.query(
        `INSERT INTO ${TB} (name, path, menu_type, parent_id, sort_order, is_active, menu_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING module_id`,
        [m.name, m.path, m.menu_type, parentId, m.sort_order, m.is_active, m.id]
      );
      docIdByMenuId.set(String(m.id), row.module_id);
      added.push(m.name);
      pending.splice(i, 1);
      i -= 1;
    }
    if (pending.length === before) break; // ciclo no menu: não trava
  }
  return { added: added.length, items: added };
}

/**
 * Exclui o item da documentação (o menu do sistema não muda). Fica marcado
 * como excluído para o "Importar do menu" não trazer de volta. Item com
 * itens dentro não pode ser excluído.
 */
export async function removeModule(id) {
  await ensureModuleDocsConsartTable();
  const moduleId = positiveId(id);
  if (!moduleId) return null;

  const { rows: children } = await pool.query(
    `SELECT name, is_active FROM ${TB}
      WHERE parent_id = $1 AND deleted_at IS NULL AND name IS NOT NULL
      ORDER BY sort_order ASC NULLS LAST, module_id ASC`,
    [moduleId]
  );
  if (children.length) {
    // Diz quais são: inativos não aparecem com o filtro Status = Ativos
    const names = children.map((c) => `"${c.name}"${c.is_active === false ? ' (inativo)' : ''}`).join(', ');
    const inactive = children.filter((c) => c.is_active === false).length;
    throw validationError(
      `Este item tem ${children.length} item(ns) dentro dele: ${names}. Exclua ou mova esses itens antes.` +
        (inactive ? ' Para ver os inativos, use Status = Todos.' : ''),
      409
    );
  }

  const { rows: [row] } = await pool.query(
    `UPDATE ${TB} SET deleted_at = NOW(), updated_at = NOW()
      WHERE module_id = $1 AND deleted_at IS NULL AND name IS NOT NULL
      RETURNING module_id AS id, name, path`,
    [moduleId]
  );
  return row || null;
}

// ─────────────────────────────────────────────────────────────────────
// Softwares (Consart Infinity, Logistics, ProdNex...) — cadastro simples
// ─────────────────────────────────────────────────────────────────────

export async function listSoftware() {
  await ensureModuleDocsConsartTable();
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.description, s.sort_order,
            (SELECT COUNT(*)::int FROM ${TB} d WHERE s.id = ANY (d.software_ids)) AS modules_count
       FROM ${SOFTWARE_TB} s
      ORDER BY s.sort_order ASC, s.name ASC`
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), description: r.description || '' }));
}

/** [3, '1', 'x', 99] → só ids que existem, sem repetir */
async function validSoftwareIds(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const wanted = new Set(list.map(positiveId).filter(Boolean));
  if (!wanted.size) return [];
  const existing = await listSoftware();
  return existing.filter((sw) => wanted.has(sw.id)).map((sw) => sw.id);
}

export async function saveSoftware(id, body = {}) {
  await ensureModuleDocsConsartTable();
  const name = text(body.name, 80);
  if (!name) throw validationError('Informe o nome do software.');
  const description = text(body.description, 200);
  const order = Number.isSafeInteger(Number(body.sort_order)) && String(body.sort_order ?? '').trim() !== ''
    ? Number(body.sort_order)
    : null;

  const { rows: [dup] } = await pool.query(
    `SELECT id FROM ${SOFTWARE_TB} WHERE lower(name) = lower($1) AND id <> COALESCE($2, 0)`,
    [name, id ? positiveId(id) : null]
  );
  if (dup) throw validationError(`Já existe um software chamado "${name}".`, 409);

  if (id) {
    const softwareId = positiveId(id);
    if (!softwareId) return null;
    const { rows: [row] } = await pool.query(
      `UPDATE ${SOFTWARE_TB}
          SET name = $2, description = $3, sort_order = COALESCE($4, sort_order), updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [softwareId, name, description, order]
    );
    return row ? (await listSoftware()).find((sw) => sw.id === softwareId) : null;
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO ${SOFTWARE_TB} (name, description, sort_order)
     VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM ${SOFTWARE_TB})))
     RETURNING id`,
    [name, description, order]
  );
  return (await listSoftware()).find((sw) => sw.id === Number(row.id));
}

/** Exclui o software e tira a marcação dele dos módulos */
export async function removeSoftware(id) {
  await ensureModuleDocsConsartTable();
  const softwareId = positiveId(id);
  if (!softwareId) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query(
      `DELETE FROM ${SOFTWARE_TB} WHERE id = $1 RETURNING id, name`, [softwareId]
    );
    if (row) {
      await client.query(
        `UPDATE ${TB} SET software_ids = array_remove(software_ids, $1) WHERE $1 = ANY (software_ids)`,
        [softwareId]
      );
    }
    await client.query('COMMIT');
    return row || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
