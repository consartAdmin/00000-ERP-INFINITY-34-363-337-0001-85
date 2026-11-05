// ╔════════════════════════════════════════════════════════════════════╗
// ║ deliveryTripsCanhoto.repository.js — Canhoto digital da parada     ║
// ║ Assinatura, documento, foto e GPS enviados pelo app de Entregas;   ║
// ║ itens do documento; motorista do usuário logado                    ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { httpError, toInt, toNum, cleanText } from './deliveryTrips.schema.js';
import { STOPS } from './deliveryTrips.constants.js';
import * as nfeReceipts from '../nfeReceipts/nfeReceipts.index.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** data:image/<png|jpeg>;base64,... (ou base64 puro) → Buffer */
function decodeImage(value, mime, errorCode) {
  const raw = cleanText(value);
  if (!raw) return null;
  const m = raw.match(/^data:image\/([a-z]+);base64,(.+)$/i);
  if (m && !mime.includes(m[1].toLowerCase())) throw httpError(errorCode, 400);
  const buf = Buffer.from(m ? m[2] : raw, 'base64');
  if (!buf.length) throw httpError(errorCode, 400);
  if (buf.length > MAX_IMAGE_BYTES) throw httpError('IMAGE_TOO_LARGE', 413);
  return buf;
}

function coord(v, limit) {
  const n = toNum(v);
  return n !== null && Math.abs(n) <= limit ? n : null;
}

/** Campos do canhoto aceitos em PATCH /stops/:id/status (zerados ao voltar para PENDENTE/CANCELADA) */
export function pickProofFields(data = {}, status) {
  if (!['CONCLUIDA', 'FALHOU'].includes(status)) {
    return {
      receiver_document: null, signature_png: null, photo_jpeg: null,
      delivered_lat: null, delivered_lng: null, gps_accuracy_m: null,
    };
  }
  const out = {
    receiver_document: status === 'CONCLUIDA' ? cleanText(data.receiver_document, 32) : null,
    signature_png: status === 'CONCLUIDA'
      ? decodeImage(data.signature_png, ['png'], 'INVALID_SIGNATURE') : null,
    photo_jpeg: decodeImage(data.photo_jpeg, ['jpeg', 'jpg'], 'INVALID_PHOTO'),
    delivered_lat: coord(data.latitude, 90),
    delivered_lng: coord(data.longitude, 180),
    gps_accuracy_m: toNum(data.gps_accuracy_m),
  };
  if (status === 'CONCLUIDA' && data.require_signature === true && !out.signature_png) {
    throw httpError('SIGNATURE_REQUIRED', 400);
  }
  return out;
}

/** Copia a assinatura para o canhoto da NF-e (nfeReceipts). Falha aqui não desfaz a entrega. */
export async function syncNfeReceipt(invoiceId, data, proof) {
  try {
    const receipt = await nfeReceipts.createPendingReceiptByNfeId(invoiceId);
    if (!receipt?.access_key) return;
    await nfeReceipts.signReceiptByAccessKey(receipt.access_key, {
      receiverName: cleanText(data.received_by, 150),
      receiverDocument: proof.receiver_document || '',
      signatureDataUrl: `data:image/png;base64,${proof.signature_png.toString('base64')}`,
      latitude: proof.delivered_lat,
      longitude: proof.delivered_lng,
      notes: 'App CONSART Entregas',
    }, { userAgent: 'consart-entregas' });
  } catch (err) {
    console.warn('[deliveryTrips] syncNfeReceipt falhou:', invoiceId, err?.message);
  }
}

export async function getStopImage(stopId, kind) {
  const col = kind === 'photo' ? 'photo_jpeg' : 'signature_png';
  const { rows } = await pool.query(`SELECT ${col} AS img FROM ${STOPS} WHERE stop_id = $1`, [toInt(stopId)]);
  if (!rows[0]) throw httpError('STOP_NOT_FOUND', 404);
  if (!rows[0].img) throw httpError('IMAGE_NOT_FOUND', 404);
  return rows[0].img;
}

/** Itens do Pedido / Orçamento da parada (NF-e usa o Pedido/Orçamento de origem) */
export async function getStopItems(stopId) {
  const { rows } = await pool.query(
    `SELECT s.order_id, s.budget_id, i.order_id AS inv_order_id, i.budget_id AS inv_budget_id
       FROM ${STOPS} s LEFT JOIN public."invoicesIssued" i ON i.invoice_id = s.invoice_id
      WHERE s.stop_id = $1`,
    [toInt(stopId)]
  );
  if (!rows[0]) throw httpError('STOP_NOT_FOUND', 404);
  const orderId = rows[0].order_id || rows[0].inv_order_id;
  const budgetId = rows[0].budget_id || rows[0].inv_budget_id;
  if (orderId) {
    return (await pool.query(
      `SELECT product_code, description, unit_code, quantity
         FROM public."ordersItems" WHERE order_id = $1 ORDER BY order_item_id`, [orderId])).rows;
  }
  if (budgetId) {
    return (await pool.query(
      `SELECT product_code, description, unit_code, quantity
         FROM public."budgetsItems" WHERE budget_id = $1 ORDER BY budget_item_id`, [budgetId])).rows;
  }
  return [];
}

/** Motorista vinculado ao usuário logado (users.email = employees.email). null se não houver. */
export async function getDriverForUser(userId) {
  const { rows } = await pool.query(
    `SELECT d.driver_id, d.employee_id, e.full_name AS name
       FROM public.users u
       JOIN public.employees e ON LOWER(TRIM(e.email)) = LOWER(TRIM(u.email))
       JOIN public."drivers" d ON d.employee_id = e.employee_id AND d.is_active
      WHERE u.user_id = $1 AND COALESCE(TRIM(u.email), '') <> ''
      LIMIT 1`,
    [toInt(userId)]
  );
  return rows[0] || null;
}
