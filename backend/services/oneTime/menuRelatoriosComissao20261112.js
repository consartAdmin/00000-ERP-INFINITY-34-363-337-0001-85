// ╔══════════════════════════════════════════════════════════════════════╗
// ║ menuRelatoriosComissao20261112.js — complemento do menuRelatorios    ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║                                                                      ║
// ║ O menuRelatorios20261112 levou "Comissão Vendedores" de              ║
// ║ Vendas > Relatórios para o menu Relatórios. O combinado era o item   ║
// ║ continuar também em Vendas > Relatórios: aqui entra uma cópia do     ║
// ║ link lá, com as mesmas permissões (userModules/usersProfile).        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'menu_relatorios_comissao_2026_11_12';
const LOCK_ID = 2026111202;
const T = 'public."moduleSystem"';
const ARQUIVO = 'salescommissionsfrominvoices.html';

function arquivoDoPath(path) {
  const limpo = String(path || '').trim().split(/[?#]/)[0];
  return (limpo.split('/').filter(Boolean).pop() || '').toLowerCase();
}

async function existe(client, tabela) {
  const r = await client.query('SELECT to_regclass($1) AS t', [`public."${tabela}"`]);
  return !!r.rows[0]?.t;
}

async function recolocarComissao(client) {
  // Submenu "Relatórios" dentro do dropdown Vendas.
  const { rows: subs } = await client.query(
    `SELECT s.id FROM ${T} s JOIN ${T} d ON d.id = s.parent_id
      WHERE d.parent_id IS NULL AND d.menu_type = 'dropdown'
        AND (lower(coalesce(d.html_id, '')) = 'vendas' OR d.name ~* '^\\W*vendas\\W*$')
        AND s.menu_type = 'submenu' AND s.name ~* 'relat[oó]rio'
      ORDER BY s.is_active DESC, s.id ASC LIMIT 1`
  );
  const sub = subs[0];
  if (!sub) return { skipped: 'Vendas > Relatórios não encontrado' };

  const { rows: links } = await client.query(
    `SELECT id, name, path, parent_id, is_active, is_public, is_external, feature
       FROM ${T} WHERE menu_type = 'link' ORDER BY is_active DESC, id ASC`
  );
  const comissoes = links.filter((r) => arquivoDoPath(r.path) === ARQUIVO);
  if (!comissoes.length) return { skipped: 'Comissão Vendedores não encontrada' };
  if (comissoes.some((r) => Number(r.parent_id) === Number(sub.id))) {
    return { skipped: 'já está em Vendas > Relatórios' };
  }

  const base = comissoes[0];
  const { rows: irmaos } = await client.query(
    `SELECT coalesce(max(sort_order), 0) AS m FROM ${T} WHERE parent_id = $1`, [sub.id]
  );
  const ins = await client.query(
    `INSERT INTO ${T} (name, path, is_active, menu_type, parent_id, sort_order, feature, is_external, is_public)
     VALUES ($1, $2, true, 'link', $3, $4, $5, $6, $7) RETURNING id`,
    [base.name.trim(), base.path, sub.id, Number(irmaos[0].m) + 10, base.feature ?? null,
      !!base.is_external, !!base.is_public]
  );
  const novoId = Number(ins.rows[0].id);
  const fontes = comissoes.map((r) => Number(r.id));

  let acessos = 0;
  if (await existe(client, 'userModules')) {
    acessos = (await client.query(
      `INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
       SELECT DISTINCT usuario_id, $1::bigint, true FROM public."userModules"
        WHERE modulo_id = ANY($2::bigint[]) AND pode_acessar = true
       ON CONFLICT (usuario_id, modulo_id) DO NOTHING`,
      [novoId, fontes]
    )).rowCount;
  }
  if (await existe(client, 'usersProfile')) {
    await client.query(
      `INSERT INTO public."usersProfile"
         (usuario_id, modulo_id, profile, can_view, can_create, can_edit, can_delete, can_export)
       SELECT DISTINCT ON (usuario_id) usuario_id, $1, profile, can_view, can_create, can_edit, can_delete, can_export
         FROM public."usersProfile" WHERE modulo_id = ANY($2::bigint[])
        ORDER BY usuario_id, modulo_id
       ON CONFLICT (usuario_id, modulo_id) DO NOTHING`,
      [novoId, fontes]
    );
  }
  return { comissao_id: novoId, vendas_relatorios_id: Number(sub.id), acessos };
}

export async function runMenuRelatoriosComissao20261112() {
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
    if (!(await existe(client, 'moduleSystem'))) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'tabela moduleSystem não existe' };
    }
    const result = await recolocarComissao(client);
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
