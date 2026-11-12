// ╔══════════════════════════════════════════════════════════════════════╗
// ║ menuRelatorios20261112.js — Reorganiza o menu "Relatórios" do dock   ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║                                                                      ║
// ║ O dropdown Relatórios tinha uma única coluna "Vendas" com 3 itens.   ║
// ║ Passa a ter 4 colunas:                                               ║
// ║   Vendas ............ Relatório de Vendas, Relatório de Vendas PDV,  ║
// ║                       Painel de Vendas, Comissão Vendedores          ║
// ║   Estoque e Compras . Posição de Estoque, Melhor Data de Compra      ║
// ║   Financeiro ........ Relatório de Recebimentos                      ║
// ║   Contábil .......... DRE Gerencial                                  ║
// ║                                                                      ║
// ║ Comissão Vendedores e DRE Gerencial continuam onde estavam (Vendas > ║
// ║ Relatórios e Contabilidade > Impostos): aqui entra uma cópia do link ║
// ║ com o mesmo endereço. Relatório de Recebimentos não tinha item no    ║
// ║ menu e ganha um. Quem já acessa o item de origem ganha acesso ao     ║
// ║ novo; quem acessa um item da coluna ganha acesso à coluna.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'menu_relatorios_2026_11_12';
const LOCK_ID = 2026111201;
const T = 'public."moduleSystem"';

function pastaDoPath(path) {
  const partes = String(path || '').trim().split('/').filter(Boolean);
  return partes.length >= 2 ? `${partes[partes.length - 2]}/` : '';
}

async function children(client, parentId) {
  const { rows } = await client.query(
    `SELECT id, name, path, menu_type, sort_order, is_active, is_public, feature
       FROM ${T} WHERE parent_id = $1 ORDER BY sort_order ASC, id ASC`,
    [parentId]
  );
  return rows;
}

// Todos os links do menu cujo endereço termina na pasta indicada.
async function linksDaPasta(client, pasta) {
  const { rows } = await client.query(
    `SELECT id, name, path, parent_id, is_active, is_public, feature, is_external
       FROM ${T} WHERE menu_type = 'link' AND path ILIKE $1 ORDER BY is_active DESC, id ASC`,
    [`%${pasta}%`]
  );
  return rows.filter((r) => pastaDoPath(r.path) === pasta);
}

async function ensureSubmenu(client, parentId, name, sortOrder) {
  const found = await client.query(
    `SELECT id FROM ${T}
      WHERE parent_id = $1 AND menu_type = 'submenu' AND name ~* $2
      ORDER BY id LIMIT 1`,
    [parentId, `^\\W*${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\W*$`]
  );
  if (found.rows[0]) {
    // Tira emoji/seta do nome antigo ("📈 Vendas ▸" vira "Vendas").
    await client.query(
      `UPDATE ${T} SET name = $3, sort_order = $2, is_active = true, updated_at = now() WHERE id = $1`,
      [found.rows[0].id, sortOrder, name]
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

// Coloca um link na coluna. modo:
//  'mover'  → o link existente (de preferência um que já está no Relatórios) muda de lugar
//  'copiar' → cria um link novo com o mesmo endereço; o original fica onde está
// Se não existir link para a pasta, cria um com `novo` (nome + path).
async function colocarLink(client, { pasta, nome, modo, novo, origensAcesso = [] }, relatoriosIds, subId, sortOrder) {
  const existentes = await linksDaPasta(client, pasta);
  const noRelatorios = existentes.filter((r) => relatoriosIds.has(Number(r.parent_id)));

  if (modo === 'mover' && (noRelatorios[0] || existentes[0])) {
    const row = noRelatorios[0] || existentes[0];
    await client.query(
      `UPDATE ${T} SET parent_id = $2, sort_order = $3, is_active = true,
              name = COALESCE($4, name), updated_at = now() WHERE id = $1`,
      [row.id, subId, sortOrder, nome || null]
    );
    const fontes = [...existentes.filter((r) => r.id !== row.id).map((r) => Number(r.id)), ...origensAcesso];
    const acessos = await grantFrom(client, Number(row.id), fontes);
    return { id: Number(row.id), nome: nome || row.name.trim(), acao: row.is_active ? 'movido' : 'movido e ativado', acessos };
  }

  if (modo === 'copiar' && noRelatorios[0]) {
    // Rodou parcialmente antes ou alguém já colocou: só ajusta.
    const row = noRelatorios[0];
    await client.query(
      `UPDATE ${T} SET parent_id = $2, sort_order = $3, is_active = true,
              name = COALESCE($4, name), updated_at = now() WHERE id = $1`,
      [row.id, subId, sortOrder, nome || null]
    );
    return { id: Number(row.id), nome: nome || row.name.trim(), acao: 'já estava' };
  }

  const base = existentes[0];
  const path = base?.path || novo?.path;
  if (!path) return { pasta, acao: 'não encontrado' };
  const ins = await client.query(
    `INSERT INTO ${T} (name, path, is_active, menu_type, parent_id, sort_order, feature, is_external, is_public)
     VALUES ($1, $2, true, 'link', $3, $4, $5, COALESCE($6, false), COALESCE($7, false)) RETURNING id`,
    [nome || base?.name?.trim() || novo?.name, path, subId, sortOrder,
      base?.feature ?? null, base?.is_external ?? null, base?.is_public ?? null]
  );
  const id = Number(ins.rows[0].id);
  const fontes = [...existentes.map((r) => Number(r.id)), ...origensAcesso];
  const acessos = await grantFrom(client, id, fontes);
  for (const r of existentes) await copyProfile(client, Number(r.id), id);
  return { id, nome: nome || base?.name?.trim() || novo?.name, acao: base ? 'cópia' : 'criado', acessos };
}

async function idsDasPastas(client, pastas) {
  const ids = [];
  for (const p of pastas) (await linksDaPasta(client, p)).forEach((r) => ids.push(Number(r.id)));
  return ids;
}

async function reorganizar(client) {
  const { rows } = await client.query(
    `SELECT id, name FROM ${T}
      WHERE parent_id IS NULL AND menu_type = 'dropdown'
        AND (lower(coalesce(html_id, '')) = 'relatorios' OR name ~* 'relat[oó]rio')
      ORDER BY is_active DESC, id ASC LIMIT 1`
  );
  const rel = rows[0];
  if (!rel) return { skipped: 'dropdown Relatórios não encontrado' };
  const relId = Number(rel.id);

  // Ids do dropdown e dos submenus dele (para saber o que "já está no Relatórios").
  const subsAntigos = (await children(client, relId)).filter((r) => r.menu_type === 'submenu');
  const relatoriosIds = new Set([relId, ...subsAntigos.map((s) => Number(s.id))]);

  const acessoRecebimentos = await idsDasPastas(client, ['accountsReceivable/', 'accountsReceivableReports/']);
  const acessoEstoque = await idsDasPastas(client, ['reportsProductsStock/']);
  // DRE Gerencial estava inativo: libera também para quem acessa o menu Contabilidade.
  const contab = await client.query(
    `SELECT id FROM ${T} WHERE parent_id IS NULL AND menu_type = 'dropdown' AND name ~* 'contabilidade'`
  );
  const acessoContabil = [
    ...(await idsDasPastas(client, ['dreGerencial/'])),
    ...contab.rows.map((r) => Number(r.id)),
  ];
  const acessoVendas = await idsDasPastas(client, ['salesReport/']);

  const COLUNAS = [
    {
      name: 'Vendas',
      links: [
        { pasta: 'salesReport/', nome: 'Relatório de Vendas', modo: 'mover' },
        { pasta: 'pdvSalesReport/', nome: 'Relatório de Vendas PDV', modo: 'mover', origensAcesso: acessoVendas },
        { pasta: 'salesDashboard/', nome: 'Painel de Vendas', modo: 'mover' },
        { pasta: 'salesCommissionsFromInvoices/', nome: 'Comissão Vendedores', modo: 'copiar' },
      ],
    },
    {
      name: 'Estoque e Compras',
      links: [
        { pasta: 'reportsProductsStock/', nome: 'Posição de Estoque', modo: 'mover' },
        { pasta: 'betterDateToBuy/', nome: 'Melhor Data de Compra', modo: 'mover', origensAcesso: acessoEstoque },
      ],
    },
    {
      name: 'Financeiro',
      links: [
        {
          pasta: 'accountsReceivableReports/', nome: 'Relatório de Recebimentos', modo: 'copiar',
          novo: { path: '../accountsReceivableReports/accountsReceivableReports.html' },
          origensAcesso: acessoRecebimentos,
        },
      ],
    },
    {
      name: 'Contábil',
      links: [
        { pasta: 'dreGerencial/', nome: 'DRE Gerencial', modo: 'copiar', origensAcesso: acessoContabil },
      ],
    },
  ];

  const result = { relatorios_id: relId, colunas: {} };
  const colIds = [];
  for (let c = 0; c < COLUNAS.length; c++) {
    const col = COLUNAS[c];
    const subId = await ensureSubmenu(client, relId, col.name, (c + 1) * 10);
    colIds.push(subId);
    relatoriosIds.add(subId);
    result.colunas[col.name] = [];
    for (let i = 0; i < col.links.length; i++) {
      result.colunas[col.name].push(await colocarLink(client, col.links[i], relatoriosIds, subId, (i + 1) * 10));
    }
  }

  // Links soltos que ficaram nos submenus antigos vão para o fim de Vendas;
  // submenus antigos vazios ficam inativos.
  const sobras = [];
  for (const s of subsAntigos) {
    if (colIds.includes(Number(s.id))) continue;
    const filhos = await children(client, s.id);
    for (const f of filhos) {
      await client.query(`UPDATE ${T} SET parent_id = $2, sort_order = $3, updated_at = now() WHERE id = $1`,
        [f.id, colIds[0], 100 + sobras.length]);
      sobras.push(f.name.trim());
    }
    await client.query(`UPDATE ${T} SET is_active = false, updated_at = now() WHERE id = $1`, [s.id]);
  }
  result.sobras_em_vendas = sobras;

  // Coluna liberada para quem acessa algum link dela; dropdown para quem acessa alguma coluna.
  for (const subId of colIds) {
    const filhos = (await children(client, subId)).map((r) => Number(r.id));
    await grantFrom(client, subId, filhos);
  }
  await grantFrom(client, relId, colIds);
  return result;
}

export async function runMenuRelatorios20261112() {
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

    const result = await reorganizar(client);

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
