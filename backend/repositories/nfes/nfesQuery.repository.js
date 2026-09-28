// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesQuery.repository.js — search / getByOrderId (API pública)        ║
// ║ PlugNotas primeiro; fallback pelo banco (orders) + hidratação        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import tecnoSpeedApi from '../../services/apis/tecnoSpeedNfeApi.js';
import pool from '../../config/db.js';
import { TB_ORDERS } from './nfes.constants.js';
import { isTruthy } from './nfes.utils.js';
import { mapPlugNotasToNfe } from './nfes.mappers.js';
import { attachCustomerEmails } from './nfesCustomerEmails.repository.js';
import { tryListFromPlugNotas } from './nfesPlugNotas.repository.js';
import { listFromDbAndHydrate } from './nfesDb.repository.js';

/* ===========================
 * API pública usada pelo front
 * =========================== */
export async function search({
  q = '',
  status,
  dateFrom,
  dateTo,
  limit = 20,
  offset = 0,
  includeStarted = false, // ✅ NOVO
} = {}) {
  const includeStartedBool = isTruthy(includeStarted);

  // 1) tenta direto na PlugNotas
  const pn = await tryListFromPlugNotas({ q, limit, offset }).catch(() => ({
    ok: false,
    status: 500,
  }));

  if (pn.ok) {
    let rows = pn.rows;

    rows = await attachCustomerEmails(rows);

    // filtros locais
    if (status) {
      const s = String(status).toLowerCase();
      rows = rows.filter((r) => String(r.nfe_status || '').toLowerCase().includes(s));
    }
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;
      rows = rows.filter((r) => {
        const dt = r.issue_date ? new Date(r.issue_date) : null;
        return (!from || (dt && dt >= from)) && (!to || (dt && dt <= to));
      });
    }

    // ✅ IMPORTANTE:
    // Mesmo quando PlugNotas OK, ainda pode faltar pedidos "iniciados" sem plugnotas_id.
    // Então, se includeStarted=1, fazemos merge com DB (apenas o necessário).
    if (includeStartedBool) {
      const db = await listFromDbAndHydrate({
        q,
        status,
        dateFrom,
        dateTo,
        limit,
        offset,
        includeStarted: true,
      }).catch(() => null);

      if (db?.ok && Array.isArray(db.rows)) {
        const seen = new Set(rows.map((r) => String(r.nfe_plugnotas_id || r.nfe_key || r.order_id || r.order_number || '')));
        const extra = db.rows.filter((r) => {
          const k = String(r.nfe_plugnotas_id || r.nfe_key || r.order_id || r.order_number || '');
          return k && !seen.has(k);
        });
        rows = [...extra, ...rows]; // DB primeiro para mostrar “iniciadas” também
        return { ok: true, rows, total: rows.length, source: 'plugnotas+db' };
      }
    }

    return { ok: true, rows, total: pn.total, source: 'plugnotas' };
  }

  // 2) se falhar, cai para fallback banco
  const db = await listFromDbAndHydrate({
    q,
    status,
    dateFrom,
    dateTo,
    limit,
    offset,
    includeStarted: includeStartedBool,
  }).catch((err) => ({ ok: false, error: String(err?.message || err) }));

  if (db.ok) return db;

  // 3) se tudo falhar, devolve o erro original
  return {
    ok: false,
    error: pn.error || 'Falha ao listar NF-e',
    status: pn.status || 502,
    meta: pn.meta,
  };
}

export async function getByOrderId(orderId) {
  try {
    const id = String(orderId || '').trim();
    if (!id) return { ok: false, error: 'ID inválido' };

    const resp = await tecnoSpeedApi.consultarNFe(id);
    if (resp?.ok && resp.data) {
      const nfe = mapPlugNotasToNfe(resp.data);
      if (nfe) await attachCustomerEmails([nfe]);
      return { ok: true, nfe };
    }

    const list = await tecnoSpeedApi.listarNFe({ q: id, page: 1, pageSize: 50 });
    if (list?.ok && Array.isArray(list.data)) {
      const found = list.data.find(
        (n) =>
          String(n?.referencia?.numeroPedido || '').trim() === id ||
          String(n?.id || '').trim() === id,
      );
      if (found) {
        const nfe = mapPlugNotasToNfe(found);
        if (nfe) await attachCustomerEmails([nfe]);
        return { ok: true, nfe };
      }
    }

    // último recurso: procura no banco pelo número do pedido
    const rs = await pool.query(
      `SELECT order_id FROM ${TB_ORDERS} WHERE CAST(number AS TEXT) = $1 LIMIT 1`,
      [id],
    );

    if (rs.rowCount) {
      const oid = rs.rows[0].order_id;
      const rs2 = await pool.query(
        `SELECT nfe_plugnotas_id FROM ${TB_ORDERS} WHERE order_id = $1`,
        [oid],
      );
      const plugId = rs2.rows?.[0]?.nfe_plugnotas_id;

      if (plugId) {
        const sum = await tecnoSpeedApi.consultarNFe(String(plugId));
        if (sum?.ok && sum.data) {
          const nfe = mapPlugNotasToNfe(sum.data);
          if (nfe) await attachCustomerEmails([nfe]);
          return { ok: true, nfe };
        }
      }
    }

    return { ok: false, error: 'NOT_FOUND' };
  } catch (err) {
    console.error('[nfesApi.getByOrderId] EXC:', err);
    return { ok: false, error: String(err?.message || err) };
  }
}
