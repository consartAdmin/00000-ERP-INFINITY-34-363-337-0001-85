// ╔══════════════════════════════════════════════════════════════════════╗
// ║ menuRelatorios20261112.js — Reorganiza o menu Relatórios             ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║ Tabela do menu: public."moduleSystem" (menuConsart.js lê via API)    ║
// ║                                                                      ║
// ║ 4 colunas:                                                           ║
// ║  · Vendas: Relatório de Vendas, Relatório de Vendas PDV, Painel de   ║
// ║    Vendas, Comissão Vendedores (sai de Vendas > Relatórios)          ║
// ║  · Estoque e Compras: Posição de Estoque, Melhor Data de Compra      ║
// ║  · Financeiro: Relatório de Recebimentos (item novo)                 ║
// ║  · Contábil: DRE Gerencial (sai de Contabilidade > Impostos)         ║
// ║                                                                      ║
// ║ Links existentes só mudam de nome/lugar e são ativados: os ids       ║
// ║ continuam os mesmos, então as permissões (userModules) não mudam.    ║
// ║ Item novo ou reativado é liberado para quem já acessa a tela "base"  ║
// ║ (ex.: Recebimentos → quem acessa Contas a Receber). Negação          ║
// ║ explícita (pode_acessar = false) é respeitada nos links.             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'menu_relatorios_2026_11_12';
const LOCK_ID = 2026111201;
const T = 'public."moduleSystem"';

// [arquivo da tela, nome novo, path para criar se não existir, telas base da permissão]
const COLUNAS = [
  {
    name: 'Vendas', reuse: '^\\W*vendas\\W*$',
    links: [
      ['salesreport.html', 'Relatório de Vendas', null, []],
      ['pdvsalesreport.html', 'Relatório de Vendas PDV', null, ['salesreport.html']],
      ['salesdashboard.html', 'Painel de Vendas', null, ['salesreport.html']],
      ['salescommissionsfrominvoices.html', 'Comissão Vendedores', null, []],
    ],
  },
  {
    name: 'Estoque e Compras', reuse: 'estoque',
    links: [
      ['reportsproductsstock.html', 'Posição de Estoque', null, []],
      ['betterdatetobuy.html', 'Melhor Data de Compra', null, ['reportsproductsstock.html']],
    ],
  },
  {
    name: 'Financeiro', reuse: 'financ',
    links: [
      ['accountsreceivablereports.html', 'Relatório de Recebimentos',
        '../accountsReceivableReports/accountsReceivableReports.html', ['accountsreceivable.html']],
    ],
  },
  {
    name: 'Contábil', reuse: 'cont[aá]b',
    links: [
      ['dregerencial.html', 'DRE Gerencial', null, ['@parent']],
    ],
  },
];

const EMOJI_NOVO = '📊';
const LEADING_EMOJI_RE = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|⃣|\p{Emoji_Modifier}|‍(?:\p{Extended_Pictographic}|️)+)*)\s*/u;

function arquivoDoPath(path) {
  const limpo = String(path || '').trim().split(/[?#]/)[0];
  return (limpo.split('/').filter(Boolean).pop() || '').toLowerCase();
}

// Mantém o emoji do começo (a tela "Criação de Módulos" mostra) e troca o texto.
function novoNome(atual, texto) {
  const m = String(atual || '').match(LEADING_EMOJI_RE);
  return m ? `${m[1]} ${texto}` : texto;
}

async function children(client, parentId) {
  const { rows } = await client.query(
    `SELECT id, name, path, menu_type, sort_order, is_active, parent_id
       FROM ${T} WHERE parent_id = $1 ORDER BY sort_order ASC, id ASC`,
    [parentId]
  );
  return rows;
}

async function temUserModules(client) {
  const reg = await client.query(`SELECT to_regclass('public."userModules"') AS t`);
  return !!reg.rows[0]?.t;
}

// Libera targetId para quem acessa alguma das telas sourceIds.
// override=false: não mexe em quem já tem linha (inclusive negação explícita).
async function grantFrom(client, targetId, sourceIds, override) {
  const ids = [...new Set(sourceIds.map(Number))].filter((id) => id && id !== Number(targetId));
  if (!ids.length) return 0;
  const conflito = override
    ? `DO UPDATE SET pode_acessar = true, updated_at = now()
         WHERE public."userModules".pode_acessar = false`
    : 'DO NOTHING';
  const { rowCount } = await client.query(
    `INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
     SELECT DISTINCT um.usuario_id, $1::bigint, true
       FROM public."userModules" um
      WHERE um.modulo_id = ANY($2::bigint[]) AND um.pode_acessar = true
     ON CONFLICT (usuario_id, modulo_id) ${conflito}`,
    [targetId, ids]
  );
  return rowCount;
}

async function reorganizar(client) {
  const { rows: roots } = await client.query(
    `SELECT id FROM ${T}
      WHERE parent_id IS NULL AND menu_type = 'dropdown'
        AND (lower(coalesce(html_id, '')) = 'relatorios' OR name ~* 'relat[oó]rio')
      ORDER BY is_active DESC, id ASC LIMIT 1`
  );
  const rel = roots[0];
  if (!rel) return { skipped: 'dropdown Relatórios não encontrado' };

  const subs = (await children(client, rel.id)).filter((r) => r.menu_type === 'submenu');
  const noRel = (await children(client, rel.id)).filter((r) => r.menu_type === 'link');
  for (const s of subs) noRel.push(...(await children(client, s.id)).filter((r) => r.menu_type === 'link'));
  const idsNoRel = new Set(noRel.map((r) => String(r.id)));

  // Todos os links do sistema (para trazer telas que estão em outros menus)
  const { rows: todos } = await client.query(
    `SELECT id, name, path, menu_type, sort_order, is_active, parent_id
       FROM ${T} WHERE menu_type = 'link' ORDER BY id ASC`
  );
  const idsDoArquivo = (arquivo) => todos.filter((r) => arquivoDoPath(r.path) === arquivo).map((r) => Number(r.id));

  const grants = await temUserModules(client);
  const result = { relatorios_id: Number(rel.id), colunas: {}, acessos: 0 };
  const subUsados = new Set();
  const linkUsados = new Set();
  const colIds = [];

  for (let c = 0; c < COLUNAS.length; c++) {
    const col = COLUNAS[c];
    const re = new RegExp(col.reuse, 'i');
    const sub = subs.find((s) => !subUsados.has(s.id) && re.test(s.name));
    let subId;
    if (sub) {
      subId = Number(sub.id);
      subUsados.add(sub.id);
      await client.query(
        `UPDATE ${T} SET name = $2, sort_order = $3, is_active = true, updated_at = now() WHERE id = $1`,
        [subId, col.name, (c + 1) * 10]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO ${T} (name, path, is_active, menu_type, parent_id, sort_order)
         VALUES ($1, '#', true, 'submenu', $2, $3) RETURNING id`,
        [col.name, rel.id, (c + 1) * 10]
      );
      subId = Number(ins.rows[0].id);
    }
    colIds.push(subId);

    const feitos = [];
    for (let i = 0; i < col.links.length; i++) {
      const [arquivo, texto, pathNovo, bases] = col.links[i];
      // Prefere o link que já está em Relatórios; depois o ativo; depois o mais antigo.
      const row = todos
        .filter((r) => !linkUsados.has(r.id) && arquivoDoPath(r.path) === arquivo)
        .sort((a, b) =>
          Number(idsNoRel.has(String(b.id))) - Number(idsNoRel.has(String(a.id))) ||
          Number(b.is_active) - Number(a.is_active) ||
          Number(a.id) - Number(b.id))[0];

      let linkId;
      let paiAntigo = null;
      if (row) {
        linkId = Number(row.id);
        paiAntigo = row.parent_id == null ? null : Number(row.parent_id);
        linkUsados.add(row.id);
        await client.query(
          `UPDATE ${T} SET name = $2, parent_id = $3, sort_order = $4, is_active = true, updated_at = now()
            WHERE id = $1`,
          [linkId, novoNome(row.name, texto), subId, (i + 1) * 10]
        );
        feitos.push(`${row.name.trim()} → ${texto}${row.is_active ? '' : ' (ativado)'}`);
      } else if (pathNovo) {
        const ins = await client.query(
          `INSERT INTO ${T} (name, path, is_active, menu_type, parent_id, sort_order)
           VALUES ($1, $2, true, 'link', $3, $4) RETURNING id`,
          [`${EMOJI_NOVO} ${texto}`, pathNovo, subId, (i + 1) * 10]
        );
        linkId = Number(ins.rows[0].id);
        feitos.push(`${texto} (novo)`);
      } else {
        feitos.push(`${texto}: tela não encontrada no menu`);
        continue;
      }

      if (grants && bases.length) {
        const fontes = bases.flatMap((b) => (b === '@parent' ? (paiAntigo ? [paiAntigo] : []) : idsDoArquivo(b)));
        result.acessos += await grantFrom(client, linkId, fontes, false);
      }
    }
    result.colunas[col.name] = feitos;
  }

  // O que sobrou dentro de Relatórios vai para o fim de Vendas.
  const sobras = noRel.filter((r) => !linkUsados.has(r.id));
  for (let i = 0; i < sobras.length; i++) {
    await client.query(
      `UPDATE ${T} SET parent_id = $2, sort_order = $3, updated_at = now() WHERE id = $1`,
      [sobras[i].id, colIds[0], 100 + i]
    );
  }
  result.sobras_em_vendas = sobras.map((r) => `${r.name.trim()}${r.is_active ? '' : ' (inativo)'}`);

  // Outros submenus de Relatórios que ficaram vazios saem do painel (inativa, não apaga).
  for (const s of subs.filter((x) => !subUsados.has(x.id))) {
    if (!(await children(client, s.id)).length) {
      await client.query(`UPDATE ${T} SET is_active = false, updated_at = now() WHERE id = $1`, [s.id]);
      (result.submenus_inativados ||= []).push(s.name.trim());
    }
  }

  // Colunas e o próprio Relatórios ficam liberados para quem acessa algum link delas.
  if (grants) {
    const todosLinks = [];
    for (const subId of colIds) {
      const filhos = (await children(client, subId)).map((r) => Number(r.id));
      todosLinks.push(...filhos);
      result.acessos += await grantFrom(client, subId, filhos, true);
    }
    result.acessos += await grantFrom(client, rel.id, todosLinks, true);
  }
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
