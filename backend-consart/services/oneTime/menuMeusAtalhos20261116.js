// ╔══════════════════════════════════════════════════════════════════════╗
// ║ menuMeusAtalhos20261116.js — Item "Meus Atalhos de Teclado" no menu  ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║ Tabela do menu: public."moduleSystem" (menuConsart.js lê via API)    ║
// ║                                                                      ║
// ║ Cria o link Configurações › Sistema › Meus Atalhos de Teclado        ║
// ║ (/public/userShortcuts/userShortcuts.html) como item público         ║
// ║ (is_public): cada usuário só mexe nos próprios atalhos, então não    ║
// ║ precisa de permissão por usuário. Sem a coluna "Sistema", vai direto ║
// ║ no dropdown Configurações. Se o link já existir, não faz nada.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'menu_meus_atalhos_2026_11_16';
const LOCK_ID = 2026111601;
const T = 'public."moduleSystem"';
const PATH = '/public/userShortcuts/userShortcuts.html';
const NAME = 'Meus Atalhos de Teclado';

async function criarItem(client) {
  const existe = await client.query(
    `SELECT id FROM ${T} WHERE lower(path) LIKE '%/usershortcuts/usershortcuts.html%' LIMIT 1`
  );
  if (existe.rowCount) return { skipped: 'link já existe', id: Number(existe.rows[0].id) };

  const { rows: roots } = await client.query(
    `SELECT id FROM ${T}
      WHERE parent_id IS NULL AND menu_type = 'dropdown'
        AND (lower(coalesce(html_id, '')) = 'configuracoes' OR name ~* 'configura[cç]')
      ORDER BY is_active DESC, id ASC LIMIT 1`
  );
  const conf = roots[0];
  if (!conf) return { skipped: 'dropdown Configurações não encontrado' };

  const { rows: subs } = await client.query(
    `SELECT id FROM ${T}
      WHERE parent_id = $1 AND menu_type = 'submenu' AND is_active = true
        AND name ~* '(^\\W*sistema\\W*$)|cadastros\\s+auxiliares'
      ORDER BY id ASC LIMIT 1`,
    [conf.id]
  );
  const parentId = subs[0]?.id ?? conf.id;

  const { rows: ord } = await client.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM ${T} WHERE parent_id = $1`,
    [parentId]
  );

  const ins = await client.query(
    `INSERT INTO ${T} (name, path, is_active, menu_type, parent_id, sort_order, is_public)
     VALUES ($1, $2, true, 'link', $3, $4, true) RETURNING id`,
    [NAME, PATH, parentId, ord[0].next]
  );
  return {
    id: Number(ins.rows[0].id),
    parent_id: Number(parentId),
    em: subs[0] ? 'Configurações › Sistema' : 'Configurações',
  };
}

export async function runMenuMeusAtalhos20261116() {
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
    // is_public vem do moduleSystemSchema; garante aqui também (idempotente)
    await client.query(`ALTER TABLE ${T} ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false`);

    const result = await criarItem(client);

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
