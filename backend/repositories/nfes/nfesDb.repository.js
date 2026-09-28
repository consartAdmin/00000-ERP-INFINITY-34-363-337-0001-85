// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesDb.repository.js — listFromDbAndHydrate (fallback banco)         ║
// ║ Tabelas: orders / order_items / customers + hidratação PlugNotas     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import tecnoSpeedApi from '../tecnoSpeedNfe/tecnoSpeedNfe.index.js';
import pool from '../../config/db.js';
import { TB_ORDERS, TB_ORDER_ITEMS, TB_CUSTOMERS, LIST_DEBUG } from './nfes.constants.js';
import { mapPlugNotasToNfe, rowDbToNfe } from './nfes.mappers.js';
import { attachCustomerEmails } from './nfesCustomerEmails.repository.js';

export async function listFromDbAndHydrate({
  q = '',
  status,
  dateFrom,
  dateTo,
  limit = 20,
  offset = 0,
  includeStarted = false, // ✅ NOVO
}) {
  const where = [];
  const args = [];
  let ai = 1;

  // ✅ FIX: antes era somente o.nfe_plugnotas_id IS NOT NULL (isso escondia 290/294)
  // Regra:
  // - includeStarted=false: mantém comportamento antigo (somente docs com plugnotas_id)
  // - includeStarted=true : lista qualquer pedido com evidência de NF-e (nfe_number/key/status/plugnotas_id)
  if (includeStarted) {
    where.push(`(
      o.nfe_number IS NOT NULL OR
      o.nfe_key IS NOT NULL OR
      o.nfe_status IS NOT NULL OR
      o.nfe_plugnotas_id IS NOT NULL
    )`);
  } else {
    where.push(`o.nfe_plugnotas_id IS NOT NULL`);
  }

  if (q && String(q).trim()) {
    const v = `%${String(q).trim()}%`;
    where.push(`(
      o.customer_name ILIKE $${ai} OR
      o.customer_tax_id ILIKE $${ai} OR
      CAST(o.order_id AS TEXT) ILIKE $${ai} OR
      CAST(o.number AS TEXT) ILIKE $${ai} OR
      COALESCE(o.nfe_key,'') ILIKE $${ai} OR
      COALESCE(o.nfe_protocol,'') ILIKE $${ai} OR
      COALESCE(o.nfe_plugnotas_id,'') ILIKE $${ai}
    )`);
    args.push(v);
    ai++;
  }

  if (status && String(status).trim()) {
    where.push(`COALESCE(o.nfe_status,'') ILIKE $${ai}`);
    args.push(String(status).trim());
    ai++;
  }

  if (dateFrom) {
    where.push(`COALESCE(o.nfe_issue_date, o.issue_date) >= $${ai}`);
    args.push(dateFrom);
    ai++;
  }

  if (dateTo) {
    where.push(`COALESCE(o.nfe_issue_date, o.issue_date) <= $${ai}`);
    args.push(dateTo);
    ai++;
  }


  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const base = `
    FROM ${TB_ORDERS} o
    LEFT JOIN ${TB_ORDER_ITEMS} oi ON oi.order_id = o.order_id
    LEFT JOIN ${TB_CUSTOMERS} c
      ON regexp_replace(COALESCE(c.tax_id, ''), '\\D+', '', 'g')
       = regexp_replace(COALESCE(o.customer_tax_id, ''), '\\D+', '', 'g')
    ${whereSql}
  `;

  const sqlRows = `
  SELECT
    o.order_id,
    o.number AS order_number,

    COALESCE(
      o.nfe_issue_datetime,
      (o.nfe_issue_date::timestamp),
      (o.issue_date::timestamp)
    ) AS nfe_issue_at,

    o.customer_name,
    o.customer_tax_id,
    c.email AS customer_email,

    o.nfe_status,
    o.nfe_key,
    o.nfe_number,
    o.nfe_protocol,
    o.nfe_xml_url,
    o.nfe_danfe_url,
    o.nfe_environment,
    o.nfe_plugnotas_id,
    COUNT(oi.order_item_id) AS items_count,
    COALESCE(SUM(oi.quantity * oi.unit_price - oi.discount_value), 0) AS total_amount
  ${base}
  GROUP BY o.order_id, c.email
  ORDER BY
  COALESCE(
  o.nfe_issue_datetime,
  (o.nfe_issue_date::timestamp),
  (o.issue_date::timestamp)
  ) DESC,
  o.order_id DESC
  LIMIT $${ai} OFFSET $${ai + 1}
`;

  const sqlCount = `
    SELECT COUNT(*) AS total
    FROM (
      SELECT o.order_id
      ${base}
      GROUP BY o.order_id
    ) x
  `;

  const client = await pool.connect();
  try {
    const [rsRows, rsCount] = await Promise.all([
      client.query(sqlRows, [...args, Number(limit) || 20, Number(offset) || 0]),
      client.query(sqlCount, args),
    ]);

    let rows = rsRows.rows.map(rowDbToNfe);
    const total = Number(rsCount.rows?.[0]?.total || 0);

    // Hidrata status consultando a PlugNotas em paralelo (best effort)
    const jobs = rows
      .filter((r) => r.nfe_plugnotas_id)
      .map(async (r, idx) => {
        try {
          const sum = await tecnoSpeedApi.consultarNFe(r.nfe_plugnotas_id);
          if (sum?.ok && sum.data) {
            if (LIST_DEBUG && idx === 0) {
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('[NFES] Exemplo de resumo vindo da PlugNotas (consultarNFe):');
              console.log(JSON.stringify(sum.data, null, 2));
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            }

            const n = mapPlugNotasToNfe(sum.data);
            if (n) {
              if (n.nfe_status && n.nfe_status !== 'DESCONHECIDO') r.nfe_status = n.nfe_status;
              if (n.nfe_cstat) r.nfe_cstat = n.nfe_cstat;
              if (n.nfe_message) r.nfe_message = n.nfe_message;
              if (n.nfe_key) r.nfe_key = n.nfe_key;
              if (n.nfe_number != null) r.nfe_number = n.nfe_number;
              if (n.nfe_protocol != null) r.nfe_protocol = n.nfe_protocol;
              if (n.nfe_environment && n.nfe_environment !== 'N/D') r.nfe_environment = n.nfe_environment;
              if (n.nfe_xml_url) r.nfe_xml_url = n.nfe_xml_url;
              if (n.nfe_danfe_url) r.nfe_danfe_url = n.nfe_danfe_url;
              if (n.customer_email && !r.customer_email) r.customer_email = n.customer_email;
            }
          }
        } catch (e) {
          if (LIST_DEBUG) {
            console.error('[NFES] Falha ao hidratar resumo para', r.nfe_plugnotas_id, e.message || e);
          }
        }
        return r;
      });

    // mantém hidratação best-effort
    if (jobs.length) rows = await Promise.all(jobs);

    rows = await attachCustomerEmails(rows);

    return { ok: true, rows, total, source: 'db+hydrate' };
  } finally {
    client.release();
  }
}
