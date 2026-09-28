// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ employeesApi.js — Service (DB + GCS Signed URLs) | ESM                   ║
// ║ CONSART ERP                                                              ║
// ║                                                                           ║
// ║ Tabelas:                                                                  ║
// ║  - public.employees                                                       ║
// ║  - public."employeesDocuments"                                            ║
// ║                                                                           ║
// ║ DB (CRUD): ensureTable, list, getById, create, update, remove             ║
// ║ Docs (DB): listDocuments, getDocumentById, createDocument, deleteDocument ║
// ║ GCS: signUpload (PUT), signDownload (GET)                                 ║
// ║                                                                           ║
// ║ ✅ Prefix FIXO employees: doc.employees (não herda GCS_PREFIX/anexos)     ║
// ║ ✅ Bucket FIXO employees: EMPLOYEES_GCS_BUCKET (docs.consart-demo-infinity)║
// ║ ✅ signUpload IGNORA gcs_path do client e gera SEMPRE o path correto      ║
// ║ ✅ confirm DB valida prefix (anti anexos/)                                ║
// ║ ✅ ensureTable idempotente + FK duplicate_object safe                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ─────────────────────────────────────────────────────────────
// Tabelas
// ─────────────────────────────────────────────────────────────
export const TB = 'public.employees';
export const PK = 'employee_id';
export const ALIAS = 'e';

export const TB_DOCS = 'public."employeesDocuments"';
export const PK_DOCS = 'employee_document_id';
export const DOC_ALIAS = 'ed';

// ─────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (v === '' || v == null ? null : (isFiniteNum(v) ? Number(v) : null));
const toStrOrNull = (v) => (v === '' || v == null ? null : String(v));

const toDateOrNull = (v) => {
  if (v === '' || v == null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toBoolOrNull = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase().trim();
  if (['1', 'true', 't', 'yes', 'y', 'sim'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'nao', 'não'].includes(s)) return false;
  return null;
};

// ─────────────────────────────────────────────────────────────
// Normalização Employees
// ─────────────────────────────────────────────────────────────
const COLS = Object.freeze({
  full_name: 'full_name',
  cpf: 'cpf',
  rg: 'rg',
  birth_date: 'birth_date',
  email: 'email',
  phone: 'phone',
  mobile: 'mobile',
  address: 'address',
  city: 'city',
  state: 'state',
  postal_code: 'postal_code',
  position: 'position',
  department: 'department',
  employment_type: 'employment_type',
  salary_base: 'salary_base',
  admission_date: 'admission_date',
  termination_date: 'termination_date',
  active: 'active',
  trial_start_date: 'trial_start_date',
  trial_end_date: 'trial_end_date',
  trial_extended: 'trial_extended',
  trial_extension_end_date: 'trial_extension_end_date',
  trial_notes: 'trial_notes',
  transport_benefit: 'transport_benefit',
  food_benefit: 'food_benefit',
  meal_benefit: 'meal_benefit',
  health_benefit: 'health_benefit',
  notes: 'notes',
});

function normalizePayload(input = {}) {
  const out = {};

  [
    'full_name', 'cpf', 'rg', 'email', 'phone', 'mobile', 'address', 'city', 'state',
    'postal_code', 'position', 'department', 'employment_type', 'trial_notes', 'notes',
  ].forEach((k) => { if (k in input) out[COLS[k]] = toStrOrNull(input[k]); });

  [
    'birth_date', 'admission_date', 'termination_date',
    'trial_start_date', 'trial_end_date', 'trial_extension_end_date',
  ].forEach((k) => { if (k in input) out[COLS[k]] = toDateOrNull(input[k]); });

  ['salary_base', 'transport_benefit', 'food_benefit', 'meal_benefit', 'health_benefit']
    .forEach((k) => { if (k in input) out[COLS[k]] = toNumOrNull(input[k]); });

  ['active', 'trial_extended'].forEach((k) => {
    if (k in input) out[COLS[k]] = toBoolOrNull(input[k]);
  });

  Object.keys(out).forEach((k) => {
    if (out[k] === null && k !== COLS.notes && k !== COLS.trial_notes) delete out[k];
  });

  return out;
}

// ─────────────────────────────────────────────────────────────
// Normalização Docs
// ─────────────────────────────────────────────────────────────
function normalizeDocPayload(input = {}) {
  const out = {
    employee_id: toNumOrNull(input.employee_id),
    document_type: toStrOrNull(input.document_type),
    file_name: toStrOrNull(input.file_name),
    mime_type: toStrOrNull(input.mime_type) || 'application/octet-stream',
    file_size: toNumOrNull(input.file_size) ?? 0,
    gcs_bucket: toStrOrNull(input.gcs_bucket),
    gcs_path: toStrOrNull(input.gcs_path),
    notes: toStrOrNull(input.notes),
    is_active: (input.is_active === undefined ? true : !!toBoolOrNull(input.is_active)),
  };

  Object.keys(out).forEach((k) => {
    if (out[k] === null && k !== 'notes') delete out[k];
  });

  return out;
}

// ─────────────────────────────────────────────────────────────
// Deadlock guard: single-flight + retry + advisory lock
// ─────────────────────────────────────────────────────────────
let _ensurePromise = null;

async function withRetry(fn, { tries = 4, baseDelayMs = 200 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code = e?.code;
      const retryable = code === '40P01' || code === '55P03' || code === '57014';
      if (!retryable || i === tries - 1) throw e;
      const wait = baseDelayMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function advisoryLock(client, keyText) {
  await client.query(`SELECT pg_advisory_lock(hashtext($1)::bigint)`, [keyText]);
}
async function advisoryUnlock(client, keyText) {
  await client.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [keyText]);
}

async function syncSerialSequence(client, tableName, pkCol) {
  const seqRes = await client.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [tableName, pkCol]);
  const seqName = seqRes.rows?.[0]?.seq;
  if (!seqName) return;

  const maxRes = await client.query(`SELECT COALESCE(MAX(${pkCol}), 0)::bigint AS max_id FROM ${tableName}`);
  const maxId = Number(maxRes.rows?.[0]?.max_id || 0);

  if (maxId <= 0) await client.query(`SELECT setval($1, 1, false)`, [seqName]);
  else await client.query(`SELECT setval($1, $2, true)`, [seqName, maxId]);
}

// ─────────────────────────────────────────────────────────────
// ensureTable
// ─────────────────────────────────────────────────────────────
export async function ensureTable() {
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = withRetry(async () => {
    const client = await pool.connect();
    const LOCK_KEY = 'consart.ensureTable.employees.all';

    try {
      await client.query(`SET lock_timeout TO '5s'`);
      await client.query(`SET statement_timeout TO '25s'`);

      await advisoryLock(client, LOCK_KEY);
      await client.query('BEGIN');

      await client.query(`
        CREATE OR REPLACE FUNCTION set_timestamp()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW()::timestamp;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // employees
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB} (
          employee_id              SERIAL PRIMARY KEY,
          full_name                VARCHAR(150) NOT NULL,
          cpf                      VARCHAR(14)  NOT NULL,
          rg                       VARCHAR(20),
          birth_date               DATE,
          email                    VARCHAR(150),
          phone                    VARCHAR(30),
          mobile                   VARCHAR(30),
          address                  TEXT,
          city                     VARCHAR(100),
          state                    CHAR(2),
          postal_code              VARCHAR(10),
          position                 VARCHAR(100),
          department               VARCHAR(100),
          employment_type          VARCHAR(50),
          salary_base              NUMERIC(12,2),
          admission_date           DATE NOT NULL,
          termination_date         DATE,
          active                   BOOLEAN DEFAULT TRUE,

          trial_start_date         DATE,
          trial_end_date           DATE,
          trial_extended           BOOLEAN DEFAULT FALSE,
          trial_extension_end_date DATE,
          trial_notes              TEXT,

          transport_benefit        NUMERIC(12,2) DEFAULT 0,
          food_benefit             NUMERIC(12,2) DEFAULT 0,
          meal_benefit             NUMERIC(12,2) DEFAULT 0,
          health_benefit           NUMERIC(12,2) DEFAULT 0,

          notes                    TEXT,
          created_at               TIMESTAMP DEFAULT NOW(),
          updated_at               TIMESTAMP DEFAULT NOW()
        );
      `);

      await client.query(`
        ALTER TABLE ${TB}
          ADD COLUMN IF NOT EXISTS rg                       VARCHAR(20),
          ADD COLUMN IF NOT EXISTS birth_date               DATE,
          ADD COLUMN IF NOT EXISTS email                    VARCHAR(150),
          ADD COLUMN IF NOT EXISTS phone                    VARCHAR(30),
          ADD COLUMN IF NOT EXISTS mobile                   VARCHAR(30),
          ADD COLUMN IF NOT EXISTS address                  TEXT,
          ADD COLUMN IF NOT EXISTS city                     VARCHAR(100),
          ADD COLUMN IF NOT EXISTS state                    CHAR(2),
          ADD COLUMN IF NOT EXISTS postal_code              VARCHAR(10),
          ADD COLUMN IF NOT EXISTS position                 VARCHAR(100),
          ADD COLUMN IF NOT EXISTS department               VARCHAR(100),
          ADD COLUMN IF NOT EXISTS employment_type          VARCHAR(50),
          ADD COLUMN IF NOT EXISTS salary_base              NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS termination_date         DATE,
          ADD COLUMN IF NOT EXISTS active                   BOOLEAN,
          ADD COLUMN IF NOT EXISTS trial_start_date         DATE,
          ADD COLUMN IF NOT EXISTS trial_end_date           DATE,
          ADD COLUMN IF NOT EXISTS trial_extended           BOOLEAN,
          ADD COLUMN IF NOT EXISTS trial_extension_end_date DATE,
          ADD COLUMN IF NOT EXISTS trial_notes              TEXT,
          ADD COLUMN IF NOT EXISTS transport_benefit        NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS food_benefit             NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS meal_benefit             NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS health_benefit           NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS notes                    TEXT,
          ADD COLUMN IF NOT EXISTS created_at               TIMESTAMP,
          ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMP;
      `);

      await client.query(`
        UPDATE ${TB}
        SET
          active            = COALESCE(active, TRUE),
          trial_extended    = COALESCE(trial_extended, FALSE),
          transport_benefit = COALESCE(transport_benefit, 0),
          food_benefit      = COALESCE(food_benefit, 0),
          meal_benefit      = COALESCE(meal_benefit, 0),
          health_benefit    = COALESCE(health_benefit, 0),
          created_at        = COALESCE(created_at, NOW()::timestamp),
          updated_at        = COALESCE(updated_at, NOW()::timestamp)
        WHERE
          active IS NULL
          OR trial_extended IS NULL
          OR transport_benefit IS NULL
          OR food_benefit IS NULL
          OR meal_benefit IS NULL
          OR health_benefit IS NULL
          OR created_at IS NULL
          OR updated_at IS NULL;
      `);

      await client.query(`
        ALTER TABLE ${TB}
          ALTER COLUMN active            SET DEFAULT TRUE,
          ALTER COLUMN trial_extended    SET DEFAULT FALSE,
          ALTER COLUMN transport_benefit SET DEFAULT 0,
          ALTER COLUMN food_benefit      SET DEFAULT 0,
          ALTER COLUMN meal_benefit      SET DEFAULT 0,
          ALTER COLUMN health_benefit    SET DEFAULT 0,
          ALTER COLUMN created_at        SET DEFAULT NOW(),
          ALTER COLUMN updated_at        SET DEFAULT NOW();
      `);

      await client.query(`
        ALTER TABLE ${TB}
          ALTER COLUMN full_name      SET NOT NULL,
          ALTER COLUMN cpf            SET NOT NULL,
          ALTER COLUMN admission_date SET NOT NULL;
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_cpf_unique
          ON ${TB} (LOWER(cpf::text));
        CREATE INDEX IF NOT EXISTS idx_employees_full_name_lower
          ON ${TB} (LOWER(full_name::text));
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_${ALIAS}_set_timestamp') THEN
            CREATE TRIGGER trg_${ALIAS}_set_timestamp
            BEFORE UPDATE ON ${TB}
            FOR EACH ROW
            EXECUTE FUNCTION set_timestamp();
          END IF;
        END $$;
      `);

      // employeesDocuments
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB_DOCS} (
          employee_document_id BIGSERIAL PRIMARY KEY,
          employee_id          BIGINT NOT NULL,
          document_type        TEXT NOT NULL,
          file_name            TEXT NOT NULL,
          mime_type            TEXT NOT NULL DEFAULT 'application/octet-stream',
          file_size            BIGINT NOT NULL DEFAULT 0,
          gcs_bucket           TEXT NOT NULL,
          gcs_path             TEXT NOT NULL,
          notes                TEXT,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          is_active            BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE lower(conname) = lower('employeesDocuments_employee_id_fkey')
          ) THEN
            BEGIN
              ALTER TABLE ${TB_DOCS}
                ADD CONSTRAINT employeesDocuments_employee_id_fkey
                FOREIGN KEY (employee_id) REFERENCES ${TB}(${PK})
                ON UPDATE CASCADE ON DELETE CASCADE;
            EXCEPTION
              WHEN duplicate_object THEN
                NULL;
            END;
          END IF;
        END $$;
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_${DOC_ALIAS}_set_timestamp') THEN
            CREATE TRIGGER trg_${DOC_ALIAS}_set_timestamp
            BEFORE UPDATE ON ${TB_DOCS}
            FOR EACH ROW
            EXECUTE FUNCTION set_timestamp();
          END IF;
        END $$;
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_employeesdocuments_employee_id
          ON ${TB_DOCS} (employee_id);
        CREATE INDEX IF NOT EXISTS idx_employeesdocuments_active
          ON ${TB_DOCS} (is_active);
      `);

      await syncSerialSequence(client, TB, PK);
      await syncSerialSequence(client, TB_DOCS, PK_DOCS);

      await client.query('COMMIT');
      return { ok: true };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { }
      throw e;
    } finally {
      try { await advisoryUnlock(client, LOCK_KEY); } catch { }
      client.release();
    }
  }).catch((e) => {
    _ensurePromise = null;
    throw e;
  });

  return _ensurePromise;
}

// ─────────────────────────────────────────────────────────────
// Employees CRUD
// ─────────────────────────────────────────────────────────────
export async function list({ q = '', active = true, limit = 50, offset = 0 } = {}) {
  await ensureTable();

  const params = [];
  let where = 'WHERE 1=1';

  if (active !== undefined && active !== null && active !== '') {
    params.push(!!active);
    where += ` AND active = $${params.length}`;
  }

  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    const p = `$${params.length}`;
    where += ` AND (
      LOWER(full_name) LIKE ${p}
      OR LOWER(cpf) LIKE ${p}
      OR LOWER(COALESCE(email,'')) LIKE ${p}
      OR LOWER(COALESCE(phone,'')) LIKE ${p}
      OR LOWER(COALESCE(mobile,'')) LIKE ${p}
      OR LOWER(COALESCE(city,'')) LIKE ${p}
      OR LOWER(COALESCE(department,'')) LIKE ${p}
      OR LOWER(COALESCE(position,'')) LIKE ${p}
    )`;
  }

  const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM ${TB} ${where}`, params);
  const total = countRes.rows?.[0]?.total || 0;

  const { rows } = await pool.query(
    `
      SELECT *
      FROM ${TB}
      ${where}
      ORDER BY created_at DESC, ${PK} DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `,
    params
  );

  return { rows, total, limit: Number(limit), offset: Number(offset) };
}

export async function getById(id) {
  await ensureTable();
  const { rows } = await pool.query(`SELECT * FROM ${TB} WHERE ${PK} = $1 LIMIT 1;`, [Number(id)]);
  return rows[0] || null;
}

export async function create(input = {}) {
  await ensureTable();
  const data = normalizePayload(input);

  if (!data.full_name) throw new Error('full_name is required');
  if (!data.cpf) throw new Error('cpf is required');
  if (!data.admission_date) throw new Error('admission_date is required');

  if (!('active' in data)) data.active = true;
  if (!('trial_extended' in data)) data.trial_extended = false;
  ['transport_benefit', 'food_benefit', 'meal_benefit', 'health_benefit'].forEach((k) => {
    if (!(k in data) || data[k] == null) data[k] = 0;
  });

  const cols = Object.keys(data);
  const vals = Object.values(data);
  const params = vals.map((_, i) => `$${i + 1}`);

  const { rows } = await pool.query(
    `INSERT INTO ${TB} (${cols.join(', ')}) VALUES (${params.join(', ')}) RETURNING *;`,
    vals
  );

  return rows[0];
}

export async function update(id, input = {}) {
  await ensureTable();
  const data = normalizePayload(input);
  if (!Object.keys(data).length) return getById(id);

  const sets = [];
  const vals = [];

  Object.entries(data).forEach(([col, val]) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  });

  sets.push(`updated_at = NOW()::timestamp`);

  const { rows } = await pool.query(
    `UPDATE ${TB} SET ${sets.join(', ')} WHERE ${PK} = $${vals.length + 1} RETURNING *;`,
    [...vals, Number(id)]
  );

  return rows[0] || null;
}

export async function remove(id, { hard = false } = {}) {
  await ensureTable();

  if (hard) {
    await pool.query(`DELETE FROM ${TB} WHERE ${PK} = $1`, [Number(id)]);
    return { ok: true, hard: true };
  }

  await pool.query(`UPDATE ${TB} SET active = FALSE, updated_at = NOW()::timestamp WHERE ${PK} = $1`, [Number(id)]);
  return { ok: true, hard: false };
}

// ─────────────────────────────────────────────────────────────
// Documents CRUD (DB)
// ─────────────────────────────────────────────────────────────
export async function listDocuments(employeeId, { active = true, limit = 50, offset = 0 } = {}) {
  await ensureTable();

  const params = [Number(employeeId)];
  let where = `WHERE employee_id = $1`;

  if (active !== undefined && active !== null && active !== '') {
    params.push(!!active);
    where += ` AND is_active = $${params.length}`;
  }

  const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM ${TB_DOCS} ${where}`, params);
  const total = countRes.rows?.[0]?.total || 0;

  const { rows } = await pool.query(
    `
      SELECT *
      FROM ${TB_DOCS}
      ${where}
      ORDER BY created_at DESC, ${PK_DOCS} DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `,
    params
  );

  return { rows, total, limit: Number(limit), offset: Number(offset) };
}

export async function getDocumentById(documentId) {
  await ensureTable();
  const { rows } = await pool.query(`SELECT * FROM ${TB_DOCS} WHERE ${PK_DOCS} = $1 LIMIT 1`, [Number(documentId)]);
  return rows[0] || null;
}

function ensureEmployeesBucket() {
  const b =
    toStrOrNull(process.env.GCS_EMPLOYEES_BUCKET) ||
    toStrOrNull(process.env.EMPLOYEES_GCS_BUCKET) ||
    'erp-infinity-00000';

  const out = String(b).trim();

  if (!out) {
    const err = new Error('GCS_EMPLOYEES_BUCKET is required');
    err.code = 'VALIDATION';
    throw err;
  }

  return out;
}

function getEmployeesPrefix() {
  const base =
    toStrOrNull(process.env.GCS_EMPLOYEES_BASE_PREFIX) ||
    'accounting/from_customer';

  const modulePrefix =
    toStrOrNull(process.env.GCS_EMPLOYEES_PREFIX) ||
    toStrOrNull(process.env.EMPLOYEES_GCS_PREFIX) ||
    'employees';

  return joinPath(base, modulePrefix);
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function safeFileName(name) {
  const n = String(name || 'file').trim();
  const base = n.split('/').pop().split('\\').pop();
  return base
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'file';
}

function safeSlug(s) {
  return String(s || 'DOC')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'DOC';
}

function employeeFolderName(employee = {}) {
  const name = safeSlug(employee.full_name || employee.name || 'EMPLOYEE');
  const id = Number(employee.employee_id || employee.id || employee.employeeId);

  return id ? `${name}-${id}` : name;
}

async function getEmployeeFolderById(employeeId) {
  const emp = await getById(employeeId);

  if (!emp) {
    const err = new Error('Employee not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  return employeeFolderName(emp);
}

async function buildGcsPath({ employee_id, document_type, file_name }) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const doc = safeSlug(document_type || 'DOCUMENTO');
  const prefix = getEmployeesPrefix();
  const employeeFolder = await getEmployeeFolderById(employee_id);

  return joinPath(prefix, employeeFolder, doc, `${ts}_${safeFileName(file_name)}`);
}

function assertEmployeesObjectPath(gcs_path) {
  const prefix = getEmployeesPrefix();
  const p = String(gcs_path || '').replace(/^\/+/, '');
  if (!p.startsWith(prefix + '/')) {
    const err = new Error(`gcs_path inválido: deve começar com "${prefix}/"`);
    err.code = 'VALIDATION';
    throw err;
  }
  if (p.toLowerCase().includes('/anexos/')) {
    const err = new Error('gcs_path inválido: não pode conter "/anexos/".');
    err.code = 'VALIDATION';
    throw err;
  }
  return p;
}

export async function createDocument(employeeId, input = {}) {
  await ensureTable();

  const data = normalizeDocPayload({ ...input, employee_id: employeeId });

  if (!data.employee_id) throw new Error('employee_id is required');
  if (!data.document_type) throw new Error('document_type is required');
  if (!data.file_name) throw new Error('file_name is required');

  // ✅ trava bucket/prefix corretos
  data.gcs_bucket = ensureEmployeesBucket();
  data.gcs_path = assertEmployeesObjectPath(data.gcs_path);

  if (!data.mime_type) data.mime_type = 'application/octet-stream';
  if (data.file_size == null) data.file_size = 0;
  if (data.is_active == null) data.is_active = true;

  const cols = Object.keys(data);
  const vals = Object.values(data);
  const params = vals.map((_, i) => `$${i + 1}`);

  const { rows } = await pool.query(
    `INSERT INTO ${TB_DOCS} (${cols.join(', ')}) VALUES (${params.join(', ')}) RETURNING *;`,
    vals
  );

  return rows[0];
}

export async function updateDocument(documentId, input = {}) {
  await ensureTable();

  const data = {};
  if (input.document_type !== undefined) data.document_type = toStrOrNull(input.document_type);
  if (input.file_name !== undefined) data.file_name = toStrOrNull(input.file_name);
  if (input.notes !== undefined) data.notes = toStrOrNull(input.notes);

  // ✅ troca de arquivo (novo upload já feito via signUpload)
  if (toStrOrNull(input.gcs_path)) {
    data.gcs_bucket = ensureEmployeesBucket();
    data.gcs_path = assertEmployeesObjectPath(input.gcs_path);
    data.mime_type = toStrOrNull(input.mime_type) || 'application/octet-stream';
    data.file_size = toNumOrNull(input.file_size) ?? 0;
  }

  if (data.document_type === null || data.file_name === null) {
    const err = new Error('document_type e file_name não podem ser vazios.');
    err.code = 'VALIDATION';
    throw err;
  }

  if (!Object.keys(data).length) return getDocumentById(documentId);

  const sets = [];
  const vals = [];

  Object.entries(data).forEach(([col, val]) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  });

  sets.push(`updated_at = NOW()::timestamp`);

  const { rows } = await pool.query(
    `UPDATE ${TB_DOCS} SET ${sets.join(', ')} WHERE ${PK_DOCS} = $${vals.length + 1} RETURNING *;`,
    [...vals, Number(documentId)]
  );

  return rows[0] || null;
}

export async function deleteDocument(documentId, { hard = false } = {}) {
  await ensureTable();

  if (hard) {
    await pool.query(`DELETE FROM ${TB_DOCS} WHERE ${PK_DOCS} = $1`, [Number(documentId)]);
    return { ok: true, hard: true };
  }

  await pool.query(`UPDATE ${TB_DOCS} SET is_active = FALSE, updated_at = NOW()::timestamp WHERE ${PK_DOCS} = $1`, [Number(documentId)]);
  return { ok: true, hard: false };
}

// ─────────────────────────────────────────────────────────────
// GCS Signed URLs
// ─────────────────────────────────────────────────────────────
async function getStorageClient() {
  try {
    const mod = await import('@google-cloud/storage');
    const { Storage } = mod;

    const hasCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const inCloudRun = !!process.env.K_SERVICE;
    console.log('[GCS] init Storage | inCloudRun=', inCloudRun, '| hasGOOGLE_APPLICATION_CREDENTIALS=', hasCreds);

    return new Storage();
  } catch (e) {
    console.error('[GCS] failed to load @google-cloud/storage', e);
    const err = new Error(
      'GCS_SIGNING_UNAVAILABLE: instale @google-cloud/storage e configure credenciais (GOOGLE_APPLICATION_CREDENTIALS ou Service Account no Cloud Run).'
    );
    err.code = 'GCS_SIGNING_UNAVAILABLE';
    err.cause = e;
    throw err;
  }
}

export async function signUpload(input = {}, { expiresInSec = 15 * 60 } = {}) {
  const employee_id = toNumOrNull(input.employee_id);
  const document_type = toStrOrNull(input.document_type) || 'DOCUMENTO';
  const file_name = safeFileName(input.file_name);
  const mime_type = toStrOrNull(input.mime_type) || 'application/octet-stream';
  const file_size = toNumOrNull(input.file_size) ?? 0;

  if (!employee_id) {
    const err = new Error('employee_id is required');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!file_name) {
    const err = new Error('file_name is required');
    err.code = 'VALIDATION';
    throw err;
  }

  // ✅ Bucket FIXO do módulo employees
  const gcs_bucket = ensureEmployeesBucket();

  // ✅ Path SEMPRE gerado aqui (ignora gcs_path do client)
  const gcs_path = await buildGcsPath({ employee_id, document_type, file_name });

  const storage = await getStorageClient();
  const file = storage.bucket(gcs_bucket).file(gcs_path);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInSec * 1000,
  });

  return {
    ok: true,
    signedUrl,
    method: 'PUT',
    expiresInSec,
    meta: { employee_id, document_type, file_name, mime_type, file_size, gcs_bucket, gcs_path },
  };
}

export async function signDownload(input = {}, { expiresInSec = 10 * 60 } = {}) {
  const gcs_bucket = ensureEmployeesBucket();

  let gcs_path = toStrOrNull(input.gcs_path);
  if (!gcs_path) {
    const err = new Error('Informe gcs_path (object).');
    err.code = 'VALIDATION';
    throw err;
  }

  // ✅ força prefix correto
  const prefix = getEmployeesPrefix();
  gcs_path = String(gcs_path).replace(/^\/+/, '');
  if (!gcs_path.startsWith(prefix + '/')) gcs_path = joinPath(prefix, gcs_path);

  // valida anti anexos
  gcs_path = assertEmployeesObjectPath(gcs_path);

  const storage = await getStorageClient();
  const file = storage.bucket(gcs_bucket).file(gcs_path);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInSec * 1000,
  });

  return { ok: true, signedUrl, method: 'GET', expiresInSec, gcs_bucket, gcs_path };
}

// ─────────────────────────────────────────────────────────────
// Default export
// ─────────────────────────────────────────────────────────────
export default {
  ensureTable,
  list,
  getById,
  create,
  update,
  remove,

  listDocuments,
  getDocumentById,
  createDocument,
  deleteDocument,

  signUpload,
  signDownload,
};
