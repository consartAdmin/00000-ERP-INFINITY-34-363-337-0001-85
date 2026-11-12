// ╔════════════════════════════════════════════════════════════════════╗
// ║ accountsReceivableBatchUpdate.repository.js — Editar em lote       ║
// ║ Altera só os campos enviados em vários títulos de uma vez:         ║
// ║  vencimento, conta caixa, tipo doc., categoria/sub, plano contas   ║
// ║ Vencimento com boleto no Asaas: atualiza primeiro o Asaas          ║
// ║ (mesma rotina do Editar), mantendo o valor atual do título.        ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, TB_BRIDGE } from './accountsReceivable.constants.js';
import { isReceivedStatus } from './accountsReceivable.utils.js';
import { updateBoletoValueAndDueDate } from './accountsReceivableBoletoUpdate.repository.js';

const MAX_IDS = 500;

// Campos que podem ser alterados em lote → coluna da tabela
const ID_FIELDS = [
  'bank_account_id',
  'document_type_id',
  'category_id',
  'subcategory_id',
  'chart_account_id',
];

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION';
  return error;
}

function isClosedForDueDate(status) {
  const s = String(status || '').trim().toUpperCase();
  return isReceivedStatus(s) || s === 'CANCELLED' || s === 'CANCELED';
}

// Normaliza e valida { ids, fields } vindos da tela
export function normalizeBatchPayload(body = {}) {
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(positiveInt).filter(Boolean))];
  if (!ids.length) throw validationError('Selecione ao menos um título.');
  if (ids.length > MAX_IDS) throw validationError(`Selecione no máximo ${MAX_IDS} títulos por vez.`);

  const raw = body.fields || {};
  const fields = {};

  if (raw.due_date !== undefined && raw.due_date !== null && raw.due_date !== '') {
    const dueDate = String(raw.due_date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw validationError('Informe um vencimento válido.');
    fields.due_date = dueDate;
  }

  for (const key of ID_FIELDS) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
    const id = positiveInt(raw[key]);
    if (!id) throw validationError(`Valor inválido para ${key}.`);
    fields[key] = id;
  }

  // Subcategoria sem categoria não faz sentido: exige as duas juntas
  if (fields.subcategory_id && !fields.category_id) {
    throw validationError('Escolha a Categoria junto com a Subcategoria.');
  }

  if (!Object.keys(fields).length) {
    throw validationError('Preencha ao menos um campo para alterar.');
  }

  return { ids, fields };
}

/**
 * Aplica os campos em cada título. Cada título é independente:
 * se um falhar (ex.: Asaas recusou o vencimento), os outros seguem.
 * Retorna { updated, skipped, failed, results: [{ id, ok, message }] }.
 */
export async function batchUpdateAccounts(body) {
  const { ids, fields } = normalizeBatchPayload(body);

  const { rows: accounts } = await pool.query(
    `SELECT ar.id, ar.status, ar.value, asa.asaas_payment_id
       FROM ${TB} ar
       LEFT JOIN ${TB_BRIDGE} asa ON asa.accounts_receivable_id = ar.id
      WHERE ar.id = ANY($1::int[])`,
    [ids]
  );
  const byId = new Map(accounts.map((row) => [Number(row.id), row]));

  const localFields = ID_FIELDS.filter((key) => fields[key]);
  const results = [];

  for (const id of ids) {
    const account = byId.get(id);
    if (!account) {
      results.push({ id, ok: false, message: 'Título não encontrado.' });
      continue;
    }

    const notes = [];
    const set = [];
    const params = [];

    try {
      if (fields.due_date) {
        if (isClosedForDueDate(account.status)) {
          notes.push('vencimento mantido (título recebido ou cancelado)');
        } else if (String(account.asaas_payment_id || '').trim()) {
          // Boleto no Asaas: atualiza lá primeiro (grava o vencimento no ERP também)
          await updateBoletoValueAndDueDate(id, {
            due_date: fields.due_date,
            value: Number(account.value),
          });
          notes.push('boleto atualizado no Asaas');
        } else {
          params.push(fields.due_date);
          set.push(`due_date = $${params.length}`);
        }
      }

      for (const key of localFields) {
        params.push(fields[key]);
        set.push(`${key} = $${params.length}`);
      }

      // Categoria trocada sem subcategoria: limpa a sub antiga (pode ser de outra categoria)
      if (fields.category_id && !fields.subcategory_id) {
        set.push('subcategory_id = NULL');
      }

      if (set.length) {
        params.push(id);
        await pool.query(
          `UPDATE ${TB} SET ${set.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
          params
        );
      }

      const changed = set.length > 0 || notes.includes('boleto atualizado no Asaas');
      results.push({ id, ok: true, changed, message: notes.join('; ') });
    } catch (error) {
      console.error('[AR:BATCH-UPDATE] título', id, error?.message || error);
      results.push({ id, ok: false, message: error?.message || 'Falha ao atualizar.' });
    }
  }

  return {
    updated: results.filter((r) => r.ok && r.changed).length,
    skipped: results.filter((r) => r.ok && !r.changed).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
