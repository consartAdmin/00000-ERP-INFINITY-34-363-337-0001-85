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
const EXPENSE_STATUS_LABEL = { PENDING: 'Pendente', PAID: 'Pago', CANCELLED: 'Cancelado' };
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
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Pago em', key: 'paid_date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Método de pagamento', key: 'payment_method', width: 20 },
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
        status: EXPENSE_STATUS_LABEL[String(r.status || '').toUpperCase()] || r.status || '',
        paid_date: toDateOnly(r.paid_date),
        payment_method: r.payment_method || '',
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
