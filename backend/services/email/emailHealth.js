// ╔══════════════════════════════════════════════════════════════════════╗
// ║ emailHealth.js — Diagnóstico do módulo de E-mails (IMAP)           ║
// ║ CONSART ERP — Health Service                                       ║
// ║                                                                    ║
// ║ Usado por:                                                         ║
// ║  • server.js  (/api/email/health)                                  ║
// ║  • jobs / cron                                                      ║
// ║  • monitoramento (Cloud Run / PM2)                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/**
 * Retorna o estado atual do módulo de e-mails (inbounds).
 * NÃO lança erro — sempre retorna objeto de status.
 */
export async function getEmailHealth() {
  const now = new Date().toISOString();

  try {
    /* -------------------------------------------------------------- */
    /* DB ping                                                        */
    /* -------------------------------------------------------------- */
    const dbPing = await pool.query('SELECT 1 AS ok;');
    const dbOk = dbPing?.rows?.[0]?.ok === 1;

    /* -------------------------------------------------------------- */
    /* Conta ativa                                                    */
    /* -------------------------------------------------------------- */
    const accRes = await pool.query(`
      SELECT
        id,
        email_address,
        is_active,
        last_imap_uid,
        updated_at
      FROM public."emailAccounts"
      WHERE is_active = true
      ORDER BY id ASC
      LIMIT 1;
    `);

    const account = accRes.rows?.[0] || null;

    /* -------------------------------------------------------------- */
    /* Estatísticas de inbounds                                       */
    /* -------------------------------------------------------------- */
    let inbounds = null;

    if (account?.id) {
      const statsRes = await pool.query(`
        SELECT
          COUNT(*)::bigint AS total,
          MAX(received_at) AS last_received_at,
          MAX(imap_uid)::bigint AS max_imap_uid
        FROM public."emailInbounds"
        WHERE account_id = $1;
      `, [account.id]);

      const stats = statsRes.rows?.[0] || {};

      inbounds = {
        total: Number(stats.total || 0),
        last_received_at: stats.last_received_at || null,
        max_imap_uid: Number(stats.max_imap_uid || 0),
      };
    }

    /* -------------------------------------------------------------- */
    /* Listener state (setado no bootstrap)                            */
    /* -------------------------------------------------------------- */
    const listener = {
      state: globalThis.__EMAIL_INBOUNDS_STATE || 'unknown', // running | failed | starting
      startedAt: globalThis.__EMAIL_INBOUNDS_STARTED_AT || null,
      lastError: globalThis.__EMAIL_INBOUNDS_LAST_ERROR || null,
    };

    return {
      ok: true,
      timestamp: now,

      db: {
        ok: dbOk,
      },

      listener,

      accountActive: account
        ? {
            id: account.id,
            email: account.email_address,
            last_imap_uid: Number(account.last_imap_uid || 0),
            updated_at: account.updated_at || null,
          }
        : null,

      inbounds,
    };
  } catch (err) {
    console.error('[emailHealth]', err);

    return {
      ok: false,
      timestamp: now,
      error: err?.message || 'EMAIL_HEALTH_FAILED',
    };
  }
}

/**
 * Helper simples: true se o listener está saudável
 */
export async function isEmailHealthy() {
  const health = await getEmailHealth();

  return (
    health.ok === true &&
    health.db?.ok === true &&
    health.listener?.state === 'running'
  );
}

/**
 * Default export (opcional, mas prático)
 */
export default {
  getEmailHealth,
  isEmailHealthy,
};
