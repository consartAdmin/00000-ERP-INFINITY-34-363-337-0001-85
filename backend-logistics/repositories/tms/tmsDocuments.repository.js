// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsDocuments.repository.js — ações do CT-e e do MDF-e              ║
// ║ CT-e : emitir (número + chave), cancelar, averbar seguro,          ║
// ║        gerar a partir de cotação                                   ║
// ║ MDF-e: emitir, encerrar, cancelar                                  ║
// ║ O envio à SEFAZ entra depois: "EMITIDO" = numerado, com chave,     ║
// ║ pronto para transmissão. "AUTORIZADO" fica reservado para o        ║
// ║ retorno da SEFAZ.                                                  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { httpError, toInt, cleanText, onlyDigits } from './tms.helpers.js';
import { withTx, get } from './tmsCrud.repository.js';
import { buildAccessKey, loadEmitter } from './tmsKeys.js';
import { calcFreight, calcToComponents } from './tmsFreight.calc.js';

const CTE = 'public."tmsCte"';
const MDFE = 'public."tmsMdfe"';

const run = (client) => (t, p) => client.query(t, p);

async function lockRow(client, table, pk, id, notFound) {
  const { rows: [row] } = await client.query(`SELECT * FROM ${table} WHERE ${pk} = $1 FOR UPDATE`, [toInt(id)]);
  if (!row) throw httpError(notFound, 404);
  return row;
}

function requireReason(reason) {
  const s = cleanText(reason, 255);
  if (!s || s.length < 15) throw httpError('CANCEL_REASON_MIN_15', 400);
  return s;
}

// ═════════════════════════════ CT-e ═════════════════════════════

export async function emitCte(id) {
  const emitter = await loadEmitter((t, p) => pool.query(t, p));
  return withTx(async (client) => {
    const cte = await lockRow(client, CTE, 'cte_id', id, 'CTE_NOT_FOUND');
    if (cte.status !== 'DIGITADO') throw httpError('CTE_NOT_DIGITADO', 409);

    const missing = [];
    if (!cte.sender_name) missing.push('remetente');
    if (!cte.recipient_name) missing.push('destinatário');
    if (!cte.payer_name) missing.push('tomador');
    if (!cte.origin_city || !cte.origin_state) missing.push('origem');
    if (!cte.destination_city || !cte.destination_state) missing.push('destino');
    if (!(Number(cte.freight_total) > 0)) missing.push('valor do frete');
    const { rows: [{ docs }] } = await client.query(
      'SELECT COUNT(*)::int AS docs FROM public."tmsCteDocuments" WHERE cte_id = $1', [cte.cte_id]
    );
    if (!docs && cte.cte_type === 'NORMAL') missing.push('documentos (NF-e)');
    if (missing.length) {
      const err = httpError('CTE_INCOMPLETE', 400);
      err.details = { missing };
      throw err;
    }

    await client.query(`SELECT pg_advisory_xact_lock(hashtext('tmsCte_number_' || $1::text)::bigint)`, [cte.series]);
    const { rows: [{ next }] } = await client.query(
      `SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ${CTE} WHERE series = $1`, [cte.series]
    );
    const issueDate = new Date().toISOString().slice(0, 10);
    const sameState = String(cte.origin_state).toUpperCase() === String(cte.destination_state).toUpperCase();
    const cfop = cte.cfop || (sameState ? '5353' : '6353');
    const key = buildAccessKey({
      uf: emitter.uf, date: issueDate, cnpj: emitter.cnpj, model: 57, series: cte.series, number: next,
    });
    await client.query(
      `UPDATE ${CTE} SET status = 'EMITIDO', number = $2, access_key = $3, issue_date = $4, cfop = $5
        WHERE cte_id = $1`,
      [cte.cte_id, next, key, issueDate, cfop]
    );
    return get('cte', cte.cte_id, run(client));
  });
}

export async function cancelCte(id, { reason } = {}) {
  const why = requireReason(reason);
  return withTx(async (client) => {
    const cte = await lockRow(client, CTE, 'cte_id', id, 'CTE_NOT_FOUND');
    if (!['EMITIDO', 'AUTORIZADO'].includes(cte.status)) throw httpError('CTE_NOT_ISSUED', 409);
    const { rows: [inMdfe] } = await client.query(
      `SELECT m.mdfe_id, m.number FROM public."tmsMdfeDocuments" d JOIN ${MDFE} m ON m.mdfe_id = d.mdfe_id
        WHERE d.cte_id = $1 AND m.status IN ('DIGITADO','EMITIDO','AUTORIZADO') LIMIT 1`, [cte.cte_id]
    );
    if (inMdfe) {
      const err = httpError('CTE_IN_OPEN_MDFE', 409);
      err.details = inMdfe;
      throw err;
    }
    const { rows: [inInvoice] } = await client.query(
      `SELECT fi.freight_invoice_id FROM public."tmsFreightInvoiceItems" i
         JOIN public."tmsFreightInvoices" fi ON fi.freight_invoice_id = i.freight_invoice_id
        WHERE i.cte_id = $1 AND fi.status <> 'CANCELADA' LIMIT 1`, [cte.cte_id]
    );
    if (inInvoice) {
      const err = httpError('CTE_IN_INVOICE', 409);
      err.details = inInvoice;
      throw err;
    }
    await client.query(
      `UPDATE ${CTE} SET status = 'CANCELADO', cancel_reason = $2, canceled_at = now() WHERE cte_id = $1`,
      [cte.cte_id, why]
    );
    return get('cte', cte.cte_id, run(client));
  });
}

/** Averbação do seguro: registra o nº/protocolo devolvido pela averbadora */
export async function insureCte(id, body = {}) {
  return withTx(async (client) => {
    const cte = await lockRow(client, CTE, 'cte_id', id, 'CTE_NOT_FOUND');
    if (!['EMITIDO', 'AUTORIZADO'].includes(cte.status)) throw httpError('CTE_NOT_ISSUED', 409);
    if (String(body.status || '').toUpperCase() === 'NAO_SE_APLICA') {
      await client.query(
        `UPDATE ${CTE} SET insurance_status = 'NAO_SE_APLICA', insurance_number = NULL, insurance_protocol = NULL,
                insured_at = NULL WHERE cte_id = $1`, [cte.cte_id]
      );
      return get('cte', cte.cte_id, run(client));
    }
    const policyId = toInt(body.policy_id) ?? cte.policy_id;
    if (!policyId) throw httpError('POLICY_REQUIRED', 400);
    const { rows: [policy] } = await client.query(
      'SELECT policy_id, valid_until, is_active FROM public."tmsInsurancePolicies" WHERE policy_id = $1', [policyId]
    );
    if (!policy) throw httpError('POLICY_NOT_FOUND', 404);
    if (!policy.is_active) throw httpError('POLICY_INACTIVE', 409);
    const number = cleanText(body.insurance_number, 60);
    if (!number) throw httpError('INSURANCE_NUMBER_REQUIRED', 400);
    await client.query(
      `UPDATE ${CTE} SET policy_id = $2, insurance_status = 'AVERBADO', insurance_number = $3,
              insurance_protocol = $4, insured_at = now() WHERE cte_id = $1`,
      [cte.cte_id, policyId, number, cleanText(body.insurance_protocol, 60)]
    );
    return get('cte', cte.cte_id, run(client));
  });
}

/** Cotação aprovada → CT-e digitado com os componentes do cálculo */
export async function quoteToCte(quoteId, user) {
  return withTx(async (client) => {
    const quote = await lockRow(client, 'public."tmsFreightQuotes"', 'quote_id', quoteId, 'QUOTE_NOT_FOUND');
    if (quote.cte_id) throw httpError('QUOTE_ALREADY_CONVERTED', 409);
    if (!['ABERTA', 'APROVADA'].includes(quote.status)) throw httpError('QUOTE_NOT_OPEN', 409);
    let components = [];
    if (quote.table_id) {
      components = calcToComponents(await calcFreight(run(client), quote));
      const discount = Number(quote.discount || 0);
      if (discount > 0) components.push({ name: 'DESCONTO', amount: -discount });
    } else if (Number(quote.total) > 0) {
      components = [{ name: 'FRETE PESO', amount: Number(quote.total) }];
    }
    const total = components.reduce((a, c) => a + Number(c.amount), 0);
    const { rows: [cte] } = await client.query(
      `INSERT INTO ${CTE} (sender_customer_id, sender_name, sender_city, sender_state, payer_customer_id, payer_name,
              recipient_name, recipient_city, recipient_state, origin_city, origin_state, destination_city,
              destination_state, cargo_description, cargo_value, weight_kg, volumes, cubage_m3, freight_table_id,
              quote_id, freight_total, notes, created_by)
       VALUES ($1, $2, $3, $4, $1, $2, '(a definir)', $5, $6, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING cte_id`,
      [quote.customer_id, quote.customer_name, quote.origin_city, quote.origin_state, quote.destination_city,
        quote.destination_state, quote.cargo_description, quote.cargo_value, quote.weight_kg, quote.volumes,
        quote.cubage_m3, quote.table_id, quote.quote_id, Math.round(total * 100) / 100,
        `Gerado da cotação nº ${quote.quote_id}`, toInt(user?.user_id)]
    );
    for (const c of components) {
      await client.query(
        'INSERT INTO public."tmsCteComponents" (cte_id, name, amount) VALUES ($1, $2, $3)', [cte.cte_id, c.name, c.amount]
      );
    }
    await client.query(
      `UPDATE public."tmsFreightQuotes" SET status = 'CONVERTIDA', cte_id = $2 WHERE quote_id = $1`,
      [quote.quote_id, cte.cte_id]
    );
    return get('cte', cte.cte_id, run(client));
  });
}

// ═════════════════════════════ MDF-e ═════════════════════════════

export async function emitMdfe(id) {
  const emitter = await loadEmitter((t, p) => pool.query(t, p));
  return withTx(async (client) => {
    const mdfe = await lockRow(client, MDFE, 'mdfe_id', id, 'MDFE_NOT_FOUND');
    if (mdfe.status !== 'DIGITADO') throw httpError('MDFE_NOT_DIGITADO', 409);
    const missing = [];
    if (!mdfe.vehicle_id) missing.push('veículo');
    if (!mdfe.driver_id) missing.push('motorista');
    if (!mdfe.origin_state || !mdfe.destination_state) missing.push('UF de carga/descarga');
    if (!mdfe.cte_count) missing.push('CT-es');
    if (missing.length) {
      const err = httpError('MDFE_INCOMPLETE', 400);
      err.details = { missing };
      throw err;
    }
    // CT-e só pode estar em um MDF-e aberto
    const { rows: [dup] } = await client.query(
      `SELECT c.number, m.number AS mdfe_number
         FROM public."tmsMdfeDocuments" d
         JOIN public."tmsMdfeDocuments" o ON o.cte_id = d.cte_id AND o.mdfe_id <> d.mdfe_id
         JOIN ${MDFE} m ON m.mdfe_id = o.mdfe_id AND m.status IN ('EMITIDO','AUTORIZADO')
         JOIN ${CTE} c ON c.cte_id = d.cte_id
        WHERE d.mdfe_id = $1 LIMIT 1`, [mdfe.mdfe_id]
    );
    if (dup) {
      const err = httpError('CTE_IN_OPEN_MDFE', 409);
      err.details = dup;
      throw err;
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('tmsMdfe_number_' || $1::text)::bigint)`, [mdfe.series]);
    const { rows: [{ next }] } = await client.query(
      `SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ${MDFE} WHERE series = $1`, [mdfe.series]
    );
    const issueDate = new Date().toISOString().slice(0, 10);
    const key = buildAccessKey({
      uf: emitter.uf, date: issueDate, cnpj: emitter.cnpj, model: 58, series: mdfe.series, number: next,
    });
    await client.query(
      `UPDATE ${MDFE} SET status = 'EMITIDO', number = $2, access_key = $3, issue_date = $4 WHERE mdfe_id = $1`,
      [mdfe.mdfe_id, next, key, issueDate]
    );
    // CT-es do manifesto ficam "em trânsito" e herdam veículo / motorista / rota
    await client.query(
      `UPDATE ${CTE} c SET vehicle_id = COALESCE(c.vehicle_id, $2), driver_id = COALESCE(c.driver_id, $3),
              trip_id = COALESCE(c.trip_id, $4),
              delivery_status = CASE WHEN c.delivery_status = 'PENDENTE' THEN 'EM_TRANSITO' ELSE c.delivery_status END
        WHERE c.cte_id IN (SELECT cte_id FROM public."tmsMdfeDocuments" WHERE mdfe_id = $1)`,
      [mdfe.mdfe_id, mdfe.vehicle_id, mdfe.driver_id, mdfe.trip_id]
    );
    return get('mdfe', mdfe.mdfe_id, run(client));
  });
}

export async function closeMdfe(id, body = {}) {
  return withTx(async (client) => {
    const mdfe = await lockRow(client, MDFE, 'mdfe_id', id, 'MDFE_NOT_FOUND');
    if (!['EMITIDO', 'AUTORIZADO'].includes(mdfe.status)) throw httpError('MDFE_NOT_ISSUED', 409);
    const city = cleanText(body.closing_city, 120) || mdfe.unloading_city;
    const state = (cleanText(body.closing_state, 2) || mdfe.destination_state || '').toUpperCase();
    if (!city || !state) throw httpError('CLOSING_PLACE_REQUIRED', 400);
    await client.query(
      `UPDATE ${MDFE} SET status = 'ENCERRADO', closing_city = $2, closing_state = $3, closed_at = now()
        WHERE mdfe_id = $1`, [mdfe.mdfe_id, city, state]
    );
    return get('mdfe', mdfe.mdfe_id, run(client));
  });
}

export async function cancelMdfe(id, { reason } = {}) {
  const why = requireReason(reason);
  return withTx(async (client) => {
    const mdfe = await lockRow(client, MDFE, 'mdfe_id', id, 'MDFE_NOT_FOUND');
    if (!['EMITIDO', 'AUTORIZADO'].includes(mdfe.status)) throw httpError('MDFE_NOT_ISSUED', 409);
    await client.query(
      `UPDATE ${MDFE} SET status = 'CANCELADO', cancel_reason = $2, canceled_at = now() WHERE mdfe_id = $1`,
      [mdfe.mdfe_id, why]
    );
    return get('mdfe', mdfe.mdfe_id, run(client));
  });
}

/** Dados para o DACTE / DAMDFE simplificado (impressão, sem valor fiscal) */
export async function printData(kind, id) {
  const doc = await get(kind, id);
  let emitter = null;
  try { emitter = await loadEmitter((t, p) => pool.query(t, p)); } catch { /* impressão segue sem emitente */ }
  return { doc, emitter: emitter && { ...emitter, cnpj: onlyDigits(emitter.cnpj) } };
}
