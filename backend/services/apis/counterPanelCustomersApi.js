// ╔══════════════════════════════════════════════════════════════════════╗
// ║ counterPanelCustomersApi.js — API/DAL Counter Panel (Cliente)        ║
// ║ CONSART ERP | ESM — PostgreSQL (pool)                                ║
// ║ Tabela: public."counterPanelCustomers"                               ║
// ║ - ensureTables (DDL + trigger updated_at)                            ║
// ║ - list/search/getById/create/update/remove                           ║
// ║ - markViewed (cliente marcou como visto)                             ║
// ║ - markDownloaded (cliente marcou como baixado) ✅                     ║
// ║ - status_visual (NEW|VIEWED|DOWNLOADED) ✅                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ----------------------------------------------------------------------
// Tabela
// ----------------------------------------------------------------------
const TB = 'public."counterPanelCustomers"';

// ----------------------------------------------------------------------
// DDL / Infra
// ----------------------------------------------------------------------
const DDL = `
  CREATE TABLE IF NOT EXISTS ${TB} (
    id               BIGSERIAL PRIMARY KEY,

    customer_id      BIGINT NOT NULL,
    customer_name    VARCHAR(255),

    doc_type         VARCHAR(50)  NOT NULL,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,

    competence_month INTEGER CHECK (competence_month BETWEEN 1 AND 12),
    competence_year  INTEGER CHECK (competence_year BETWEEN 2000 AND 2100),

    file_name        VARCHAR(255) NOT NULL,
    file_url         TEXT,
    mime_type        VARCHAR(120),
    file_size_bytes  BIGINT CHECK (file_size_bytes >= 0),

    status           VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    is_viewed        BOOLEAN NOT NULL DEFAULT FALSE,
    viewed_at        TIMESTAMP,

    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- ✅ Evolução compatível (GCS)
  ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS storage_driver VARCHAR(20);
  ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS gcs_bucket     VARCHAR(255);
  ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS gcs_key        TEXT;

  -- ✅ UX Status visual (Baixado)
  ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS is_downloaded  BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS downloaded_at  TIMESTAMP;

  -- Trigger updated_at (padrão CONSART)
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_counter_panel_customers'
    ) THEN
      CREATE OR REPLACE FUNCTION set_updated_at_counter_panel_customers()
      RETURNS TRIGGER AS $f$
      BEGIN
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $f$ LANGUAGE plpgsql;
    END IF;
  END$$;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_counter_panel_customers_updated_at'
    ) THEN
      CREATE TRIGGER trg_counter_panel_customers_updated_at
      BEFORE UPDATE ON ${TB}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at_counter_panel_customers();
    END IF;
  END$$;

  -- Índices
  CREATE INDEX IF NOT EXISTS idx_cpc_customer       ON ${TB}(customer_id);
  CREATE INDEX IF NOT EXISTS idx_cpc_doc_type       ON ${TB}(doc_type);
  CREATE INDEX IF NOT EXISTS idx_cpc_competence     ON ${TB}(competence_year, competence_month);
  CREATE INDEX IF NOT EXISTS idx_cpc_created_at     ON ${TB}(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_cpc_status         ON ${TB}(status);
  CREATE INDEX IF NOT EXISTS idx_cpc_title_lc       ON ${TB}((LOWER(title)));

  -- (GCS)
  CREATE INDEX IF NOT EXISTS idx_cpc_gcs_key        ON ${TB}((COALESCE(gcs_key,'')));

  -- (Download)
  CREATE INDEX IF NOT EXISTS idx_cpc_is_downloaded  ON ${TB}(is_downloaded);

  -- Opcional: evita duplicar mesmo arquivo pro mesmo cliente no mesmo período/tipo
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cpc_unique_doc
    ON ${TB}(customer_id, doc_type, competence_year, competence_month, file_name);
`;

export async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
const isFiniteNum = (v) => Number.isFinite(Number(v));

function statusVisualFromRow(row) {
  if (row?.is_downloaded) return 'DOWNLOADED';
  if (row?.is_viewed) return 'VIEWED';
  return 'NEW';
}

function rowToDoc(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    customer_id: Number(row.customer_id),
    customer_name: row.customer_name ?? null,

    doc_type: row.doc_type,
    title: row.title,
    description: row.description ?? null,

    competence_month: row.competence_month ?? null,
    competence_year: row.competence_year ?? null,

    file_name: row.file_name,
    file_url: row.file_url ?? null,
    mime_type: row.mime_type ?? null,
    file_size_bytes: isFiniteNum(row.file_size_bytes) ? Number(row.file_size_bytes) : null,

    storage_driver: row.storage_driver ?? null,
    gcs_bucket: row.gcs_bucket ?? null,
    gcs_key: row.gcs_key ?? null,

    status: row.status,

    // ✅ flags
    is_viewed: !!row.is_viewed,
    viewed_at: row.viewed_at ?? null,

    is_downloaded: !!row.is_downloaded,
    downloaded_at: row.downloaded_at ?? null,

    // ✅ derivado (UI)
    status_visual: statusVisualFromRow(row),

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normStr(v) {
  const s = String(v ?? '').trim();
  return s.length ? s : '';
}

function normNullableStr(v) {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
}

function validateMonthYear({ competence_month, competence_year }) {
  let m = competence_month;
  let y = competence_year;

  if (m !== null && m !== undefined && String(m) !== '') {
    m = Number(m);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Invalid competence_month (1-12)');
  } else {
    m = null;
  }

  if (y !== null && y !== undefined && String(y) !== '') {
    y = Number(y);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('Invalid competence_year (2000-2100)');
  } else {
    y = null;
  }

  return { competence_month: m, competence_year: y };
}

function validateSize(file_size_bytes) {
  if (file_size_bytes === null || file_size_bytes === undefined || String(file_size_bytes) === '') return null;
  const s = Number(file_size_bytes);
  if (!Number.isFinite(s) || s < 0) throw new Error('Invalid file_size_bytes (>= 0)');
  return Math.trunc(s);
}

function normalizeCreate(d = {}) {
  const out = {
    customer_id: d.customer_id ?? null,
    customer_name: d.customer_name ?? null,

    doc_type: normStr(d.doc_type),
    title: normStr(d.title),
    description: d.description ?? null,

    competence_month: d.competence_month ?? null,
    competence_year: d.competence_year ?? null,

    file_name: normStr(d.file_name),

    file_url: normNullableStr(d.file_url),

    mime_type: d.mime_type ?? null,
    file_size_bytes: d.file_size_bytes ?? null,

    status: d.status ?? 'AVAILABLE',

    storage_driver: normNullableStr(d.storage_driver),
    gcs_bucket: normNullableStr(d.gcs_bucket),
    gcs_key: normNullableStr(d.gcs_key),
  };

  if (!out.customer_id) throw new Error('Required: customer_id');
  if (!out.doc_type) throw new Error('Required: doc_type');
  if (!out.title) throw new Error('Required: title');
  if (!out.file_name) throw new Error('Required: file_name');

  const { competence_month, competence_year } = validateMonthYear(out);
  out.competence_month = competence_month;
  out.competence_year = competence_year;

  out.file_size_bytes = validateSize(out.file_size_bytes);

  if (!out.file_url && !out.gcs_key) {
    throw new Error('Required: file_url OR gcs_key');
  }

  return out;
}

// ----------------------------------------------------------------------
// Listagem & Busca (foco no cliente)
// ----------------------------------------------------------------------
export async function search({
  customer_id,
  q = '',
  doc_type,
  status,
  status_visual,              // ✅ NOVO (NEW|VIEWED|DOWNLOADED)
  competence_month,
  competence_year,
  only_unviewed = false,
  limit = 20,
  offset = 0,
} = {}) {
  const where = [];
  const args = [];
  let ai = 1;

  if (!customer_id) return { ok: false, error: 'Required: customer_id' };
  where.push(`customer_id = $${ai}`); args.push(customer_id); ai++;

  if (q && String(q).trim()) {
    const val = `%${String(q).toLowerCase().trim()}%`;
    where.push(`(
      LOWER(title) LIKE $${ai} OR
      LOWER(COALESCE(description,'')) LIKE $${ai} OR
      LOWER(file_name) LIKE $${ai}
    )`); args.push(val); ai++;
  }

  if (doc_type && String(doc_type).trim()) {
    where.push(`doc_type = $${ai}`); args.push(doc_type); ai++;
  }

  if (status && String(status).trim()) {
    where.push(`status = $${ai}`); args.push(status); ai++;
  }

  if (competence_month !== undefined && competence_month !== null && String(competence_month) !== '') {
    where.push(`competence_month = $${ai}`); args.push(Number(competence_month)); ai++;
  }

  if (competence_year !== undefined && competence_year !== null && String(competence_year) !== '') {
    where.push(`competence_year = $${ai}`); args.push(Number(competence_year)); ai++;
  }

  if (only_unviewed) where.push(`is_viewed = FALSE`);

  // ✅ filtro por status visual (prioridade pra UX)
  if (status_visual && String(status_visual).trim()) {
    const sv = String(status_visual).trim().toUpperCase();
    if (sv === 'NEW') where.push(`is_viewed = FALSE AND is_downloaded = FALSE`);
    else if (sv === 'VIEWED') where.push(`is_viewed = TRUE AND is_downloaded = FALSE`);
    else if (sv === 'DOWNLOADED') where.push(`is_downloaded = TRUE`);
  }

  // Por padrão, o cliente só deve ver "AVAILABLE" (se não passar status)
  if (!status) where.push(`status = 'AVAILABLE'`);

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const sqlRows = `
    SELECT *
    FROM ${TB}
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT $${ai} OFFSET $${ai + 1}
  `;
  args.push(Number(limit) || 20, Number(offset) || 0);

  const sqlCount = `
    SELECT COUNT(*) AS total
    FROM ${TB}
    ${whereSql}
  `;

  const client = await pool.connect();
  try {
    const [rowsRes, countRes] = await Promise.all([
      client.query(sqlRows, args),
      client.query(sqlCount, args.slice(0, ai - 1)),
    ]);
    const rows = rowsRes.rows.map(rowToDoc);
    const total = Number(countRes.rows?.[0]?.total || 0);
    return { ok: true, rows, total };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function list({ customer_id, limit = 20, offset = 0 } = {}) {
  return search({ customer_id, q: '', limit, offset });
}

// ----------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------
export async function getById(id, { customer_id } = {}) {
  if (!id) return { ok: false, error: 'Required: id' };
  if (!customer_id) return { ok: false, error: 'Required: customer_id' };

  const sql = `
    SELECT *
    FROM ${TB}
    WHERE id = $1 AND customer_id = $2
    LIMIT 1
  `;
  try {
    const r = await pool.query(sql, [id, customer_id]);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToDoc(r.rows[0]) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ----------------------------------------------------------------------
// Create / Update / Delete
// ----------------------------------------------------------------------
export async function create(data = {}) {
  const d = normalizeCreate(data);

  const cols = [
    'customer_id','customer_name',
    'doc_type','title','description',
    'competence_month','competence_year',
    'file_name','file_url','mime_type','file_size_bytes',
    'status',
    'storage_driver','gcs_bucket','gcs_key'
  ];
  const vals = cols.map((_, i) => `$${i + 1}`);
  const args = cols.map((c) => d[c]);

  const sql = `
    INSERT INTO ${TB} (${cols.join(',')})
    VALUES (${vals.join(',')})
    RETURNING *
  `;

  const client = await pool.connect();
  try {
    const r = await client.query(sql, args);
    return { ok: true, row: rowToDoc(r.rows[0]) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function update(id, data = {}, { customer_id } = {}) {
  if (!id) return { ok: false, error: 'Required: id' };
  if (!customer_id) return { ok: false, error: 'Required: customer_id' };

  const allowed = [
    'title','description',
    'doc_type',
    'competence_month','competence_year',
    'file_name','file_url','mime_type','file_size_bytes',
    'status',
    'customer_name',
    'storage_driver','gcs_bucket','gcs_key'
  ];

  const patch = {};
  for (const k of allowed) if (data[k] !== undefined) patch[k] = data[k];
  if (!Object.keys(patch).length) return { ok: false, error: 'NO_FIELDS' };

  if (patch.title !== undefined) patch.title = normStr(patch.title);
  if (patch.doc_type !== undefined) patch.doc_type = normStr(patch.doc_type);
  if (patch.file_name !== undefined) patch.file_name = normStr(patch.file_name);

  if (patch.file_url !== undefined) patch.file_url = normNullableStr(patch.file_url);
  if (patch.gcs_bucket !== undefined) patch.gcs_bucket = normNullableStr(patch.gcs_bucket);
  if (patch.gcs_key !== undefined) patch.gcs_key = normNullableStr(patch.gcs_key);
  if (patch.storage_driver !== undefined) patch.storage_driver = normNullableStr(patch.storage_driver);

  const my = validateMonthYear({
    competence_month: patch.competence_month,
    competence_year: patch.competence_year,
  });
  if (patch.competence_month !== undefined) patch.competence_month = my.competence_month;
  if (patch.competence_year !== undefined) patch.competence_year = my.competence_year;

  if (patch.file_size_bytes !== undefined) patch.file_size_bytes = validateSize(patch.file_size_bytes);

  if (patch.file_url === '' ) patch.file_url = null;

  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const args = keys.map((k) => patch[k]);
  args.push(id, customer_id);

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE id = $${args.length - 1} AND customer_id = $${args.length}
    RETURNING *
  `;

  const client = await pool.connect();
  try {
    const r = await client.query(sql, args);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToDoc(r.rows[0]) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function remove(id, { customer_id } = {}) {
  if (!id) return { ok: false, error: 'Required: id' };
  if (!customer_id) return { ok: false, error: 'Required: customer_id' };

  const sql = `DELETE FROM ${TB} WHERE id = $1 AND customer_id = $2`;
  const client = await pool.connect();
  try {
    const r = await client.query(sql, [id, customer_id]);
    return { ok: true, deleted: r.rowCount };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Cliente marca como visto
// ----------------------------------------------------------------------
export async function markViewed(id, { customer_id } = {}) {
  if (!id) return { ok: false, error: 'Required: id' };
  if (!customer_id) return { ok: false, error: 'Required: customer_id' };

  const sql = `
    UPDATE ${TB}
    SET is_viewed = TRUE, viewed_at = COALESCE(viewed_at, NOW()), updated_at = NOW()
    WHERE id = $1 AND customer_id = $2
    RETURNING *
  `;
  const client = await pool.connect();
  try {
    const r = await client.query(sql, [id, customer_id]);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToDoc(r.rows[0]) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Cliente marca como baixado ✅
// ----------------------------------------------------------------------
export async function markDownloaded(id, { customer_id } = {}) {
  if (!id) return { ok: false, error: 'Required: id' };
  if (!customer_id) return { ok: false, error: 'Required: customer_id' };

  const sql = `
    UPDATE ${TB}
    SET is_downloaded = TRUE,
        downloaded_at = COALESCE(downloaded_at, NOW()),
        updated_at = NOW()
    WHERE id = $1 AND customer_id = $2
    RETURNING *
  `;
  const client = await pool.connect();
  try {
    const r = await client.query(sql, [id, customer_id]);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToDoc(r.rows[0]) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
const counterPanelCustomersApi = {
  ensureTables,
  search,
  list,
  getById,
  create,
  update,
  remove,
  markViewed,
  markDownloaded, // ✅ novo
};

export default counterPanelCustomersApi;
