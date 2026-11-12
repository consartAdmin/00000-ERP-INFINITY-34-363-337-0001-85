// ╔══════════════════════════════════════════════════════════════════════╗
// ║ unitsController.js — Controllers HTTP para `units` (Express ESM)    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import * as Units from '../repositories/units/units.index.js';

const ok   = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const fail = (res, error, status = 400) => res.status(status).json({ ok: false, error: String(error?.message || error) });

export async function ensure(_req, res) {
  try { const r = await Units.ensureTable(); ok(res, r); }
  catch (e) { fail(res, e, 500); }
}

export async function list(req, res) {
  try {
    const { q, limit, offset, onlyActive } = req.query;
    const data = await Units.list({ q, limit, offset, onlyActive });
    ok(res, data);
  } catch (e) {
    fail(res, e, 500);
  }
}

export async function getById(req, res) {
  try {
    const id = Number(req.params.id);
    const data = await Units.getById(id);
    if (!data) return fail(res, new Error('Not Found'), 404);
    ok(res, data);
  } catch (e) {
    fail(res, e, 500);
  }
}

export async function create(req, res) {
  try {
    const { unit, description, fator, is_active } = req.body || {};
    const data = await Units.create({ unit, description, fator, is_active });
    ok(res, data, 201);
  } catch (e) {
    fail(res, e, 400);
  }
}

export async function upsert(req, res) {
  try {
    const { unit, description, fator, is_active } = req.body || {};
    const data = await Units.upsertByUnit({ unit, description, fator, is_active });
    ok(res, data);
  } catch (e) {
    fail(res, e, 400);
  }
}

export async function update(req, res) {
  try {
    const id = Number(req.params.id);
    const data = await Units.update(id, req.body || {});
    if (!data) return fail(res, new Error('Not Found'), 404);
    ok(res, data);
  } catch (e) {
    fail(res, e, 400);
  }
}

export async function deactivate(req, res) {
  try {
    const id = Number(req.params.id);
    const data = await Units.deactivate(id);
    if (!data) return fail(res, new Error('Not Found'), 404);
    ok(res, data);
  } catch (e) {
    fail(res, e, 400);
  }
}

export async function remove(req, res) {
  try {
    const id = Number(req.params.id);
    const data = await Units.remove(id);
    if (!data) return fail(res, new Error('Not Found'), 404);
    ok(res, data);
  } catch (e) {
    fail(res, e, 400);
  }
}

/* ──────────────────────────────────────────────────────────────
   exportList() — GET /api/units/export?format=pdf|xlsx&q=&onlyActive=
   Mesmos filtros da tela, sem paginação.
────────────────────────────────────────────────────────────── */
const factorBR = (v) => {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 1).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

const UNIT_COLUMNS = [
  { key: 'unit_id', label: 'ID', w: 50, width: 8, align: 'center' },
  { key: 'unit', label: 'Unidade', w: 110, width: 18, bold: true },
  { key: 'description', label: 'Descrição', width: 46, format: (v) => v || '—' },
  {
    key: 'fator', label: 'Fator', w: 80, width: 12, align: 'right', numFmt: '#,##0.00',
    format: factorBR, value: (row) => { const n = Number(row.fator); return Number.isFinite(n) ? n : 1; },
  },
  {
    key: 'is_active', label: 'Status', w: 80, width: 12, align: 'center',
    format: (v) => (v !== false ? 'Ativo' : 'Inativo'),
    value: (row) => (row.is_active !== false ? 'Ativo' : 'Inativo'),
    color: (row) => (row.is_active !== false ? '#166534' : '#991b1b'),
  },
];

export async function exportList(req, res) {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    if (!['pdf', 'xlsx'].includes(format)) return fail(res, new Error('format deve ser pdf ou xlsx.'), 400);

    const q = String(req.query.q || '').trim();
    const onlyActive = ['true', '1'].includes(String(req.query.onlyActive || '').toLowerCase());

    const { rows } = await Units.list({ q, limit: 100000, offset: 0, onlyActive });
    const active = rows.filter((r) => r.is_active !== false).length;

    const info = [
      ['Busca', q || 'Todas'],
      ['Status', onlyActive ? 'Apenas ativas' : 'Ativas e inativas'],
    ];
    const today = new Date().toISOString().slice(0, 10);
    const title = 'Relatório de Unidades';
    const subtitle = 'Unidades de produtos e movimentações de estoque';

    if (format === 'xlsx') {
      const { buildSimpleListWorkbook } = await import('../generationPdf/generationSimpleListExcel.js');
      const buffer = await buildSimpleListWorkbook({ title, subtitle, sheetName: 'Unidades', info, columns: UNIT_COLUMNS, rows });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="unidades-${today}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    const { generateSimpleListPdf } = await import('../generationPdf/generationSimpleListPdf.js');
    const pdf = await generateSimpleListPdf({
      title,
      subtitle,
      info,
      kpis: [
        { label: 'Unidades', value: String(rows.length), hint: 'Registros no relatório' },
        { label: 'Ativas', value: String(active), hint: 'Disponíveis para uso' },
        { label: 'Inativas', value: String(rows.length - active), hint: 'Fora de uso' },
      ],
      columns: UNIT_COLUMNS,
      rows,
      emptyText: 'Nenhuma unidade encontrada com os filtros escolhidos.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="unidades-${today}.pdf"`);
    return res.send(pdf);
  } catch (e) {
    console.error('ERRO AO EXPORTAR UNIDADES:', e?.message);
    return fail(res, e, 500);
  }
}

export default {
  ensure,
  list,
  exportList,
  getById,
  create,
  upsert,
  update,
  deactivate,
  remove,
};
