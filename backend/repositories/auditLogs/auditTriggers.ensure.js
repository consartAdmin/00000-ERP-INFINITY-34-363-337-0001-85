// ╔════════════════════════════════════════════════════════════════════╗
// ║ auditTriggers.ensure.js — Auditoria automática de todas as tabelas ║
// ║ Cria (no boot) a trigger trg_audit_row em cada tabela do schema    ║
// ║ public: INSERT / UPDATE / DELETE vão para public."auditLogs" com   ║
// ║ o usuário (app.user_id / app.user_name, ver auditUserContext.js).  ║
// ║ UPDATE grava só os campos que mudaram. Senhas/tokens mascarados,   ║
// ║ valores enormes (XML, base64) resumidos. Erro na auditoria nunca   ║
// ║ bloqueia a operação principal (vira WARNING no log do PostgreSQL). ║
// ║                                                                    ║
// ║ ENV: AUDIT_TRIGGERS=off        → remove as triggers e não audita   ║
// ║      AUDIT_EXCLUDE_TABLES=a,b  → tabelas extras fora da auditoria  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TRIGGER_NAME = 'trg_audit_row';
const ADVISORY_LOCK_KEY = 874_202_611; // um boot por vez (várias instâncias no Cloud Run)

// Tabelas que não fazem sentido auditar (logs, sessões, filas, caches, tabelas temporárias)
// snake_case/minúsculas (email_logs, sessions) e camelCase (emailLogs, nfeWebhookEvents).
// "Log" em camelCase é sensível a maiúscula para não pegar productCatalog.
const EXCLUDE_PATTERNS = [
  /^auditlogs$/i,
  /(^|_)(logs?|sessions?|tokens?|otps?|cache|queue|webhook_events?)$/i,
  /[a-z0-9](Logs?|Sessions?|Tokens?|Otps?|Cache|Queue|WebhookEvents?)$/,
  /(^|_)(tmp|temp|bkp|backup|old)(_|$)/i,
  /[a-z0-9](Tmp|Temp|Bkp|Backup|Old)$/,
];

// Colunas que mudam sozinhas e não contam como alteração
const IGNORED_UPDATE_COLUMNS = [
  'updated_at', 'updatedat', 'update_at', 'modified_at', 'modifiedat',
  'last_update', 'lastupdate', 'last_seen', 'last_seen_at', 'last_access', 'last_access_at',
  'last_login', 'last_login_at', 'last_activity', 'last_activity_at',
];

function extraExcluded() {
  return new Set(
    String(process.env.AUDIT_EXCLUDE_TABLES || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAuditExcludedTable(name, extra = extraExcluded()) {
  const n = String(name || '');
  return EXCLUDE_PATTERNS.some((re) => re.test(n)) || extra.has(n.toLowerCase());
}

const SQL_TABLE = `
  CREATE TABLE IF NOT EXISTS public."auditLogs" (
    id          BIGSERIAL PRIMARY KEY,
    tabela      TEXT NOT NULL,
    register_id BIGINT,
    operation   TEXT NOT NULL,
    user_id     INTEGER,
    before      JSONB,
    after       JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE public."auditLogs" ADD COLUMN IF NOT EXISTS register_key TEXT;
  ALTER TABLE public."auditLogs" ADD COLUMN IF NOT EXISTS user_name TEXT;
  CREATE INDEX IF NOT EXISTS "auditLogs_tabela_key_idx" ON public."auditLogs" (tabela, register_key);
  CREATE INDEX IF NOT EXISTS "auditLogs_created_at_idx" ON public."auditLogs" (created_at);
  CREATE INDEX IF NOT EXISTS "auditLogs_user_id_idx" ON public."auditLogs" (user_id);
`;

// Máscara de colunas sensíveis (mesmas palavras do Banco de Dados) e corte de valores grandes
const SQL_CLEAN_FN = `
  CREATE OR REPLACE FUNCTION public.audit_clean_json(j jsonb)
  RETURNS jsonb
  LANGUAGE sql IMMUTABLE STRICT
  AS $fn$
    SELECT COALESCE(jsonb_object_agg(
      e.key,
      CASE
        WHEN e.value = 'null'::jsonb THEN e.value
        WHEN e.key ~* '(pass|passwd|password|senha|secret|token|api_?key|apikey|private_?key)' THEN to_jsonb('••••••'::text)
        WHEN length(e.value::text) > 2000 THEN to_jsonb('[conteúdo grande omitido: ' || length(e.value::text) || ' caracteres]')
        ELSE e.value
      END
    ), '{}'::jsonb)
    FROM jsonb_each(j) AS e;
  $fn$;
`;

const SQL_TRIGGER_FN = `
  CREATE OR REPLACE FUNCTION public.audit_row_change()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
  DECLARE
    v_old jsonb;
    v_new jsonb;
    v_before jsonb;
    v_after jsonb;
    v_row jsonb;
    v_pk text[];
    v_key text;
    v_id bigint;
  BEGIN
    IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
    v_row := COALESCE(v_new, v_old);

    v_pk := string_to_array(NULLIF(TG_ARGV[0], ''), ',');
    IF v_pk IS NOT NULL THEN
      SELECT string_agg(COALESCE(v_row ->> u.col, ''), ',' ORDER BY u.ord)
        INTO v_key
        FROM unnest(v_pk) WITH ORDINALITY AS u(col, ord);
      IF array_length(v_pk, 1) = 1 AND v_key ~ '^-?[0-9]{1,18}$' THEN
        v_id := v_key::bigint;
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT jsonb_object_agg(n.key, v_old -> n.key), jsonb_object_agg(n.key, n.value)
        INTO v_before, v_after
        FROM jsonb_each(v_new) AS n
       WHERE (v_old -> n.key) IS DISTINCT FROM n.value
         AND lower(n.key) <> ALL (ARRAY[${IGNORED_UPDATE_COLUMNS.map((c) => `'${c}'`).join(', ')}]);

      IF v_after IS NULL THEN
        RETURN NULL; -- só mudaram colunas automáticas (updated_at...)
      END IF;
    ELSE
      v_before := v_old;
      v_after := v_new;
    END IF;

    INSERT INTO public."auditLogs"
      (tabela, register_id, register_key, operation, user_id, user_name, before, after)
    VALUES (
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      v_id,
      v_key,
      'ROW_' || TG_OP,
      NULLIF(current_setting('app.user_id', true), '')::integer,
      NULLIF(current_setting('app.user_name', true), ''),
      public.audit_clean_json(v_before),
      public.audit_clean_json(v_after)
    );

    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[audit] %.% %: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, SQLERRM;
    RETURN NULL;
  END;
  $fn$;
`;

const SQL_TABLES = `
  SELECT
    c.relname AS table_name,
    (
      SELECT string_agg(a.attname, ',' ORDER BY array_position(i.indkey::int2[], a.attnum))
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       WHERE i.indrelid = c.oid AND i.indisprimary
    ) AS pk,
    EXISTS (
      SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = c.oid AND t.tgname = $1 AND NOT t.tgisinternal
    ) AS has_trigger
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relispartition
  ORDER BY c.relname;
`;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const quoteLiteral = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;

/**
 * Garante a tabela auditLogs, as funções e a trigger em cada tabela.
 * Retorna um resumo { created, removed, kept, excluded, failed }.
 */
export async function ensureAuditTriggers() {
  const enabled = String(process.env.AUDIT_TRIGGERS || 'on').toLowerCase() !== 'off';
  const summary = { enabled, created: 0, removed: 0, kept: 0, excluded: 0, failed: [] };

  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    if (enabled) {
      await client.query(SQL_TABLE);
      await client.query(SQL_CLEAN_FN);
      await client.query(SQL_TRIGGER_FN);
    }

    // Não espera tabela ocupada: tenta de novo no próximo boot
    await client.query("SET lock_timeout = '3s'");

    const extra = extraExcluded();
    const { rows } = await client.query(SQL_TABLES, [TRIGGER_NAME]);

    for (const row of rows) {
      const shouldAudit = enabled && !isAuditExcludedTable(row.table_name, extra);
      const table = `public.${quoteIdent(row.table_name)}`;

      if (!shouldAudit) summary.excluded += 1;

      try {
        if (shouldAudit && !row.has_trigger) {
          await client.query(
            `CREATE TRIGGER ${TRIGGER_NAME} AFTER INSERT OR UPDATE OR DELETE ON ${table}
             FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(${quoteLiteral(row.pk || '')})`
          );
          summary.created += 1;
        } else if (!shouldAudit && row.has_trigger) {
          await client.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${table}`);
          summary.removed += 1;
        } else if (shouldAudit) {
          summary.kept += 1;
        }
      } catch (err) {
        summary.failed.push(`${row.table_name}: ${err.message}`);
      }
    }

    await client.query('RESET lock_timeout');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }

  return summary;
}
