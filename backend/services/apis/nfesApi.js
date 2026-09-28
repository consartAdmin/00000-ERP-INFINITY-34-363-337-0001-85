// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesApi.js — Lista NF-e (PlugNotas direto) com fallback pelo banco  ║
// ║ - Tenta GET /nfe/consulta/periodo; se falhar, busca em orders       ║
// ║   e hidrata via /consultarNFe                                       ║
// ║                                                                      ║
// ║ ✅ NOVO: inclui customer_email (public.customers.email)              ║
// ║   - PlugNotas: enrich em lote (1 query)                              ║
// ║   - Fallback DB: JOIN customers por CPF/CNPJ (somente dígitos)       ║
// ║                                                                      ║
// ║ ✅ FIX 2026-02-11: includeStarted                                    ║
// ║   - Mostra pedidos com nfe_number preenchido mesmo sem plugnotas_id  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import tecnoSpeedApi from './tecnoSpeedNfeApi.js';
import pool from '../../config/db.js';

const TB_ORDERS = 'public."orders"';
const TB_ORDER_ITEMS = 'public."order_items"';
const TB_CUSTOMERS = 'public."customers"';

// Flag de debug opcional (liga com NFE_LIST_DEBUG=1 no .env)
const LIST_DEBUG =
  process.env.NFE_LIST_DEBUG === '1' || process.env.NFE_LIST_DEBUG === 'true';

/* =====================================================================
 * Utils
 * ===================================================================== */
function digitsOnly(v) {
  return String(v || '').replace(/\D+/g, '');
}

function isTruthy(v) {
  return v === true || v === '1' || v === 1 || String(v || '').toLowerCase() === 'true';
}

// PlugNotas/TecnoSpeed may place fiscal details at the root, in `resumo`,
// `remote`, `data`, or inside arrays. Keep the useful SEFAZ diagnostics even
// when the provider changes that envelope.
function findDeepValue(input, acceptedKeys, seen = new WeakSet()) {
  if (!input || typeof input !== 'object' || seen.has(input)) return null;
  seen.add(input);

  const keys = new Set(acceptedKeys.map((key) => String(key).toLowerCase()));
  for (const [key, value] of Object.entries(input)) {
    if (keys.has(String(key).toLowerCase()) && value != null && value !== '') {
      if (typeof value === 'string' || typeof value === 'number') return value;
    }
  }

  for (const value of Object.values(input)) {
    if (value && typeof value === 'object') {
      const found = findDeepValue(value, acceptedKeys, seen);
      if (found != null && found !== '') return found;
    }
  }

  return null;
}

/* =====================================================================
 * 🔎 Helper: mapeia status PlugNotas/Tecno → status interno NF-e
 * ===================================================================== */
function mapPlugNotasStatus(statusRaw, cStatRaw) {
  const cStat = cStatRaw != null ? String(cStatRaw) : null;
  const s = (statusRaw || '').toString().toUpperCase();

  if (cStat === '100') return 'AUTORIZADA';
  if (cStat === '101' || cStat === '135') return 'CANCELADA';

  if (s.includes('REJEIT')) return 'REJEITADA';
  if (s.includes('PROCESS') || s.includes('PENDENTE')) return 'EM_PROCESSAMENTO';

  return s || 'DESCONHECIDO';
}

/* =====================================================================
 * 🔎 Mapeia objeto da PlugNotas → formato NF-e da tela
 * ===================================================================== */
function mapPlugNotasToNfe(n) {
  if (!n) return null;

  const dest = n?.destinatario || n?.cliente || n?.tomador || {};
  const totalRaw = n?.valor?.total ?? n?.valor?.vNF ?? n?.total ?? n?.valorNfe ?? 0;

  const chave =
    n?.chaveAcesso ??
    n?.chave_acesso ??
    n?.chave ??
    n?.chaveNfe ??
    n?.chaveNFe ??
    n?.chaveNFE ??
    null;

  const statusRaw =
    n?.status ??
    n?.situacao ??
    n?.situacaoNfe ??
    n?.descricaoSituacao ??
    n?.descricaoStatus ??
    null;

  const cStatRaw =
    n?.cStat ??
    n?.cstat ??
    n?.statusSefaz ??
    n?.codStatus ??
    findDeepValue(n, ['cStat', 'cstat', 'statusSefaz', 'codStatus', 'codigoStatus']);

  const messageRaw =
    n?.mensagem ??
    n?.message ??
    n?.xMotivo ??
    n?.motivo ??
    n?.erro ??
    n?.error ??
    findDeepValue(n, [
      'mensagem', 'message', 'xMotivo', 'motivo', 'erro', 'error',
      'descricaoStatus', 'descricaoSituacao',
    ]);

  const statusNorm = mapPlugNotasStatus(statusRaw, cStatRaw);

  const tpAmbRaw = n?.tpAmb ?? n?.tipoAmbiente ?? null;
  let ambiente = n?.ambiente || n?.environment || null;

  if (!ambiente && tpAmbRaw != null) {
    const v = String(tpAmbRaw);
    ambiente = v === '1' ? 'PRODUCAO' : 'HOMOLOGACAO';
  }

  if (!ambiente && typeof tecnoSpeedApi.getEffectiveConfig === 'function') {
    try {
      const eff = tecnoSpeedApi.getEffectiveConfig();
      if (eff?.ambiente) ambiente = eff.ambiente;
    } catch {
      // ignora
    }
  }

  const numeroRaw =
    n?.nfe_number ??
    n?.nfeNumero ??
    n?.numeroNfe ??
    n?.numero ??
    n?.numNfe ??
    null;

  let numero = null;
  if (numeroRaw != null && numeroRaw !== '') {
    const nn = Number(numeroRaw);
    numero = Number.isFinite(nn) ? nn : numeroRaw;
  }

  const xmlUrl = n?.xml ?? n?.linkXml ?? n?.xmlUrl ?? n?.urlXml ?? null;
  const pdfUrl = n?.pdf ?? n?.linkDanfe ?? n?.linkPdf ?? n?.urlDanfe ?? null;

  // ⚠️ referencia.numeroPedido costuma ser o "número do pedido", não necessariamente order_id
  const pedidoRef = n?.referencia?.numeroPedido || null;

  return {
    order_id: pedidoRef,
    order_number: pedidoRef,
    issue_date: n?.dataEmissao || n?.createdAt || null,

    customer_name: dest?.razaoSocial || dest?.nome || '-',
    customer_tax_id: dest?.cpfCnpj || dest?.documento || '-',

    customer_email:
      dest?.email ||
      dest?.emailDestinatario ||
      n?.email ||
      null,

    nfe_status: statusNorm,
    nfe_cstat: cStatRaw != null ? String(cStatRaw) : null,
    nfe_message: messageRaw != null ? String(messageRaw) : null,
    nfe_key: chave,
    nfe_number: numero,
    nfe_protocol: n?.protocolo ?? n?.protocoloAutorizacao ?? null,

    nfe_xml_url: xmlUrl,
    nfe_danfe_url: pdfUrl,
    nfe_environment: ambiente || 'N/D',
    nfe_plugnotas_id: n?.id || n?._id || n?.documentId || null,

    items_count: Array.isArray(n?.itens) ? n.itens.length : 0,
    total_amount: Number(totalRaw) || 0,
  };
}

/* =====================================================================
 * ✅ Enrich: adiciona customer_email a partir do Postgres (1 query em lote)
 * ===================================================================== */
async function attachCustomerEmails(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const docs = Array.from(
    new Set(rows.map((r) => digitsOnly(r?.customer_tax_id)).filter(Boolean)),
  );
  if (!docs.length) return rows;

  const sql = `
    SELECT
      regexp_replace(COALESCE(tax_id, ''), '\\D+', '', 'g') AS doc,
      email
    FROM ${TB_CUSTOMERS}
    WHERE tax_id IS NOT NULL
      AND length(regexp_replace(COALESCE(tax_id, ''), '\\D+', '', 'g')) > 0
      AND regexp_replace(COALESCE(tax_id, ''), '\\D+', '', 'g') = ANY($1)
  `;

  let rs;
  try {
    rs = await pool.query(sql, [docs]);
  } catch (err) {
    if (LIST_DEBUG) console.error('[NFES] attachCustomerEmails SQL erro:', err?.message || err);
    return rows;
  }

  const map = new Map();
  for (const r of rs.rows || []) {
    if (!r?.doc) continue;
    map.set(String(r.doc), r.email || null);
  }

  for (const row of rows) {
    if (row?.customer_email) continue;
    const doc = digitsOnly(row?.customer_tax_id);
    if (doc && map.has(doc)) row.customer_email = map.get(doc);
  }

  return rows;
}

/* =====================
 * 1) TENTATIVA PLUGNOTAS (com paginação real)
 * ===================== */
async function tryListFromPlugNotas({ q, limit, offset }) {
  const pageSize = Math.max(1, Number(limit) || 20);

  // TecnoSpeed/PlugNotas geralmente é 1-based
  let page = Math.max(1, Math.floor((Number(offset) || 0) / pageSize) + 1);

  // Vamos acumular até preencher "limit" (ou acabar)
  const target = pageSize;
  let collected = [];
  let total = 0;

  // Segurança anti-loop
  let safety = 0;

  while (collected.length < target && safety < 10) {
    safety++;

    const resp = await tecnoSpeedApi.listarNFe({ page, pageSize, q });

    if (!resp?.ok) {
      if (LIST_DEBUG) {
        console.error('[NFES] tryListFromPlugNotas falhou:', resp?.status, resp?.error);
      }
      return {
        ok: false,
        status: resp?.status || 500,
        error: resp?.error,
        meta: resp?.meta,
      };
    }

    // Total vindo da API (se existir)
    total = Number(resp?.total || resp?.data?.total || total || 0);

    // Pega itens em qualquer formato
    let rawItems = [];
    if (Array.isArray(resp.data?.itens)) rawItems = resp.data.itens;
    else if (Array.isArray(resp.data)) rawItems = resp.data;
    else if (Array.isArray(resp.data?.docs)) rawItems = resp.data.docs;
    else if (Array.isArray(resp.data?.items)) rawItems = resp.data.items;

    if (LIST_DEBUG) {
      console.log('[NFES] PlugNotas page', page, 'pageSize', pageSize, 'items', rawItems.length, 'total', total);
    }

    // Se não veio nada, acabou.
    if (!rawItems.length) break;

    collected = collected.concat(rawItems);

    // Se já retornou tudo que tinha, para
    if (total && collected.length >= total) break;

    // Próxima página
    page++;
  }

  const rows = collected.map(mapPlugNotasToNfe).filter(Boolean);

  // Se a API não forneceu total, usa o que coletou
  const finalTotal = total || rows.length;

  // Respeita "limit" da página atual (offset já foi tratado via page)
  const pageRows = rows.slice(0, pageSize);

  return { ok: true, rows: pageRows, total: finalTotal };
}

/* ============================
 * 2) FALLBACK: BANCO + /RESUMO
 * ============================ */
function rowDbToNfe(row) {
  return {
    order_id: row.order_id,
    order_number: row.order_number,
    issue_date: row.nfe_issue_at || row.issue_date,
    customer_name: row.customer_name,
    customer_tax_id: row.customer_tax_id,
    customer_email: row.customer_email || null,

    nfe_status: row.nfe_status || 'DESCONHECIDO',
    nfe_cstat: row.nfe_cstat || null,
    nfe_message: row.nfe_message || null,
    nfe_key: row.nfe_key,
    nfe_number: row.nfe_number,
    nfe_protocol: row.nfe_protocol,
    nfe_xml_url: row.nfe_xml_url,
    nfe_danfe_url: row.nfe_danfe_url,
    nfe_environment: row.nfe_environment || 'N/D',
    nfe_plugnotas_id: row.nfe_plugnotas_id,
    items_count: Number(row.items_count || 0),
    total_amount: Number(row.total_amount || 0),
  };
}

async function listFromDbAndHydrate({
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

const nfesApi = { search, getByOrderId };
export default nfesApi;

