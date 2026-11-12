// ╔══════════════════════════════════════════════════════════════════════╗
// ║ menuConfiguracoes20261110.js — Reorganiza o menu Configurações       ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║ Tabela do menu: public."moduleSystem" (menuConsart.js lê via API)    ║
// ║                                                                      ║
// ║ 3 colunas com nomes em pt-BR:                                        ║
// ║  · Usuários e Acessos: Usuários, Perfis de Acesso, Permissões por    ║
// ║    Usuário, Acesso aos Dashboards, Senhas dos Módulos                ║
// ║  · E-mail: Contas de E-mail, E-mails por Usuário                     ║
// ║  · Sistema: Módulos do Sistema, Tempo de Sessão, Estados e Cidades   ║
// ║                                                                      ║
// ║ Os links só mudam de nome e de lugar (name/parent_id/sort_order): os ║
// ║ ids continuam os mesmos, então as permissões (userModules) não       ║
// ║ mudam. O emoji do começo do nome é mantido. Cada coluna fica         ║
// ║ liberada para quem acessa algum link dela.                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'menu_configuracoes_2026_11_10';
const LOCK_ID = 2026111001;
const T = 'public."moduleSystem"';

// Arquivo da tela (último pedaço do path) → nome novo, por coluna.
// `reuse` = regex do submenu atual que vira esta coluna (mantém o id).
const COLUNAS = [
  {
    name: 'Usuários e Acessos', reuse: '^\\W*usu[aá]rios\\W*$',
    links: [
      ['users.html', 'Usuários'],
      ['accessprofiles.html', 'Perfis de Acesso'],
      ['usersprofile.html', 'Permissões por Usuário'],
      ['usersdashboardaccess.html', 'Acesso aos Dashboards'],
      ['modulepasswords.html', 'Senhas dos Módulos'],
    ],
  },
  {
    name: 'E-mail', reuse: '^\\W*e-?mails?\\W*$',
    links: [
      ['emailaccounts.html', 'Contas de E-mail'],
      ['useremailaccounts.html', 'E-mails por Usuário'],
    ],
  },
  {
    name: 'Sistema', reuse: '(^\\W*sistema\\W*$)|cadastros\\s+auxiliares',
    links: [
      ['modulesystem.html', 'Módulos do Sistema'],
      ['sessiontimeout-config.html', 'Tempo de Sessão'],
      ['ibgelocations.html', 'Estados e Cidades (IBGE)'],
    ],
  },
];

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
    `SELECT id, name, path, menu_type, sort_order, is_active
       FROM ${T} WHERE parent_id = $1 ORDER BY sort_order ASC, id ASC`,
    [parentId]
  );
  return rows;
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

async function reorganizar(client) {
  const { rows: roots } = await client.query(
    `SELECT id FROM ${T}
      WHERE parent_id IS NULL AND menu_type = 'dropdown'
        AND (lower(coalesce(html_id, '')) = 'configuracoes' OR name ~* 'configura[cç]'
             )
      ORDER BY is_active DESC, id ASC LIMIT 1`
  );
  const conf = roots[0];
  if (!conf) return { skipped: 'dropdown Configurações não encontrado' };

  const subs = (await children(client, conf.id)).filter((r) => r.menu_type === 'submenu');
  const links = (await children(client, conf.id)).filter((r) => r.menu_type === 'link');
  for (const s of subs) links.push(...(await children(client, s.id)).filter((r) => r.menu_type === 'link'));

  const result = { configuracoes_id: Number(conf.id), colunas: {} };
  const subUsados = new Set();
  const linkUsados = new Set();
  const colIds = [];

  for (let c = 0; c < COLUNAS.length; c++) {
    const col = COLUNAS[c];
    const re = new RegExp(col.reuse, 'i');
    let sub = subs.find((s) => !subUsados.has(s.id) && re.test(s.name));
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
        [col.name, conf.id, (c + 1) * 10]
      );
      subId = Number(ins.rows[0].id);
    }
    colIds.push(subId);

    const movidos = [];
    for (let i = 0; i < col.links.length; i++) {
      const [arquivo, texto] = col.links[i];
      const row = links
        .filter((r) => !linkUsados.has(r.id) && arquivoDoPath(r.path) === arquivo)
        .sort((a, b) => Number(b.is_active) - Number(a.is_active))[0];
      if (!row) continue;
      linkUsados.add(row.id);
      await client.query(
        `UPDATE ${T} SET name = $2, parent_id = $3, sort_order = $4, updated_at = now() WHERE id = $1`,
        [row.id, novoNome(row.name, texto), subId, (i + 1) * 10]
      );
      movidos.push(`${row.name.trim()} → ${texto}`);
    }
    result.colunas[col.name] = movidos;
  }

  // O que sobrou (telas novas, itens inativos) vai para o fim de Sistema.
  const sistemaId = colIds[colIds.length - 1];
  const sobras = links.filter((r) => !linkUsados.has(r.id));
  for (let i = 0; i < sobras.length; i++) {
    await client.query(
      `UPDATE ${T} SET parent_id = $2, sort_order = $3, updated_at = now() WHERE id = $1`,
      [sobras[i].id, sistemaId, 100 + i]
    );
  }
  result.sobras_em_sistema = sobras.map((r) => `${r.name.trim()}${r.is_active ? '' : ' (inativo)'}`);

  // Outros submenus que ficaram vazios saem do painel (inativa, não apaga).
  for (const s of subs.filter((x) => !subUsados.has(x.id))) {
    if (!(await children(client, s.id)).length) {
      await client.query(`UPDATE ${T} SET is_active = false, updated_at = now() WHERE id = $1`, [s.id]);
      (result.submenus_inativados ||= []).push(s.name.trim());
    }
  }

  result.acessos = 0;
  for (const subId of colIds) {
    const filhos = (await children(client, subId)).map((r) => Number(r.id));
    result.acessos += await grantFrom(client, subId, filhos);
  }
  return result;
}

export async function runMenuConfiguracoes20261110() {
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
