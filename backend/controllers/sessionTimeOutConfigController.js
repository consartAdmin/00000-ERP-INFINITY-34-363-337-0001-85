// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║ File: backend/controllers/sessionTimeOutConfigController.js                  ║
// ║ Desc: Controller para gerir a tabela sessionTimeOutConfig (GET / PUT)        ║
// ║ Padrão: ESM — usa pool direto do db.js                                         ║
// ║ Autor: Renato / Atlas (CONSART ERP)                                           ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

import pool from '../config/db.js'; // importando pool diretamente

// Campos permitidos / defaults (espelho do schema)
const DEFAULTS = {
  id: 1,
  enabled: false,
  idle_minutes: 10,
  warn_seconds: 0,
  silent: true,
  redirect_url: '/public/login/login.html',
  token_hours: 2
};

// Validade do login (JWT), em horas: limites aceitos na tela
export const TOKEN_HOURS_MIN = 1;
export const TOKEN_HOURS_MAX = 24;

const SELECT_COLS = 'id, enabled, idle_minutes, warn_seconds, silent, redirect_url, token_hours, updated_by, updated_at';

/**
 * Garante a tabela e a coluna token_hours (rodado no boot do server.js).
 * Tabelas antigas não tinham token_hours: a validade do login era 2h fixa no código.
 */
export async function ensureSessionTimeOutConfigTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "sessionTimeOutConfig" (
      id           INTEGER PRIMARY KEY,
      enabled      BOOLEAN NOT NULL DEFAULT false,
      idle_minutes INTEGER NOT NULL DEFAULT 10,
      warn_seconds INTEGER NOT NULL DEFAULT 0,
      silent       BOOLEAN NOT NULL DEFAULT true,
      redirect_url TEXT NOT NULL DEFAULT '/public/login/login.html',
      updated_by   TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE "sessionTimeOutConfig" ADD COLUMN IF NOT EXISTS token_hours INTEGER NOT NULL DEFAULT 2`);
  tokenHoursCache = { value: null, at: 0 };
}

// Cache curto para o login não consultar a tabela a cada requisição
let tokenHoursCache = { value: null, at: 0 };

/** Validade do login em horas, lida da tabela (padrão 2). */
export async function getTokenHours() {
  if (tokenHoursCache.value != null && Date.now() - tokenHoursCache.at < 60_000) {
    return tokenHoursCache.value;
  }
  let hours = DEFAULTS.token_hours;
  try {
    const { rows } = await pool.query('SELECT token_hours FROM "sessionTimeOutConfig" WHERE id = 1');
    const n = Number(rows?.[0]?.token_hours);
    if (Number.isFinite(n) && n >= TOKEN_HOURS_MIN && n <= TOKEN_HOURS_MAX) hours = Math.floor(n);
  } catch (err) {
    console.warn('[sessionTimeOutConfig] token_hours indisponível, usando 2h:', err?.message || err);
  }
  tokenHoursCache = { value: hours, at: Date.now() };
  return hours;
}

const toApi = (row) => ({
  id: row.id,
  enabled: !!row.enabled,
  idle_minutes: Number(row.idle_minutes),
  warn_seconds: Number(row.warn_seconds),
  silent: !!row.silent,
  redirect_url: row.redirect_url || DEFAULTS.redirect_url,
  token_hours: Number(row.token_hours) || DEFAULTS.token_hours,
  updated_by: row.updated_by || null,
  updated_at: row.updated_at || null
});

// Helper de validação simples
const normalizeBoolean = (v) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return null;
};
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : NaN;
};

/**
 * GET /api/session-config
 */
export async function getSessionConfig(req, res) {
  try {
    const sql = `SELECT ${SELECT_COLS} FROM "sessionTimeOutConfig" WHERE id = $1`;
    const { rows } = await pool.query(sql, [1]);

    if (!rows || rows.length === 0) {
      return res.status(200).json({ ...DEFAULTS });
    }

    return res.status(200).json(toApi(rows[0]));
  } catch (err) {
    console.error('[sessionTimeOutConfigController.get] erro', err);
    return res.status(500).json({ ok: false, error: 'Erro interno ao buscar configuração.' });
  }
}

/**
 * PUT /api/session-config
 */
export async function updateSessionConfig(req, res) {
  try {
    const body = req.body || {};
    const next = {};

    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
      const bv = normalizeBoolean(body.enabled);
      if (bv === null) return res.status(400).json({ ok: false, error: 'Campo "enabled" inválido.' });
      next.enabled = bv;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'idle_minutes')) {
      const iv = toInt(body.idle_minutes);
      if (!Number.isFinite(iv) || iv < 1) {
        return res.status(400).json({ ok: false, error: 'Campo "idle_minutes" inválido.' });
      }
      next.idle_minutes = iv;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'warn_seconds')) {
      const wv = toInt(body.warn_seconds);
      if (!Number.isFinite(wv) || wv < 0) {
        return res.status(400).json({ ok: false, error: 'Campo "warn_seconds" inválido.' });
      }
      next.warn_seconds = wv;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'silent')) {
      const sv = normalizeBoolean(body.silent);
      if (sv === null) return res.status(400).json({ ok: false, error: 'Campo "silent" inválido.' });
      next.silent = sv;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'redirect_url')) {
      const ru = String(body.redirect_url || '').trim();
      if (ru.length === 0) return res.status(400).json({ ok: false, error: 'Campo "redirect_url" inválido.' });
      next.redirect_url = ru;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'token_hours')) {
      const th = toInt(body.token_hours);
      if (!Number.isFinite(th) || th < TOKEN_HOURS_MIN || th > TOKEN_HOURS_MAX) {
        return res.status(400).json({ ok: false, error: `Validade do login deve ficar entre ${TOKEN_HOURS_MIN} e ${TOKEN_HOURS_MAX} horas.` });
      }
      next.token_hours = th;
    }

    let updated_by = null;
    if (Object.prototype.hasOwnProperty.call(body, 'updated_by')) {
      updated_by = body.updated_by ? String(body.updated_by).trim() : null;
    } else if (req.user && (req.user.name || req.user.username)) {
      updated_by = req.user.name || req.user.username;
    }

    if (Object.keys(next).length === 0 && updated_by == null) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar.' });
    }

    const fields = [];
    const params = [1]; // id sempre 1
    let idx = 2;

    for (const [key, val] of Object.entries(next)) {
      fields.push({ key, val });
      params.push(val);
      idx++;
    }
    if (updated_by != null) {
      fields.push({ key: 'updated_by', val: updated_by });
      params.push(updated_by);
    }

    const insertCols = ['id', ...fields.map(f => f.key)];
    const insertVals = fields.map((_, i) => `$${i + 2}`);
    insertVals.unshift('$1'); // id

    const updateAssignments = fields.map(f => `${f.key} = EXCLUDED.${f.key}`);
    const sql = `
      INSERT INTO "sessionTimeOutConfig" (${insertCols.join(', ')})
      VALUES (${insertVals.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${updateAssignments.join(', ')}, updated_at = now()
      RETURNING ${SELECT_COLS};
    `;

    const { rows } = await pool.query(sql, params);
    const saved = rows[0];
    if (!saved) {
      return res.status(500).json({ ok: false, error: 'Falha ao persistir configuração.' });
    }

    tokenHoursCache = { value: null, at: 0 };
    return res.status(200).json({ ok: true, data: toApi(saved) });
  } catch (err) {
    console.error('[sessionTimeOutConfigController.update] erro', err);
    return res.status(500).json({ ok: false, error: 'Erro interno ao atualizar configuração.' });
  }
}
