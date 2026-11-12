// ╔══════════════════════════════════════════════════════════════════════╗
// ║ menuVendasCompras20261109.js — Reorganiza o menu superior (dock)     ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║ Tabela do menu: public."moduleSystem" (menuConsart.js lê via API)    ║
// ║                                                                      ║
// ║ 1) Vendas + Gestão Comercial viram um único "Vendas" em 3 colunas:   ║
// ║    Operação · Equipe · Relatórios. Gestão Comercial fica INATIVO     ║
// ║    (não é apagado; dá para reativar na Criação de Módulos).          ║
// ║ 2) Gestão ERP ganha a coluna "Compras / Parceiros" com Fornecedores  ║
// ║    e Fabricantes, que saem de Cadastros Secundários.                 ║
// ║                                                                      ║
// ║ Os links só mudam de lugar (parent_id/sort_order): os ids continuam  ║
// ║ os mesmos, então as permissões (userModules) não mudam. Quem tinha   ║
// ║ Gestão Comercial ganha acesso ao dropdown Vendas, senão o menu       ║
// ║ inteiro sumiria para essa pessoa (securityModules.js esconde o       ║
// ║ dropdown pelo id).                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'menu_vendas_compras_2026_11_09';
const LOCK_ID = 2026110901;
const T = 'public."moduleSystem"';

// Colunas do novo menu Vendas: regra de path → coluna e ordem dentro dela.
const COLUNAS_VENDAS = [
  { name: 'Operação', links: ['budgets/', 'orders/', 'ordersKanban/', 'crmDeals/'] },
  { name: 'Equipe', links: ['sellers/', 'sellerByUser/', 'priceCommissions/'] },
  { name: 'Relatórios', links: ['salesReport/', 'salesCommissionsFromInvoices/'] },
];

const COMPRAS_PARCEIROS = { name: 'Compras / Parceiros', links: ['suppliers/', 'manufacturers/'] };

// "orders/" não pode pegar "ordersKanban/" nem "ecommerceOrders/":
// compara o nome da pasta logo antes do arquivo.
function pastaDoPath(path) {
  const partes = String(path || '').trim().split('/').filter(Boolean);
  return partes.length >= 2 ? `${partes[partes.length - 2]}/` : '';
}

async function rootDropdown(client, htmlIds, nomeRe) {
  const { rows } = await client.query(
    `SELECT id, name, sort_order FROM ${T}
      WHERE parent_id IS NULL AND menu_type = 'dropdown'
        AND (lower(coalesce(html_id, '')) = ANY($1::text[]) OR name ~* $2)
      ORDER BY is_active DESC, id ASC LIMIT 1`,
    [htmlIds, nomeRe]
  );
  return rows[0] || null;
}

async function children(client, parentId) {
  const { rows } = await client.query(
    `SELECT id, name, path, menu_type, sort_order, is_active, is_public
       FROM ${T} WHERE parent_id = $1 ORDER BY sort_order ASC, id ASC`,
    [parentId]
  );
  return rows;
}

// Cria (ou reaproveita) um submenu dentro do dropdown.
async function ensureSubmenu(client, parentId, name, sortOrder) {
  const found = await client.query(
    `SELECT id FROM ${T}
      WHERE parent_id = $1 AND menu_type = 'submenu' AND name ~* $2
      ORDER BY id LIMIT 1`,
    [parentId, `^\\W*${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\W*$`]
  );
  if (found.rows[0]) {
    await client.query(
      `UPDATE ${T} SET sort_order = $2, is_active = true, updated_at = now() WHERE id = $1`,
      [found.rows[0].id, sortOrder]
    );
    return Number(found.rows[0].id);
  }
  const ins = await client.query(
    `INSERT INTO ${T} (name, path, is_active, menu_type, parent_id, sort_order)
     VALUES ($1, '#', true, 'submenu', $2, $3) RETURNING id`,
    [name, parentId, sortOrder]
  );
  return Number(ins.rows[0].id);
}

async function moveLink(client, id, parentId, sortOrder) {
  await client.query(
    `UPDATE ${T} SET parent_id = $2, sort_order = $3, updated_at = now() WHERE id = $1`,
    [id, parentId, sortOrder]
  );
}

// Dá acesso ao módulo novo/destino para quem já acessa algum dos módulos de origem.
async function grantFrom(client, targetId, sourceIds) {
  if (!sourceIds.length) return 0;
  const reg = await client.query(`SELECT to_regclass('public."userModules"') AS t`);
  if (!reg.rows[0]?.t) return 0;
  const { rowCount } = await client.query(
    `INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
     SELECT DISTINCT um.usuario_id, $1::bigint, true
       FROM public."userModules" um
      WHERE um.modulo_id = ANY($2::bigint[]) AND um.pode_acessar = true
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE
       SET pode_acessar = true, updated_at = now()
       WHERE public."userModules".pode_acessar = false`,
    [targetId, sourceIds]
  );
  return rowCount;
}

// Copia também o perfil (usersProfile) de um módulo para outro, só onde o
// destino ainda está sem acesso (mesma regra do migrateMenuToModuleSystem.js).
async function copyProfile(client, fromId, toId) {
  const reg = await client.query(`SELECT to_regclass('public."usersProfile"') AS t`);
  if (!reg.rows[0]?.t) return 0;
  const { rowCount } = await client.query(
    `INSERT INTO public."usersProfile"
       (usuario_id, modulo_id, profile, can_view, can_create, can_edit, can_delete, can_export)
     SELECT usuario_id, $2, profile, can_view, can_create, can_edit, can_delete, can_export
       FROM public."usersProfile" WHERE modulo_id = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE
       SET profile = EXCLUDED.profile, can_view = EXCLUDED.can_view,
           can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit,
           can_delete = EXCLUDED.can_delete, can_export = EXCLUDED.can_export,
           updated_at = now()
       WHERE public."usersProfile".profile = 'SEM_ACESSO'`,
    [fromId, toId]
  );
  return rowCount;
}

async function reorganizarVendas(client) {
  const vendas = await rootDropdown(client, ['vendas'], '^\\W*vendas\\W*$');
  const comercial = await rootDropdown(client, ['gestao-comercial'], 'gest[aã]o\\s+comercial');
  if (!vendas) return { skipped: 'dropdown Vendas não encontrado' };

  const links = [
    ...(await children(client, vendas.id)),
    ...(comercial ? await children(client, comercial.id) : []),
  ].filter((r) => r.menu_type === 'link');

  const result = { vendas_id: Number(vendas.id), comercial_id: comercial ? Number(comercial.id) : null, colunas: {} };
  const usados = new Set();

  // Submenus Operação / Equipe / Relatórios
  const colIds = [];
  for (let c = 0; c < COLUNAS_VENDAS.length; c++) {
    const col = COLUNAS_VENDAS[c];
    const subId = await ensureSubmenu(client, vendas.id, col.name, (c + 1) * 10);
    colIds.push(subId);
    const movidos = [];
    for (let i = 0; i < col.links.length; i++) {
      // Se houver dois links iguais (ex.: Relatório de Vendas), usa o ativo.
      const row = links
        .filter((r) => !usados.has(r.id) && pastaDoPath(r.path) === col.links[i])
        .sort((a, b) => Number(b.is_active) - Number(a.is_active))[0];
      if (!row) continue;
      usados.add(row.id);
      await moveLink(client, row.id, subId, (i + 1) * 10);
      movidos.push(row.name.trim());
    }
    result.colunas[col.name] = movidos;
  }

  // O que sobrou (itens inativos, telas novas) vai para o fim de Operação.
  const sobras = links.filter((r) => !usados.has(r.id));
  for (let i = 0; i < sobras.length; i++) {
    await moveLink(client, sobras[i].id, colIds[0], 100 + i);
  }
  result.sobras_em_operacao = sobras.map((r) => r.name.trim());

  // Permissões: quem tinha Gestão Comercial passa a ver o dropdown Vendas;
  // cada coluna nova fica liberada para quem acessa algum link dela.
  if (comercial) {
    result.acesso_vendas = await grantFrom(client, Number(vendas.id), [Number(comercial.id)]);
    result.perfil_vendas = await copyProfile(client, Number(comercial.id), Number(vendas.id));
    const resto = await children(client, comercial.id);
    if (!resto.length) {
      await client.query(
        `UPDATE ${T} SET is_active = false, updated_at = now() WHERE id = $1`,
        [comercial.id]
      );
      result.gestao_comercial = 'inativado';
    }
  }
  for (const subId of colIds) {
    const filhos = (await children(client, subId)).map((r) => Number(r.id));
    await grantFrom(client, subId, filhos);
  }
  return result;
}

async function criarComprasParceiros(client) {
  const erp = await rootDropdown(client, ['gestao-erp'], 'gest[aã]o\\s+erp');
  if (!erp) return { skipped: 'dropdown Gestão ERP não encontrado' };

  const subs = (await children(client, erp.id)).filter((r) => r.menu_type === 'submenu');
  const secundarios = subs.find((s) => /secund/i.test(s.name));

  // Links de Fornecedores/Fabricantes que estão dentro do Gestão ERP.
  const candidatos = [];
  for (const s of subs) {
    (await children(client, s.id))
      .filter((r) => r.menu_type === 'link' && COMPRAS_PARCEIROS.links.includes(pastaDoPath(r.path)))
      .forEach((r) => candidatos.push(r));
  }
  if (!candidatos.length) return { skipped: 'Fornecedores/Fabricantes não encontrados no Gestão ERP' };

  // A coluna nova entra logo depois de Cadastros Secundários.
  const base = Number(secundarios?.sort_order ?? subs[subs.length - 1]?.sort_order ?? 0);
  await client.query(
    `UPDATE ${T} SET sort_order = sort_order + 1, updated_at = now()
      WHERE parent_id = $1 AND sort_order > $2 AND NOT (menu_type = 'submenu' AND name ~* 'compras')`,
    [erp.id, base]
  );
  const subId = await ensureSubmenu(client, erp.id, COMPRAS_PARCEIROS.name, base + 1);

  const movidos = [];
  for (let i = 0; i < COMPRAS_PARCEIROS.links.length; i++) {
    const row = candidatos
      .filter((r) => pastaDoPath(r.path) === COMPRAS_PARCEIROS.links[i])
      .sort((a, b) => Number(b.is_active) - Number(a.is_active))[0];
    if (!row) continue;
    await moveLink(client, row.id, subId, (i + 1) * 10);
    movidos.push(row.name.trim());
  }
  await grantFrom(client, subId, candidatos.map((r) => Number(r.id)));
  return { gestao_erp_id: Number(erp.id), compras_parceiros_id: subId, movidos };
}

export async function runMenuVendasCompras20261109() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public."oneTimeJobs" (
        job_key text PRIMARY KEY,
        ran_at timestamp without time zone NOT NULL DEFAULT now(),
        result jsonb NULL
      );
    `);
    const done = await client.query('SELECT 1 FROM public."oneTimeJobs" WHERE job_key = $1', [JOB_KEY]);
    if (done.rowCount) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'já executado' };
    }

    const reg = await client.query(`SELECT to_regclass('public."moduleSystem"') AS t`);
    if (!reg.rows[0]?.t) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'tabela moduleSystem não existe' };
    }

    const result = {
      vendas: await reorganizarVendas(client),
      comprasParceiros: await criarComprasParceiros(client),
    };

    await client.query(
      'INSERT INTO public."oneTimeJobs" (job_key, result) VALUES ($1, $2::jsonb)',
      [JOB_KEY, JSON.stringify(result)]
    );
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
