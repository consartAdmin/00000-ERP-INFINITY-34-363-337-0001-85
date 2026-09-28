/* ╔══════════════════════════════════════════════════════════════════════╗
 * ║ dashBoardAlertsApi.js — API de Alertas do Dashboard (ESM)           ║
 * ║ CONSART ERP | PostgreSQL                                            ║
 * ║                                                                      ║
 * ║ - Consolida alertas de:                                              ║
 * ║     • E-mails recebidos (emailInbounds)                              ║
 * ║     • NF-e de entrada (nfeInbox)                                     ║
 * ║ - Função principal: getDashboardAlertsSummary                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝ */

import pool from '../../config/db.js';

const NFE_INBOX_TB = 'public."nfeInbox"';
const EMAIL_INBOUNDS_TB = 'public."emailInbounds"';

// ---------------------------------------------------------------------
// getEmailRecentCount — conta e-mails recentes
// ---------------------------------------------------------------------
async function getEmailRecentCount({ lookbackMinutes = 1440 } = {}) {
  const mins = Number.isFinite(lookbackMinutes) && lookbackMinutes > 0
    ? lookbackMinutes
    : 1440; // default 24h

  const sql = `
    SELECT COUNT(*) AS recent_count
    FROM ${EMAIL_INBOUNDS_TB}
    WHERE received_at >= now() - ($1::int * INTERVAL '1 minute');
  `;

  const values = [mins];
  const { rows } = await pool.query(sql, values);
  const count = Number(rows[0]?.recent_count || 0);
  return count;
}

// ---------------------------------------------------------------------
// getNfeRecentCount — conta NF-es recentes para o CNPJ (ou geral)
// ---------------------------------------------------------------------
async function getNfeRecentCount({
  cnpjEmpresa,
  lookbackDays = 1,
} = {}) {
  const days = Number.isFinite(lookbackDays) && lookbackDays > 0
    ? lookbackDays
    : 1;

  const where = [];
  const values = [];
  let idx = 1;

  // Filtro por CNPJ da empresa monitorada, se informado
  if (cnpjEmpresa) {
    where.push(`cnpj_empresa = $${idx++}`);
    values.push(cnpjEmpresa);
  }

  // Considera NF-es recentes pela data de autorização/emissão/criação
  where.push(`
    COALESCE(data_autorizacao, data_emissao, created_at) >=
      now() - ($${idx++}::int * INTERVAL '1 day')
  `);
  values.push(days);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT COUNT(*) AS recent_count
    FROM ${NFE_INBOX_TB}
    ${whereSql};
  `;

  const { rows } = await pool.query(sql, values);
  const count = Number(rows[0]?.recent_count || 0);
  return count;
}

// ---------------------------------------------------------------------
// getDashboardAlertsSummary — usado pelo controller
// ---------------------------------------------------------------------
export async function getDashboardAlertsSummary({
  cnpjEmpresa,
  emailLookbackMinutes = 1440, // 24h
  nfeLookbackDays = 1,         // 1 dia
} = {}) {
  const [emailRecentCount, nfeRecentCount] = await Promise.all([
    getEmailRecentCount({ lookbackMinutes: emailLookbackMinutes }),
    getNfeRecentCount({ cnpjEmpresa, lookbackDays: nfeLookbackDays }),
  ]);

  return {
    email: {
      recentCount: emailRecentCount,
    },
    nfe: {
      recentCount: nfeRecentCount,
    },
  };
}

// ---------------------------------------------------------------------
// Export default opcional (caso queira importar como objeto)
// ---------------------------------------------------------------------
const dashBoardAlertsApi = {
  getDashboardAlertsSummary,
};

export default dashBoardAlertsApi;
