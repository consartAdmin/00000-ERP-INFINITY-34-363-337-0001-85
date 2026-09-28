// ╔══════════════════════════════════════════════════════════════════════╗
// ║ getKpis.repository.js — CONSART ERP | Notas Fiscais Emitidas         ║
// ║ Totais de NF-e: emitidas, autorizadas, canceladas e valor autorizado ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  pool,
  TB_INVOICES,
  TB_NFE_STATUS_MAP,
} from './_shared.js';

export async function getKpis() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) AS total,

      COUNT(*) FILTER (
        WHERE COALESCE(
          nsm.code,
          UPPER(
            TRANSLATE(
              COALESCE(i.nfe_status, ''),
              'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ',
              'AAAAEEEIIIOOOOUUUC'
            )
          )
        ) = 'AUTORIZADO'
      ) AS authorized,

      COUNT(*) FILTER (
        WHERE COALESCE(
          nsm.code,
          UPPER(
            TRANSLATE(
              COALESCE(i.nfe_status, ''),
              'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ',
              'AAAAEEEIIIOOOOUUUC'
            )
          )
        ) = 'CANCELADO'
      ) AS cancelled,

      COALESCE(
        SUM(i.total_amount) FILTER (
          WHERE COALESCE(
            nsm.code,
            UPPER(
              TRANSLATE(
                COALESCE(i.nfe_status, ''),
                'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ',
                'AAAAEEEIIIOOOOUUUC'
              )
            )
          ) = 'AUTORIZADO'
        ),
        0
      ) AS total_amount

    FROM ${TB_INVOICES} i

    LEFT JOIN ${TB_NFE_STATUS_MAP} nsm
      ON nsm.nfe_status_id = i.nfe_status_id
  `);

  const row = rows[0] || {};

  return {
    ok: true,
    data: {
      total: Number(row.total || 0),
      authorized: Number(row.authorized || 0),
      cancelled: Number(row.cancelled || 0),
      total_amount: Number(row.total_amount || 0),
    },
  };
}

export default getKpis;
