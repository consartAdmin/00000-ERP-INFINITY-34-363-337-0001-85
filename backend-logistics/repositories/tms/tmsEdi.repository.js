// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsEdi.repository.js — EDI com clientes (layout PROCEDA 3.1)       ║
// ║ Exportação: OCOREN (ocorrências), CONEMB (conhecimentos),          ║
// ║             DOCCOB (cobrança / fatura)                             ║
// ║ Importação: NOTFIS (notas fiscais) → CT-es digitados               ║
// ║ Registros de 120 posições (OCOREN/DOCCOB) e 350 (CONEMB/NOTFIS),   ║
// ║ texto em maiúsculas sem acento. Conferir o layout combinado com    ║
// ║ cada cliente: alguns usam variações do PROCEDA.                    ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { httpError, toInt, cleanText, toDate, onlyDigits } from './tms.helpers.js';
import { withTx } from './tmsCrud.repository.js';
import { loadEmitter } from './tmsKeys.js';

const EDI = 'public."tmsEdiFiles"';

// ───────────────────────── formatação ─────────────────────────
const plain = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
/** alfanumérico: alinhado à esquerda, completa com espaços */
const A = (v, len) => plain(v).slice(0, len).padEnd(len, ' ');
/** numérico: só dígitos, alinhado à direita, completa com zeros */
const Nn = (v, len) => onlyDigits(v).slice(-len).padStart(len, '0');
/** decimal com casas implícitas: 1234.5 (len 15, 2) → 000000000123450 */
const Dn = (v, len, dec = 2) => String(Math.round(Math.abs(Number(v) || 0) * 10 ** dec)).slice(-len).padStart(len, '0');
const ddmmyyyy = (iso) => {
  if (!iso) return '00000000';
  const s = iso instanceof Date ? iso.toISOString() : String(iso);
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}${m}${y}`;
};
const ddmmyy = (iso) => { const s = ddmmyyyy(iso); return s.slice(0, 4) + s.slice(6); };
const hhmm = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
};
const line = (s, len) => s.slice(0, len).padEnd(len, ' ');

function header(id, sender, recipient, len) {
  const now = new Date();
  return line(`000${A(sender, 35)}${A(recipient, 35)}${ddmmyy(now.toISOString())}${hhmm(now)}${A(id, 12)}`, len);
}

function fileName(type, seq) {
  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}`
    + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${type.slice(0, 3)}${stamp}${seq}.TXT`;
}

// ───────────────────────── geradores ─────────────────────────

async function buildOcoren(emitter, { customer_id, date_from, date_to }) {
  const params = [];
  const where = [`c.status IN ('EMITIDO','AUTORIZADO')`];
  if (customer_id) { params.push(customer_id); where.push(`c.payer_customer_id = $${params.length}`); }
  if (date_from) { params.push(date_from); where.push(`ev.event_at::date >= $${params.length}`); }
  if (date_to) { params.push(date_to); where.push(`ev.event_at::date <= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT ev.event_code, ev.event_at, ev.notes, ev.received_by, c.sender_tax_id, c.payer_name,
            d.number AS nf_number, d.series AS nf_series
       FROM public."tmsCteEvents" ev
       JOIN public."tmsCte" c ON c.cte_id = ev.cte_id
       LEFT JOIN public."tmsCteDocuments" d ON d.cte_id = c.cte_id
      WHERE ${where.join(' AND ')}
      ORDER BY ev.event_at, ev.event_id`,
    params
  );
  const lines = [header('OCO', emitter.razao_social, rows[0]?.payer_name || 'CLIENTE', 120)];
  lines.push(line(`340${A(`OCORR${ddmmyy(new Date().toISOString())}`, 14)}`, 120));
  lines.push(line(`341${Nn(emitter.cnpj, 14)}${A(emitter.razao_social, 40)}`, 120));
  for (const r of rows) {
    const text = r.received_by ? `RECEBIDO POR ${r.received_by}` : r.notes;
    lines.push(line(
      `342${Nn(r.sender_tax_id, 14)}${A(r.nf_series || '', 3)}${Nn(r.nf_number || 0, 8)}${Nn(r.event_code || 99, 2)}`
      + `${ddmmyyyy(new Date(r.event_at).toISOString())}${hhmm(r.event_at)}00${A(text, 70)}`,
      120
    ));
  }
  return { lines, records: rows.length };
}

async function buildConemb(emitter, { customer_id, date_from, date_to }) {
  const params = [];
  const where = [`c.status IN ('EMITIDO','AUTORIZADO')`];
  if (customer_id) { params.push(customer_id); where.push(`c.payer_customer_id = $${params.length}`); }
  if (date_from) { params.push(date_from); where.push(`c.issue_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); where.push(`c.issue_date <= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT c.*, c.issue_date::text AS issue_iso,
            (SELECT json_agg(json_build_object('series', d.series, 'number', d.number) ORDER BY d.doc_id)
               FROM public."tmsCteDocuments" d WHERE d.cte_id = c.cte_id) AS docs
       FROM public."tmsCte" c WHERE ${where.join(' AND ')} ORDER BY c.series, c.number`,
    params
  );
  const lines = [header('CON', emitter.razao_social, rows[0]?.payer_name || 'CLIENTE', 350)];
  lines.push(line(`320${A(`CONHE${ddmmyy(new Date().toISOString())}`, 14)}`, 350));
  lines.push(line(`321${Nn(emitter.cnpj, 14)}${A(emitter.razao_social, 40)}`, 350));
  for (const c of rows) {
    const nfs = (c.docs || []).slice(0, 40).map((d) => `${A(d.series || '', 3)}${Nn(d.number || 0, 8)}`).join('');
    lines.push(line(
      `322${A('MATRIZ', 10)}${A(c.series, 5)}${Nn(c.number, 12)}${ddmmyyyy(c.issue_iso)}`
      + `${c.payer_role === 'DESTINATARIO' ? 'F' : 'C'}${Dn(c.weight_kg, 7)}${Dn(c.freight_total, 15)}`
      + `${Dn(c.icms_base, 15)}${Dn(c.icms_rate, 4)}${Dn(c.icms_amount, 15)}`
      + `${Nn(c.sender_tax_id, 14)}${Nn(c.recipient_tax_id, 14)}${Nn(emitter.cnpj, 14)}${A(c.cfop || '', 4)}${nfs}`,
      350
    ));
  }
  return { lines, records: rows.length };
}

async function buildDoccob(emitter, { freight_invoice_id }) {
  const id = toInt(freight_invoice_id);
  if (!id) throw httpError('FREIGHT_INVOICE_REQUIRED', 400);
  const { rows: [inv] } = await pool.query(
    `SELECT *, issue_date::text AS issue_iso, due_date::text AS due_iso FROM public."tmsFreightInvoices" WHERE freight_invoice_id = $1`,
    [id]
  );
  if (!inv) throw httpError('INVOICE_NOT_FOUND', 404);
  if (inv.status === 'ABERTA' || inv.status === 'CANCELADA') throw httpError('INVOICE_NOT_ISSUED', 409);
  const { rows: items } = await pool.query(
    `SELECT c.series, c.number, i.amount FROM public."tmsFreightInvoiceItems" i
       JOIN public."tmsCte" c ON c.cte_id = i.cte_id WHERE i.freight_invoice_id = $1 ORDER BY c.number`,
    [id]
  );
  const lines = [header('COB', emitter.razao_social, inv.customer_name, 170)];
  lines.push(line(`350${A(`COBRA${ddmmyy(new Date().toISOString())}`, 14)}`, 170));
  lines.push(line(`351${Nn(emitter.cnpj, 14)}${A(emitter.razao_social, 40)}`, 170));
  lines.push(line(
    `352${A('MATRIZ', 10)}0${A('1', 3)}${Nn(inv.freight_invoice_id, 10)}${ddmmyyyy(inv.issue_iso)}${ddmmyyyy(inv.due_iso)}`
    + `${Dn(inv.net_amount, 15)}${A(inv.payment_method === 'BOLETO' ? 'BCO' : 'CAR', 3)}${Dn(0, 15)}${Dn(inv.interest, 15)}`
    + `${ddmmyyyy(null)}${Dn(inv.discount, 15)}${A(inv.boleto_number || '', 35)}`,
    170
  ));
  for (const it of items) lines.push(line(`353${A('MATRIZ', 10)}${A(it.series, 5)}${Nn(it.number, 12)}`, 170));
  lines.push(line(`355${Nn(1, 4)}${Dn(inv.net_amount, 15)}`, 170));
  return { lines, records: items.length, customer_id: inv.customer_id, customer_name: inv.customer_name };
}

const BUILDERS = { OCOREN: buildOcoren, CONEMB: buildConemb, DOCCOB: buildDoccob };

export async function exportEdi(body = {}, user = null) {
  const type = String(body.edi_type || '').toUpperCase();
  const build = BUILDERS[type];
  if (!build) throw httpError('INVALID_EDI_TYPE', 400);
  const emitter = await loadEmitter((t, p) => pool.query(t, p));
  const opts = {
    customer_id: toInt(body.customer_id), date_from: toDate(body.date_from), date_to: toDate(body.date_to),
    freight_invoice_id: body.freight_invoice_id,
  };
  const out = await build(emitter, opts);
  const content = `${out.lines.join('\r\n')}\r\n`;
  const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int + 1 AS n FROM ${EDI} WHERE edi_type = $1`, [type]);
  const { rows: [file] } = await pool.query(
    `INSERT INTO ${EDI} (edi_type, direction, customer_id, customer_name, file_name, content, records,
                         period_from, period_to, status, result, created_by)
     VALUES ($1, 'EXPORTACAO', $2, $3, $4, $5, $6, $7, $8, 'GERADO', $9, $10)
     RETURNING file_id, file_name, records`,
    [type, out.customer_id ?? opts.customer_id, out.customer_name ?? cleanText(body.customer_name, 200),
      fileName(type, n), content, out.records, opts.date_from, opts.date_to,
      `${out.records} registro(s) de detalhe`, toInt(user?.user_id)]
  );
  return file;
}

export async function getEdiFile(id) {
  const { rows: [f] } = await pool.query(`SELECT file_name, content FROM ${EDI} WHERE file_id = $1`, [toInt(id)]);
  if (!f) throw httpError('NOT_FOUND', 404);
  return f;
}

// ───────────────────────── NOTFIS → CT-e ─────────────────────────
// 311 remetente · 312 destinatário · 313 nota fiscal (posições 1-based do PROCEDA 3.1)
const cut = (s, from, len) => s.slice(from - 1, from - 1 + len).trim();
const dec = (s, from, len, d = 2) => {
  const raw = cut(s, from, len).replace(/\D/g, '');
  return raw ? Number(raw) / 10 ** d : null;
};
const isoFromDdmmyyyy = (s) => (/^\d{8}$/.test(s) ? `${s.slice(4)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : null);

export function parseNotfis(content) {
  const out = [];
  let sender = null;
  let recipient = null;
  for (const raw of String(content || '').split(/\r?\n/)) {
    const s = raw.replace(/\s+$/, '');
    const rec = s.slice(0, 3);
    if (rec === '311') {
      sender = {
        tax_id: cut(s, 4, 14), address: cut(s, 33, 40), city: cut(s, 73, 35),
        postal_code: cut(s, 108, 9), state: cut(s, 117, 9).slice(0, 2), name: cut(s, 134, 40),
      };
    } else if (rec === '312') {
      recipient = {
        name: cut(s, 4, 40), tax_id: cut(s, 44, 14), address: cut(s, 73, 40), neighborhood: cut(s, 113, 20),
        city: cut(s, 133, 35), postal_code: cut(s, 168, 9), state: cut(s, 186, 9).slice(0, 2),
      };
    } else if (rec === '313' && recipient) {
      out.push({
        sender, recipient,
        payer: cut(s, 29, 1) === 'F' ? 'DESTINATARIO' : 'REMETENTE',
        series: cut(s, 30, 3), number: cut(s, 33, 8).replace(/^0+/, ''),
        issue_date: isoFromDdmmyyyy(cut(s, 41, 8)),
        species: cut(s, 64, 15), volumes: dec(s, 79, 7), amount: dec(s, 86, 15), weight_kg: dec(s, 101, 7),
        cubage_m3: dec(s, 108, 5), access_key: cut(s, 222, 44).replace(/\D/g, '') || null,
      });
    }
  }
  return out;
}

export async function importNotfis(body = {}, user = null) {
  const content = String(body.content || '');
  if (!content.trim()) throw httpError('FILE_REQUIRED', 400);
  const name = cleanText(body.file_name, 120) || 'NOTFIS.TXT';
  const notes = parseNotfis(content);
  if (!notes.length) {
    await pool.query(
      `INSERT INTO ${EDI} (edi_type, direction, file_name, content, records, status, result, created_by)
       VALUES ('NOTFIS', 'IMPORTACAO', $1, $2, 0, 'ERRO', 'Nenhuma nota (registro 313) encontrada', $3)`,
      [name, content, toInt(user?.user_id)]
    );
    throw httpError('NOTFIS_EMPTY', 400);
  }
  // Agrupa por remetente + destinatário: um CT-e por par, com todas as NFs
  const groups = new Map();
  for (const n of notes) {
    const key = `${n.sender?.tax_id}|${n.recipient.tax_id}|${n.payer}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  return withTx(async (client) => {
    const created = [];
    for (const list of groups.values()) {
      const f = list[0];
      const sum = (k) => list.reduce((a, n) => a + (Number(n[k]) || 0), 0);
      const payerIsRecipient = f.payer === 'DESTINATARIO';
      const { rows: [cte] } = await client.query(
        `INSERT INTO public."tmsCte" (payer_role, sender_name, sender_tax_id, sender_city, sender_state,
                recipient_name, recipient_tax_id, recipient_address, recipient_city, recipient_state,
                payer_name, payer_tax_id, origin_city, origin_state, destination_city, destination_state,
                cargo_description, cargo_value, weight_kg, volumes, cubage_m3, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $4, $5, $9, $10, $13, $14, $15, $16, $17, $18, $19)
         RETURNING cte_id`,
        [f.payer, f.sender?.name || 'REMETENTE (NOTFIS)', f.sender?.tax_id || null, f.sender?.city || null,
          f.sender?.state || null, f.recipient.name, f.recipient.tax_id || null, f.recipient.address || null,
          f.recipient.city || null, f.recipient.state || null,
          payerIsRecipient ? f.recipient.name : (f.sender?.name || 'REMETENTE (NOTFIS)'),
          payerIsRecipient ? f.recipient.tax_id : f.sender?.tax_id,
          f.species || null, sum('amount'), sum('weight_kg'), Math.round(sum('volumes')), sum('cubage_m3') || null,
          `Importado do NOTFIS ${name}`, toInt(user?.user_id)]
      );
      for (const n of list) {
        await client.query(
          `INSERT INTO public."tmsCteDocuments" (cte_id, doc_type, access_key, number, series, issue_date, amount, weight_kg, volumes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [cte.cte_id, n.access_key?.length === 44 ? 'NFE' : 'NF', n.access_key, n.number, n.series, n.issue_date,
            n.amount, n.weight_kg, n.volumes != null ? Math.round(n.volumes) : null]
        );
      }
      created.push(Number(cte.cte_id));
    }
    const result = `${notes.length} nota(s) · ${created.length} CT-e(s) digitado(s): ${created.join(', ')}`;
    const { rows: [file] } = await client.query(
      `INSERT INTO ${EDI} (edi_type, direction, file_name, content, records, status, result, created_by)
       VALUES ('NOTFIS', 'IMPORTACAO', $1, $2, $3, 'IMPORTADO', $4, $5) RETURNING file_id`,
      [name, content, notes.length, result, toInt(user?.user_id)]
    );
    return { file_id: file.file_id, notes: notes.length, cte_ids: created, result };
  });
}
