// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expensesController.js — Controller (Express)                         ║
// ║ Rotas: /api/expenses                                                 ║
// ║ CONSART ERP | ESM                                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  listExpenses,
  listExpensesForExport,
  getExpenseById,
  createExpense,
  updateExpense,
  patchExpenseStatus,
  deleteExpense,
} from '../repositories/expenses/expenses.index.js';

import {
  normalizeIds,
  buildBatchChanges,
  deleteExpensesBatch,
  updateExpensesBatch,
} from '../repositories/expenses/expensesBatch.repository.js';
import { sendExpensesToPayable } from '../repositories/expenses/expensesToPayable.repository.js';
import {
  listAttachments,
  addAttachment,
  signAttachmentDownload,
  deactivateAttachment,
  countAttachmentsByExpense,
} from '../repositories/expenses/expensesAttachments.repository.js';
import ExcelJS from 'exceljs';
import { generateExpensesPdf } from '../generationPdf/generateExpensesPdf.js'; // ✅ ajuste path se preciso

function badRequest(res, msg, extra = {}) {
  return res.status(400).json({ ok: false, message: msg, ...extra });
}

function serverError(res, err, where = '') {
  console.error('[expensesController]', where, err);
  return res.status(500).json({ ok: false, message: 'Internal server error' });
}

function requireFields(body, fields = []) {
  for (const f of fields) {
    if (body?.[f] === undefined || body?.[f] === null || body?.[f] === '') {
      return f;
    }
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────
   GET /api/expenses  (list + total + total_value)
────────────────────────────────────────────────────────────── */
export async function getExpenses(req, res) {
  try {
    const data = await listExpenses(req.query);
    // 📎 quantidade de anexos por despesa (contratos e documentos)
    const counts = await countAttachmentsByExpense((data.rows || []).map((r) => r.id));
    (data.rows || []).forEach((r) => { r.attachments_count = counts[Number(r.id)] || 0; });
    return res.json({
      ok: true,
      total: data.total,
      total_value: data.total_value,
      rows: data.rows,
      limit: data.limit,
      offset: data.offset,
    });
  } catch (err) {
    return serverError(res, err, 'getExpenses');
  }
}

/* ──────────────────────────────────────────────────────────────
   GET /api/expenses/:id
────────────────────────────────────────────────────────────── */
export async function getExpense(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return badRequest(res, 'Invalid id');

    const row = await getExpenseById(id);
    if (!row) return res.status(404).json({ ok: false, message: 'Not found' });

    return res.json({ ok: true, row });
  } catch (err) {
    return serverError(res, err, 'getExpense');
  }
}

/* ──────────────────────────────────────────────────────────────
   POST /api/expenses   (returns expense_id auto)
────────────────────────────────────────────────────────────── */
export async function createExpenseHandler(req, res) {
  try {
    const missing = requireFields(req.body, ['name', 'value', 'due_date']);
    if (missing) return badRequest(res, `Missing field: ${missing}`);

    const created = await createExpense(req.body);

    // ✅ IMPORTANT: return expense_id to frontend
    return res.status(201).json({
      ok: true,
      id: created.id,
      expense_id: created.expense_id,
    });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ ok: false, message: 'Duplicate expense_id (unique)' });
    }
    if (err?.code === '23514') {
      return res.status(400).json({ ok: false, message: 'Validation failed (check constraint)' });
    }
    return serverError(res, err, 'createExpenseHandler');
  }
}

/* ──────────────────────────────────────────────────────────────
   PUT /api/expenses/:id
────────────────────────────────────────────────────────────── */
export async function updateExpenseHandler(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return badRequest(res, 'Invalid id');

    const missing = requireFields(req.body, ['name', 'value', 'due_date']);
    if (missing) return badRequest(res, `Missing field: ${missing}`);

    const updated = await updateExpense(id, req.body);
    if (!updated) return res.status(404).json({ ok: false, message: 'Not found' });

    return res.json({
      ok: true,
      id: updated.id,
      expense_id: updated.expense_id,
    });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ ok: false, message: 'Duplicate expense_id (unique)' });
    }
    if (err?.code === '23514') {
      return res.status(400).json({ ok: false, message: 'Validation failed (check constraint)' });
    }
    return serverError(res, err, 'updateExpenseHandler');
  }
}

/* ──────────────────────────────────────────────────────────────
   PATCH /api/expenses/:id/status
────────────────────────────────────────────────────────────── */
export async function patchExpenseStatusHandler(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return badRequest(res, 'Invalid id');

    const missing = requireFields(req.body, ['status']);
    if (missing) return badRequest(res, `Missing field: ${missing}`);

    const updated = await patchExpenseStatus(id, req.body);
    if (!updated) return res.status(404).json({ ok: false, message: 'Not found' });

    return res.json({ ok: true, id: updated.id });
  } catch (err) {
    if (err?.code === '23514') {
      return res.status(400).json({ ok: false, message: 'Invalid status (check constraint)' });
    }
    return serverError(res, err, 'patchExpenseStatusHandler');
  }
}

/* ──────────────────────────────────────────────────────────────
   DELETE /api/expenses/:id
────────────────────────────────────────────────────────────── */
export async function deleteExpenseHandler(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return badRequest(res, 'Invalid id');

    const deleted = await deleteExpense(id);
    if (!deleted) return res.status(404).json({ ok: false, message: 'Not found' });

    return res.json({ ok: true, id: deleted.id });
  } catch (err) {
    return serverError(res, err, 'deleteExpenseHandler');
  }
}

export async function getExpensesPdf(req, res) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const filters = {
      q: req.query.q,
      name: req.query.name,
      status: req.query.status,
      category: req.query.category,
      vendor: req.query.vendor,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      order_by: req.query.order_by || 'created_at_desc',
      sort: req.query.sort,
      dir: req.query.dir,
      limit: req.query.limit ? Number(req.query.limit) : 2000,
    };

    const out = await generateExpensesPdf({ filters, baseUrl });

    // ✅ força DOWNLOAD do arquivo
    return res.download(out.filePath, out.filename);
  } catch (err) {
    console.error('[expensesController] getExpensesPdf', err);
    return res.status(500).json({ ok: false, message: 'Internal server error' });
  }
}

/* ──────────────────────────────────────────────────────────────
   GET /api/expenses/excel  → .xlsx com os mesmos filtros/ordem da tela
────────────────────────────────────────────────────────────── */
const EXPENSE_RECURRENCE_LABEL = { MONTHLY: 'Mensal', WEEKLY: 'Semanal', YEARLY: 'Anual', NONE: 'Sem recorrência' };

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function competenceLabel(month, year) {
  const mm = month ? String(month).padStart(2, '0') : '';
  if (mm && year) return `${mm}/${year}`;
  return mm || (year ? String(year) : '');
}

export async function getExpensesExcel(req, res) {
  try {
    const { limit, offset, ...filters } = req.query;
    const rows = await listExpensesForExport(filters);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CONSART ERP';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Despesas');
    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Código', key: 'expense_id', width: 16 },
      { header: 'Nome', key: 'name', width: 32 },
      { header: 'Descrição', key: 'description', width: 36 },
      { header: 'Categoria', key: 'category', width: 24 },
      { header: 'Centro de custo', key: 'cost_center', width: 16 },
      { header: 'Fornecedor', key: 'vendor', width: 34 },
      { header: 'Valor', key: 'value', width: 14, style: { numFmt: '"R$" #,##0.00' } },
      { header: 'Vencimento', key: 'due_date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Competência', key: 'competence', width: 12 },
      { header: 'Recorrência', key: 'recurrence', width: 14 },
      { header: 'Criado em', key: 'created_at', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Atualizado em', key: 'updated_at', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    ];

    let totalValue = 0;
    for (const r of rows) {
      const value = Number(r.value || 0);
      totalValue += value;
      sheet.addRow({
        id: r.id,
        expense_id: r.expense_id || '',
        name: r.name || '',
        description: r.description || '',
        category: r.category || '',
        cost_center: r.cost_center || '',
        vendor: r.vendor || '',
        value,
        due_date: toDateOnly(r.due_date),
        competence: competenceLabel(r.competence_month, r.competence_year),
        recurrence: EXPENSE_RECURRENCE_LABEL[r.recurrence_type] || r.recurrence_type || '',
        created_at: r.created_at ? new Date(r.created_at) : null,
        updated_at: r.updated_at ? new Date(r.updated_at) : null,
      });
    }

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const totalRow = sheet.addRow({ name: `Total (${rows.length} registros)`, value: totalValue });
    totalRow.font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const filename = `despesas_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    return serverError(res, err, 'getExpensesExcel');
  }
}

/* ──────────────────────────────────────────────────────────────
   POST /api/expenses/batch-delete  { ids: [] }
   POST /api/expenses/batch-update  { ids: [], changes: {...} }
────────────────────────────────────────────────────────────── */
export async function deleteExpensesBatchHandler(req, res) {
  try {
    const ids = normalizeIds(req.body?.ids);
    if (!ids.length) return badRequest(res, 'Nenhuma despesa selecionada.');
    const deleted = await deleteExpensesBatch(ids);
    return res.json({ ok: true, deleted: deleted.length, ids: deleted });
  } catch (err) {
    return serverError(res, err, 'deleteExpensesBatch');
  }
}

export async function updateExpensesBatchHandler(req, res) {
  const ids = normalizeIds(req.body?.ids);
  if (!ids.length) return badRequest(res, 'Nenhuma despesa selecionada.');
  const changes = req.body?.changes && typeof req.body.changes === 'object' ? req.body.changes : {};

  let built;
  try {
    built = buildBatchChanges(changes);
  } catch (err) {
    return badRequest(res, err.message);
  }
  const hasCash = ['cash_category_id', 'cash_subcategory_id'].some((k) => k in changes);
  if (!built.set.length && !hasCash) return badRequest(res, 'Nenhum campo para alterar.');

  try {
    const updated = await updateExpensesBatch(ids, changes);
    return res.json({ ok: true, updated: updated.length, ids: updated });
  } catch (err) {
    return serverError(res, err, 'updateExpensesBatch');
  }
}

/* POST /api/expenses/to-accounts-payable  { ids: [], parcels: N }
   Envia as despesas marcadas ao Contas a Pagar (1 título por despesa). */
export async function sendExpensesToPayableHandler(req, res) {
  try {
    const ids = normalizeIds(req.body?.ids);
    if (!ids.length) return badRequest(res, 'Nenhuma despesa selecionada.');
    const user = { name: req.user?.name || req.user?.username || null };
    const result = await sendExpensesToPayable(ids, req.body?.parcels ?? 1, user);
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err?.status === 400) return badRequest(res, err.message);
    return serverError(res, err, 'sendExpensesToPayable');
  }
}

/* ──────────────────────────────────────────────────────────────
   Anexos (contratos e documentos) — bucket expenses/expense-{id}/
────────────────────────────────────────────────────────────── */
function attachmentError(res, err, where) {
  if (err?.code === 'VALIDATION') return badRequest(res, err.message);
  if (err?.code === 'NOT_FOUND') return res.status(404).json({ ok: false, message: err.message });
  return serverError(res, err, where);
}

// GET /api/expenses/:id/attachments
export async function listExpenseAttachmentsHandler(req, res) {
  try {
    return res.json({ ok: true, data: await listAttachments(req.params.id) });
  } catch (err) {
    return attachmentError(res, err, 'listExpenseAttachments');
  }
}

// POST /api/expenses/:id/attachments (multipart, campo "arquivo")
export async function addExpenseAttachmentHandler(req, res) {
  try {
    return res.status(201).json({ ok: true, data: await addAttachment(req.params.id, req.file) });
  } catch (err) {
    return attachmentError(res, err, 'addExpenseAttachment');
  }
}

// GET /api/expenses/:id/attachments/:attachmentId/download → URL assinada
export async function downloadExpenseAttachmentHandler(req, res) {
  try {
    return res.redirect(302, await signAttachmentDownload(req.params.id, req.params.attachmentId));
  } catch (err) {
    return attachmentError(res, err, 'downloadExpenseAttachment');
  }
}

// DELETE /api/expenses/:id/attachments/:attachmentId (exclusão lógica)
export async function deleteExpenseAttachmentHandler(req, res) {
  try {
    await deactivateAttachment(req.params.id, req.params.attachmentId);
    return res.json({ ok: true });
  } catch (err) {
    return attachmentError(res, err, 'deleteExpenseAttachment');
  }
}
