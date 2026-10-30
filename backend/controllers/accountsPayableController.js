// ╔══════════════════════════════════════════════════════════════════════╗
// ║ accountsPayableController.js — REST Controller                      ║
// ║ CONSART ERP — handlers /api/accounts-payable                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  ensureTable,
  list,
  getById,
  create,
  update,
  remove,
  pay,
  listAttachments,
  getAttachmentById,
  addAttachment,
  removeAttachment,
  signAttachmentUpload,
  signAttachmentDownload,
  createFromSource
} from '../repositories/accountsPayable/accountsPayable.index.js';

import debtPaymentsApi from '../repositories/debtPayments/debtPayments.index.js';
import {
  ensureDebtPayableColumns,
  syncDebtPayables,
  syncAllDebtPayables
} from '../repositories/debtsPayables/debtsPayables.index.js';
import { hasSchedule } from '../repositories/debtsPayables/debtsPayables.schedule.js';
import pool from '../config/db.js';

import { generateAccountsPayablePdf }
  from '../generationPdf/generationAccountsPayablePdf.js';

import { generateAccountsPayableExcel }
  from '../generationExcel/generationAccountsPayableExcel.js';

ensureTable()
  .then(() => {
    console.log('[accountsPayableController] Tabelas accountsPayable/accessories verificadas.');
  })
  .catch((err) => {
    console.error('[accountsPayableController] Erro ao garantir tabelas:', err);
  });

// Parcelas de Compromissos Financeiros sempre presentes em Contas a Pagar.
// Independe do ensureTable (uma falha lá não pode impedir a carga) e é
// aguardada na 1ª listagem de cada instância.
let debtsSyncPromise = null;

function ensureDebtsSynced() {
  debtsSyncPromise ??= syncAllDebtPayables()
    .then((result) => {
      console.log(
        `[accountsPayableController] Compromissos sincronizados: ${result.synced}/${result.total}.`
      );
      return result;
    })
    .catch((err) => {
      debtsSyncPromise = null;
      throw err;
    });
  return debtsSyncPromise;
}

ensureDebtsSynced().catch((err) => {
  console.error('[accountsPayableController] Erro ao sincronizar Compromissos:', err);
});

/** GET /api/accounts-payable/sync-debts — refaz a carga e mostra o resultado */
export async function syncDebtsAccountsPayable(req, res) {
  try {
    debtsSyncPromise = null;
    const result = await ensureDebtsSynced();
    res.json({ ok: result.errors.length === 0, ...result });
  } catch (err) {
    console.error('[accountsPayableController] syncDebtsAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to sync debts' });
  }
}

function toInt(v, def = undefined) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

function getExportFilters(query = {}) {
  const {
    search,
    status,
    supplierId,
    fromDueDate,
    toDueDate,
    month,
    year,
    groups,
    orderBy
  } = query;

  return {
    search: search || undefined,
    status: status || undefined,
    supplierId: supplierId ? toInt(supplierId) : undefined,
    fromDueDate: fromDueDate || undefined,
    toDueDate: toDueDate || undefined,
    month: month ? toInt(month) : undefined,
    year: year ? toInt(year) : undefined,
    groups: groups || undefined,
    orderBy: orderBy || undefined
  };
}

/** GET /api/accounts-payable */
export async function listAccountsPayable(req, res) {
  try {
    try {
      await ensureDebtsSynced();
    } catch (err) {
      console.error('[accountsPayableController] Compromissos não sincronizados:', err);
    }

    const {
      page,
      pageSize,
      search,
      status,
      supplierId,
      fromDueDate,
      toDueDate,
      month,
      year,
      groups,
      orderBy
    } = req.query;

    const result = await list({
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 20),
      search: search || undefined,
      status: status || undefined,
      supplierId: supplierId ? toInt(supplierId) : undefined,
      fromDueDate: fromDueDate || undefined,
      toDueDate: toDueDate || undefined,
      month: month ? toInt(month) : undefined,
      year: year ? toInt(year) : undefined,
      groups: groups || undefined,
      orderBy: orderBy || undefined
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[accountsPayableController] listAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to list accounts payable' });
  }
}

/** GET /api/accounts-payable/export/pdf */
export async function exportAccountsPayablePdf(req, res) {
  try {
    const result = await generateAccountsPayablePdf(getExportFilters(req.query));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
    );
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).send(result.buffer);
  } catch (err) {
    console.error('[accountsPayableController] exportAccountsPayablePdf erro:', err);
    return res.status(500).json({ ok: false, error: 'Failed to export accounts payable PDF' });
  }
}

/** GET /api/accounts-payable/export/excel */
export async function exportAccountsPayableExcel(req, res) {
  try {
    const result = await generateAccountsPayableExcel(getExportFilters(req.query));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
    );
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).send(result.buffer);
  } catch (err) {
    console.error('[accountsPayableController] exportAccountsPayableExcel erro:', err);
    return res.status(500).json({ ok: false, error: 'Failed to export accounts payable Excel' });
  }
}

/** GET /api/accounts-payable/:id */
export async function getAccountsPayable(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });

    const row = await getById(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Accounts payable not found' });

    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[accountsPayableController] getAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch accounts payable' });
  }
}

/** POST /api/accounts-payable */
export async function createAccountsPayable(req, res) {
  try {
    const payload = req.body || {};

    if (payload.total_value == null && payload.amount != null) payload.total_value = payload.amount;
    if (payload.supplier_id === '') payload.supplier_id = null;
    if (!payload.issue_date) payload.issue_date = new Date().toISOString().slice(0, 10);

    if (!payload.due_date) return res.status(400).json({ ok: false, error: 'due_date is required' });
    if (payload.total_value == null) return res.status(400).json({ ok: false, error: 'total_value is required' });
    if (!payload.status) payload.status = 'PENDING';

    const createdRow = await create(payload);
    res.status(201).json({ ok: true, data: createdRow });
  } catch (err) {
    console.error('[accountsPayableController] createAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to create accounts payable' });
  }
}

const DEBT_LOCKED_MESSAGE =
  'Título gerado por Compromissos Financeiros: altere valor, vencimento ou exclua pelo Compromisso.';

// Campos que Contas a Pagar ainda pode mudar num título de Compromisso
const DEBT_EDITABLE_FIELDS = [
  'category_id',
  'subcategory_id',
  'chart_account_id',
  'payment_method_id',
  'notes',
  'attachment_url'
];

async function getLinkedDebtRow(id) {
  await ensureDebtPayableColumns();
  const row = await getById(id);
  return row?.debt_id ? row : null;
}

/** PUT /api/accounts-payable/:id */
export async function updateAccountsPayable(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });

    let payload = req.body || {};
    const linked = await getLinkedDebtRow(id);
    if (linked) {
      payload = { ...linked };
      const editable = linked.supplier_id ? DEBT_EDITABLE_FIELDS : [...DEBT_EDITABLE_FIELDS, 'supplier_id'];
      for (const field of editable) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) payload[field] = req.body[field];
      }
    }

    const updated = await update(id, payload);
    if (!updated) return res.status(404).json({ ok: false, error: 'Accounts payable not found' });

    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[accountsPayableController] updateAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to update accounts payable' });
  }
}

/** DELETE /api/accounts-payable/:id */
export async function deleteAccountsPayable(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });

    if (await getLinkedDebtRow(id)) {
      return res.status(409).json({ ok: false, error: DEBT_LOCKED_MESSAGE, message: DEBT_LOCKED_MESSAGE });
    }

    const ok = await remove(id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Accounts payable not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('[accountsPayableController] deleteAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete accounts payable' });
  }
}

/**
 * POST /api/accounts-payable/delete-batch  { ids: [] }
 * Exclui os títulos selecionados; os de Compromisso Financeiro ficam de fora.
 */
export async function deleteAccountsPayableBatch(req, res) {
  try {
    const ids = [...new Set((req.body?.ids || []).map((v) => toInt(v)).filter((n) => n > 0))];
    if (!ids.length) return res.status(400).json({ ok: false, error: 'Nenhum título selecionado.' });
    if (ids.length > 1000) return res.status(400).json({ ok: false, error: 'Selecione no máximo 1000 títulos.' });

    await ensureDebtPayableColumns();
    let deleted = 0;
    const skipped = [];

    for (const id of ids) {
      const row = await getById(id);
      if (!row) { skipped.push({ id, reason: 'NOT_FOUND' }); continue; }
      if (row.debt_id) { skipped.push({ id, reason: 'DEBT' }); continue; }
      if (await remove(id)) deleted += 1;
    }

    res.json({ ok: true, deleted, skipped });
  } catch (err) {
    console.error('[accountsPayableController] deleteAccountsPayableBatch erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete accounts payable' });
  }
}

/** POST /api/accounts-payable/:id/pay */
export async function payAccountsPayable(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });

    // Título de Compromisso paga pela parcela (/pay-debt), senão o caixa duplica
    if (await getLinkedDebtRow(id)) {
      const message = 'Título de Compromisso Financeiro: use o pagamento da parcela.';
      return res.status(409).json({ ok: false, error: message, message });
    }

    const body = req.body || {};
    const updated = await pay(id, {
      payment_date: body.payment_date,
      paid_increment: body.paid_increment,
      multa: body.multa,
      juros: body.juros,
      encargos: body.encargos,
      observacao: body.observacao
    });

    if (!updated) return res.status(404).json({ ok: false, error: 'Accounts payable not found' });
    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[accountsPayableController] payAccountsPayable erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to pay accounts payable' });
  }
}

function toMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * POST /api/accounts-payable/:id/pay-debt
 * Pagamento de um título de Compromisso: grava o pagamento na parcela
 * (debt_payments + SAÍDA no caixa) e ressincroniza o título.
 */
export async function payDebtAccountsPayable(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });

    const linked = await getLinkedDebtRow(id);
    if (!linked) {
      return res.status(400).json({ ok: false, error: 'Título não vinculado a um Compromisso Financeiro.' });
    }

    const { rows } = await pool.query('SELECT * FROM public.debts WHERE id = $1', [linked.debt_id]);
    const debt = rows[0];
    if (!debt) return res.status(404).json({ ok: false, error: 'Compromisso não encontrado.' });

    const body = req.body || {};
    const result = await debtPaymentsApi.createPayment({
      debt_id: debt.id,
      installment_number: hasSchedule(debt) ? linked.debt_installment_number : null,
      installment_due_date: linked.due_date,
      payment_date: body.payment_date,
      amount: toMoney(body.paid_increment),
      fine_amount: toMoney(body.multa),
      interest_amount: toMoney(body.juros) + toMoney(body.encargos),
      payment_method: body.document_type || null,
      receipt_number: body.document_number || null,
      notes: body.observacao || null,
      cash: {
        bank_account_id: body.bank_account_id ?? '',
        category_id: body.category_id ?? '',
        subcategory_id: body.subcategory_id ?? '',
        chart_account_id: body.chart_account_id ?? '',
        document_type: body.document_type ?? ''
      }
    });

    await syncDebtPayables(debt.id);
    const updated = await getById(id);

    res.json({
      ok: true,
      data: updated,
      debt_payment: result.payment,
      cash_movement_id: result.cash_movement_id
    });
  } catch (err) {
    console.error('[accountsPayableController] payDebtAccountsPayable erro:', err);
    const message = err?.message || 'Failed to pay debt installment';
    res.status(400).json({ ok: false, error: message, message });
  }
}

/** GET /api/accounts-payable/:id/attachments */
/**
 * GET /api/accounts-payable/:id/anexos
 * GET /api/accounts-payable/:id/attachments
 */
export async function getAccountsPayableAttachments(req, res) {
  try {
    const id = toInt(req.params.id);

    if (!id) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid id'
      });
    }

    const account = await getById(id);

    if (!account) {
      return res.status(404).json({
        ok: false,
        error: 'Accounts payable not found'
      });
    }

    const attachments = await listAttachments(id);

    // The current frontend expects a raw array.
    return res.json(attachments);
  } catch (err) {
    console.error(
      '[accountsPayableController] getAccountsPayableAttachments erro:',
      err
    );

    return res.status(500).json({
      ok: false,
      error: 'Failed to list attachments'
    });
  }
}

/** POST /api/upload/accounts-payable/anexo/sign */
export async function signAccountsPayableAttachmentUpload(req, res) {
  try {
    const body = req.body || {};
    const accountPayableId = toInt(body.accountPayableId ?? body.account_payable_id);

    if (!accountPayableId) {
      return res.status(400).json({ ok: false, error: 'accountPayableId invalido' });
    }

    const result = await signAttachmentUpload({
      account_payable_id: accountPayableId,
      file_name: body.filename ?? body.file_name,
      mime_type: body.mimeType ?? body.mime_type,
      file_type: body.fileType ?? body.file_type,
      file_size: body.fileSize ?? body.file_size
    });

    return res.json({
      ok: true,
      method: result.method,
      signedUrl: result.signedUrl,
      url: result.signedUrl,
      headers: result.headers,
      expiresInSec: result.expiresInSec,
      bucket: result.meta.gcs_bucket,
      object: result.meta.gcs_path,
      fileType: result.meta.file_type,
      meta: result.meta
    });
  } catch (err) {
    console.error('[accountsPayableController] sign upload erro:', err);
    const status = err?.code === 'NOT_FOUND' ? 404 : err?.code === 'VALIDATION' ? 400 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'Failed to sign upload' });
  }
}

/** POST /api/upload/accounts-payable/anexo/confirm */
export async function confirmAccountsPayableAttachmentUpload(req, res) {
  try {
    const body = req.body || {};
    const accountPayableId = toInt(body.accountPayableId ?? body.account_payable_id);
    const meta = body.meta || {};

    if (!accountPayableId) {
      return res.status(400).json({ ok: false, error: 'accountPayableId invalido' });
    }

    const attachment = await addAttachment(accountPayableId, {
      file_type: body.fileType ?? body.file_type ?? meta.file_type,
      file_name: body.filename ?? body.file_name ?? meta.file_name,
      mime_type: body.mimeType ?? body.mime_type ?? meta.mime_type,
      file_size: body.fileSize ?? body.file_size ?? meta.file_size,
      gcs_bucket: body.bucket ?? body.gcs_bucket ?? meta.gcs_bucket,
      gcs_path: body.object ?? body.gcs_path ?? meta.gcs_path
    });

    return res.status(201).json({
      ok: true,
      saved: true,
      anexo: attachment,
      attachment,
      bucket: attachment?.gcs_bucket || null,
      object: attachment?.gcs_path || null
    });
  } catch (err) {
    console.error('[accountsPayableController] confirm upload erro:', err);
    const status = err?.code === 'NOT_FOUND' ? 404 : err?.code === 'VALIDATION' ? 400 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'Failed to confirm upload' });
  }
}

/** GET /api/accounts-payable/:id/anexos/:attachmentId/download */
export async function downloadAccountsPayableAttachment(req, res) {
  try {
    const accountId = toInt(req.params.id);
    const attachmentId = toInt(req.params.attachmentId ?? req.query.attachmentId);

    if (!accountId || !attachmentId) {
      return res.status(400).json({ ok: false, error: 'Invalid account or attachment id' });
    }

    const attachment = await getAttachmentById(attachmentId);
    if (!attachment || Number(attachment.account_payable_id) !== accountId) {
      return res.status(404).json({ ok: false, error: 'Attachment not found' });
    }

    const result = await signAttachmentDownload(attachmentId);
    return res.json({ ok: true, url: result.signedUrl, ...result });
  } catch (err) {
    console.error('[accountsPayableController] download attachment erro:', err);
    const status = err?.code === 'NOT_FOUND' ? 404 : err?.code === 'VALIDATION' ? 400 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'Failed to sign download' });
  }
}

/** GET /api/upload/accounts-payable/anexo/sign-read?attachmentId=123 */
export async function signReadAccountsPayableAttachment(req, res) {
  try {
    const attachmentId = toInt(req.query.attachmentId ?? req.query.id);
    if (!attachmentId) {
      return res.status(400).json({ ok: false, error: 'attachmentId is required' });
    }

    const attachment = await getAttachmentById(attachmentId);
    if (!attachment) return res.status(404).json({ ok: false, error: 'Attachment not found' });

    const result = await signAttachmentDownload(attachmentId);
    return res.json({ ok: true, url: result.signedUrl, ...result });
  } catch (err) {
    console.error('[accountsPayableController] sign read erro:', err);
    const status = err?.code === 'NOT_FOUND' ? 404 : err?.code === 'VALIDATION' ? 400 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'Failed to sign download' });
  }
}

/** GET /api/accounts-payable/:id/anexos/count */
export async function countAccountsPayableAttachments(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const attachments = await listAttachments(id);
    return res.json({ ok: true, count: attachments.length });
  } catch (err) {
    console.error('[accountsPayableController] count attachments erro:', err);
    return res.status(500).json({ ok: false, error: 'Failed to count attachments' });
  }
}

/** DELETE /api/accounts-payable/:id/anexos/:attachmentId */
export async function deleteAccountsPayableAttachment(req, res) {
  try {
    const accountId = toInt(req.params.id);
    const attachmentId = toInt(req.params.attachmentId ?? req.params.anexoId);
    if (!accountId || !attachmentId) {
      return res.status(400).json({ ok: false, error: 'Invalid account or attachment id' });
    }

    const attachment = await getAttachmentById(attachmentId);
    if (!attachment || Number(attachment.account_payable_id) !== accountId) {
      return res.status(404).json({ ok: false, error: 'Attachment not found' });
    }

    const removed = await removeAttachment(attachmentId);
    return res.json({ ok: removed });
  } catch (err) {
    console.error('[accountsPayableController] delete attachment erro:', err);
    return res.status(500).json({ ok: false, error: 'Failed to delete attachment' });
  }
}

/** GET /api/upload/accounts-payable/diag */
export async function diagAccountsPayableUpload(req, res) {
  return res.json({
    ok: true,
    bucket: process.env.ACCOUNTS_PAYABLE_GCS_BUCKET || null,
    prefix: process.env.ACCOUNTS_PAYABLE_GCS_PREFIX || 'accountsPayable',
    signedUrlTtl: Number(process.env.ACCOUNTS_PAYABLE_GCS_SIGNED_URL_TTL || 900)
  });
}

/** POST /api/accounts-payable/from-nfe-entry */
export async function createAccountsPayableFromNfeEntry(req, res) {
  try {
    const body = req.body || {};

    if (!body.supplier_id) return res.status(400).json({ ok: false, error: 'supplier_id is required' });
    if (!body.issue_date) return res.status(400).json({ ok: false, error: 'issue_date is required' });
    if (!body.due_date) return res.status(400).json({ ok: false, error: 'due_date is required' });
    if (body.total_value == null) return res.status(400).json({ ok: false, error: 'total_value is required' });
    if (body.source_id == null) return res.status(400).json({ ok: false, error: 'source_id is required' });

    const source_type = body.source_type || 'NFE_ENTRY';

    const attachments = Array.isArray(body.attachments)
      ? body.attachments
        .filter(Boolean)
        .map((a) => ({
          file_type: a.file_type || 'OUTRO',
          file_name: a.file_name || a.filename || 'arquivo',
          file_url: a.file_url || null,
          mime_type: a.mime_type || 'application/octet-stream',
          file_size: Number(a.file_size || 0),
          gcs_bucket: a.gcs_bucket || null,
          gcs_path: a.gcs_path || null,
          is_active: a.is_active !== false
        }))
        .filter((a) => a.file_url || (a.gcs_bucket && a.gcs_path))
      : [];

    const hasXml = attachments.some((a) => String(a.file_type).toUpperCase() === 'XML');
    const hasDanfe = attachments.some((a) => String(a.file_type).toUpperCase() === 'DANFE');

    if (body.xml_url && !hasXml) {
      attachments.push({
        file_type: 'XML',
        file_name: body.xml_name || `NF-e ${body.invoice_number || body.source_id}.xml`,
        file_url: body.xml_url
      });
    }

    if (body.danfe_url && !hasDanfe) {
      attachments.push({
        file_type: 'DANFE',
        file_name: body.danfe_name || `DANFE ${body.invoice_number || body.source_id}.pdf`,
        file_url: body.danfe_url
      });
    }

    const result = await createFromSource({
      supplier_id: body.supplier_id,
      invoice_number: body.invoice_number || null,
      issue_date: body.issue_date,
      due_date: body.due_date,
      payment_method_id: body.payment_method_id || null,
      description: body.description || `NF-e ${body.invoice_number || ''}`.trim(),
      category_id: body.category_id || null,
      subcategory_id: body.subcategory_id || null,
      document_number: body.document_number || null,
      total_value: body.total_value,
      amount_paid: body.amount_paid || 0,
      status: body.status || 'PENDING',
      notes: body.notes || null,
      source_type,
      source_id: body.source_id,
      attachment_url: body.attachment_url || null,
      attachments
    });

    res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      data: result.payable,
      attachments: result.attachments
    });
  } catch (err) {
    console.error('[accountsPayableController] createAccountsPayableFromNfeEntry erro:', err);
    res.status(500).json({ ok: false, error: 'Failed to create accounts payable from NF-e entry' });
  }
}
