// ╔════════════════════════════════════════════════════════════════════╗
// ║ crmDealContacts.repository.js — Contatos feitos no card do CRM     ║
// ║ Tabela: public."crmDealContacts" (criada no primeiro uso)          ║
// ║ • Um registro por contato: WhatsApp, Ligação ou E-mail, com data,  ║
// ║   observação e quem registrou.                                     ║
// ║ • Ao registrar, a "Última atividade" do card passa a ser a data    ║
// ║   do contato (se for mais nova).                                   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."crmDealContacts"';
const TB_DEALS = 'public."crmDeals"';

export const CONTACT_TYPES = Object.freeze(['WHATSAPP', 'LIGACAO', 'EMAIL']);

let ready = null;

export function ensureCrmDealContactsTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id               BIGSERIAL PRIMARY KEY,
        deal_id          BIGINT NOT NULL REFERENCES ${TB_DEALS}(id) ON DELETE CASCADE,
        contact_type     VARCHAR(20) NOT NULL,
        contacted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        note             TEXT,
        created_by       BIGINT,
        created_by_name  VARCHAR(150),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "crmDealContacts_type_ck" CHECK (contact_type IN ('WHATSAPP', 'LIGACAO', 'EMAIL'))
      );
      CREATE INDEX IF NOT EXISTS "crmDealContacts_deal_idx" ON ${TB} (deal_id, contacted_at DESC);
    `).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function text(value, max) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapRow(r) {
  return {
    id: Number(r.id),
    deal_id: Number(r.deal_id),
    contact_type: r.contact_type,
    contacted_at: r.contacted_at,
    note: r.note,
    created_by: r.created_by != null ? Number(r.created_by) : null,
    created_by_name: r.created_by_name,
    created_at: r.created_at,
  };
}

async function assertDeal(dealId, crmCompany) {
  const { rows } = await pool.query(
    `SELECT id FROM ${TB_DEALS} WHERE id = $1 AND crm_company = $2`,
    [dealId, crmCompany]
  );
  if (!rows.length) throw validationError('Card não encontrado.', 404);
}

// ─────────────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────────────

/** Totais por card e tipo (para os ícones dos cards abertos). */
export async function summary(crmCompany) {
  await ensureCrmDealContactsTable();
  const { rows } = await pool.query(
    `
      SELECT c.deal_id, c.contact_type, COUNT(*)::int AS total, MAX(c.contacted_at) AS last_at
        FROM ${TB} c
        JOIN ${TB_DEALS} d ON d.id = c.deal_id
       WHERE d.crm_company = $1
         AND COALESCE(d.is_closed, FALSE) = FALSE
       GROUP BY c.deal_id, c.contact_type
    `,
    [crmCompany]
  );
  return rows.map((r) => ({
    deal_id: Number(r.deal_id),
    contact_type: r.contact_type,
    total: r.total,
    last_at: r.last_at,
  }));
}

/** Histórico de um card (mais recente primeiro). */
export async function listByDeal(dealIdRaw, crmCompany) {
  const dealId = positiveId(dealIdRaw);
  if (!dealId) throw validationError('Card inválido.');
  await ensureCrmDealContactsTable();
  await assertDeal(dealId, crmCompany);

  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE deal_id = $1 ORDER BY contacted_at DESC, id DESC`,
    [dealId]
  );
  return rows.map(mapRow);
}

// ─────────────────────────────────────────────────────────────────────
// Gravação
// ─────────────────────────────────────────────────────────────────────

export async function create(dealIdRaw, body = {}, user = {}, crmCompany) {
  const dealId = positiveId(dealIdRaw);
  if (!dealId) throw validationError('Card inválido.');

  const type = String(body.contact_type || '').trim().toUpperCase();
  if (!CONTACT_TYPES.includes(type)) throw validationError('Escolha WhatsApp, Ligação ou E-mail.');

  let contactedAt = new Date();
  if (body.contacted_at) {
    contactedAt = new Date(body.contacted_at);
    if (Number.isNaN(contactedAt.getTime())) throw validationError('Data do contato inválida.');
  }

  await ensureCrmDealContactsTable();
  await assertDeal(dealId, crmCompany);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        INSERT INTO ${TB} (deal_id, contact_type, contacted_at, note, created_by, created_by_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [dealId, type, contactedAt, text(body.note, 2000), positiveId(user.id), text(user.name, 150)]
    );
    await client.query(
      `
        UPDATE ${TB_DEALS}
           SET last_activity_date = CASE
                 WHEN last_activity_date IS NULL OR last_activity_date < $2::timestamptz THEN $2::timestamptz
                 ELSE last_activity_date
               END
         WHERE id = $1
      `,
      [dealId, contactedAt]
    );
    await client.query('COMMIT');
    return mapRow(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function remove(dealIdRaw, contactIdRaw, crmCompany) {
  const dealId = positiveId(dealIdRaw);
  const contactId = positiveId(contactIdRaw);
  if (!dealId || !contactId) throw validationError('Contato inválido.');

  await ensureCrmDealContactsTable();
  await assertDeal(dealId, crmCompany);

  const { rowCount } = await pool.query(
    `DELETE FROM ${TB} WHERE id = $1 AND deal_id = $2`,
    [contactId, dealId]
  );
  if (!rowCount) throw validationError('Contato não encontrado.', 404);
  return { id: contactId };
}
