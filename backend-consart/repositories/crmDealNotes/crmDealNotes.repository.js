// ╔════════════════════════════════════════════════════════════════════╗
// ║ crmDealNotes.repository.js — Observações e alertas do card do CRM  ║
// ║ Tabela: public."crmDealNotes" (criada no primeiro uso)             ║
// ║ • OBSERVACAO: anotação livre sobre o lead.                         ║
// ║ • ALERTA: lembrete com data/hora; fica pendente até ser concluído  ║
// ║   (done_at). Vencido = alert_at <= agora e não concluído.          ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."crmDealNotes"';
const TB_DEALS = 'public."crmDeals"';

export const NOTE_TYPES = Object.freeze(['OBSERVACAO', 'ALERTA']);

let ready = null;

export function ensureCrmDealNotesTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id               BIGSERIAL PRIMARY KEY,
        deal_id          BIGINT NOT NULL REFERENCES ${TB_DEALS}(id) ON DELETE CASCADE,
        note_type        VARCHAR(20) NOT NULL,
        note             TEXT NOT NULL,
        alert_at         TIMESTAMPTZ,
        done_at          TIMESTAMPTZ,
        done_by_name     VARCHAR(150),
        created_by       BIGINT,
        created_by_name  VARCHAR(150),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "crmDealNotes_type_ck" CHECK (note_type IN ('OBSERVACAO', 'ALERTA')),
        CONSTRAINT "crmDealNotes_alert_ck" CHECK (note_type <> 'ALERTA' OR alert_at IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS "crmDealNotes_deal_idx" ON ${TB} (deal_id, created_at DESC);
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
    note_type: r.note_type,
    note: r.note,
    alert_at: r.alert_at,
    done_at: r.done_at,
    done_by_name: r.done_by_name,
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

function parseIds(dealIdRaw, noteIdRaw) {
  const dealId = positiveId(dealIdRaw);
  const noteId = positiveId(noteIdRaw);
  if (!dealId || !noteId) throw validationError('Registro inválido.');
  return { dealId, noteId };
}

// ─────────────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────────────

/** Totais por card (ícone do card): observações, alertas pendentes, vencidos e próximo alerta. */
export async function summary(crmCompany) {
  await ensureCrmDealNotesTable();
  const { rows } = await pool.query(
    `
      SELECT n.deal_id,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE n.note_type = 'ALERTA' AND n.done_at IS NULL)::int AS pending_alerts,
             COUNT(*) FILTER (WHERE n.note_type = 'ALERTA' AND n.done_at IS NULL AND n.alert_at <= NOW())::int AS overdue_alerts,
             MIN(n.alert_at) FILTER (WHERE n.note_type = 'ALERTA' AND n.done_at IS NULL) AS next_alert_at
        FROM ${TB} n
        JOIN ${TB_DEALS} d ON d.id = n.deal_id
       WHERE d.crm_company = $1
         AND COALESCE(d.is_closed, FALSE) = FALSE
       GROUP BY n.deal_id
    `,
    [crmCompany]
  );
  return rows.map((r) => ({
    deal_id: Number(r.deal_id),
    total: r.total,
    pending_alerts: r.pending_alerts,
    overdue_alerts: r.overdue_alerts,
    next_alert_at: r.next_alert_at,
  }));
}

/** Registros de um card: alertas pendentes primeiro (por data), depois o resto (mais recente primeiro). */
export async function listByDeal(dealIdRaw, crmCompany) {
  const dealId = positiveId(dealIdRaw);
  if (!dealId) throw validationError('Card inválido.');
  await ensureCrmDealNotesTable();
  await assertDeal(dealId, crmCompany);

  const { rows } = await pool.query(
    `
      SELECT * FROM ${TB}
       WHERE deal_id = $1
       ORDER BY (note_type = 'ALERTA' AND done_at IS NULL) DESC,
                CASE WHEN note_type = 'ALERTA' AND done_at IS NULL THEN alert_at END ASC,
                created_at DESC, id DESC
    `,
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

  const type = String(body.note_type || '').trim().toUpperCase();
  if (!NOTE_TYPES.includes(type)) throw validationError('Escolha Observação ou Alerta.');

  const note = text(body.note, 2000);
  if (!note) throw validationError('Escreva a observação.');

  let alertAt = null;
  if (type === 'ALERTA') {
    if (!body.alert_at) throw validationError('Informe a data e hora do alerta.');
    alertAt = new Date(body.alert_at);
    if (Number.isNaN(alertAt.getTime())) throw validationError('Data do alerta inválida.');
  }

  await ensureCrmDealNotesTable();
  await assertDeal(dealId, crmCompany);

  const { rows } = await pool.query(
    `
      INSERT INTO ${TB} (deal_id, note_type, note, alert_at, created_by, created_by_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [dealId, type, note, alertAt, positiveId(user.id), text(user.name, 150)]
  );
  return mapRow(rows[0]);
}

/** Marca/desmarca um alerta como concluído. */
export async function setDone(dealIdRaw, noteIdRaw, done, user = {}, crmCompany) {
  const { dealId, noteId } = parseIds(dealIdRaw, noteIdRaw);
  await ensureCrmDealNotesTable();
  await assertDeal(dealId, crmCompany);

  const { rows } = await pool.query(
    `
      UPDATE ${TB}
         SET done_at = CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
             done_by_name = CASE WHEN $3::boolean THEN $4 ELSE NULL END
       WHERE id = $1 AND deal_id = $2 AND note_type = 'ALERTA'
       RETURNING *
    `,
    [noteId, dealId, done !== false, text(user.name, 150)]
  );
  if (!rows.length) throw validationError('Alerta não encontrado.', 404);
  return mapRow(rows[0]);
}

export async function remove(dealIdRaw, noteIdRaw, crmCompany) {
  const { dealId, noteId } = parseIds(dealIdRaw, noteIdRaw);
  await ensureCrmDealNotesTable();
  await assertDeal(dealId, crmCompany);

  const { rowCount } = await pool.query(
    `DELETE FROM ${TB} WHERE id = $1 AND deal_id = $2`,
    [noteId, dealId]
  );
  if (!rowCount) throw validationError('Registro não encontrado.', 404);
  return { id: noteId };
}
