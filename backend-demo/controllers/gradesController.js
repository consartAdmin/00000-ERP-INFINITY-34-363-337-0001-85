// ╔══════════════════════════════════════════════════════════════════════╗
// ║ gradesController.js — Controller REST para /api/grades               ║
// ║ CONSART ERP — ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import * as gradesApi from '../repositories/grades/grades.index.js';

function httpError(res, e, fallbackStatus = 500) {
  const status = Number(e?.statusCode || e?.status || fallbackStatus);
  return res.status(status).json({ ok: false, error: e?.message || 'Erro' });
}

export async function list(req, res) {
  try {
    const q = String(req.query.q || '').trim();

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      100
    );

    const offset = Math.max(
      Number(req.query.offset) || 0,
      0
    );

    let isActive;

    if (
      req.query.is_active !== undefined &&
      req.query.is_active !== ''
    ) {
      const status = String(req.query.is_active).toLowerCase();

      if (!['true', 'false'].includes(status)) {
        return res.status(400).json({
          ok: false,
          error: 'O parâmetro is_active deve ser true ou false.',
        });
      }

      isActive = status === 'true';
    }

    const data = await gradesApi.list({
      q,
      isActive,
      limit,
      offset,
    });

    return res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (e) {
    console.error('ERRO AO LISTAR GRADES:', {
      message: e?.message,
      stack: e?.stack,
      code: e?.code,
      detail: e?.detail,
    });

    return httpError(res, e, 500);
  }
}

export async function getById(req, res) {
  try {
    const row = await gradesApi.getById(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not Found' });
    return res.json({ ok: true, data: row });
  } catch (e) {
    return httpError(res, e, 500);
  }
}

export async function create(req, res) {
  try {
    const row = await gradesApi.create(req.body || {});
    return res.status(201).json({ ok: true, data: row });
  } catch (e) {
    // 400/409 previstos no service
    return httpError(res, e, 400);
  }
}

export async function update(req, res) {
  try {
    const row = await gradesApi.update(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: 'Not Found' });
    return res.json({ ok: true, data: row });
  } catch (e) {
    return httpError(res, e, 400);
  }
}

export async function remove(req, res) {
  try {
    const hard = String(req.query.hard || '').toLowerCase() === 'true';
    const out = await gradesApi.remove(req.params.id, { hard });
    return res.json({ ok: true, ...out });
  } catch (e) {
    return httpError(res, e, 400);
  }
}

/* ──────────────────────────────────────────────────────────────
   exportList() — GET /api/grades/export?format=pdf|xlsx&q=&is_active=
   Mesmos filtros da tela, sem paginação.
────────────────────────────────────────────────────────────── */
const GRADE_COLUMNS = [
  { key: 'grade_id', label: 'ID', w: 50, width: 8, align: 'center' },
  { key: 'grade', label: 'Grade', w: 150, width: 24, bold: true },
  { key: 'description', label: 'Descrição', width: 50, format: (v) => v || 'Sem descrição' },
  {
    key: 'is_active', label: 'Status', w: 80, width: 12, align: 'center',
    format: (v) => (v !== false ? 'Ativa' : 'Inativa'),
    value: (row) => (row.is_active !== false ? 'Ativa' : 'Inativa'),
    color: (row) => (row.is_active !== false ? '#166534' : '#991b1b'),
  },
];

export async function exportList(req, res) {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    if (!['pdf', 'xlsx'].includes(format)) {
      return res.status(400).json({ ok: false, error: 'format deve ser pdf ou xlsx.' });
    }

    const q = String(req.query.q || '').trim();
    const status = String(req.query.is_active ?? '').toLowerCase();
    const isActive = status === 'true' ? true : status === 'false' ? false : undefined;

    const { rows } = await gradesApi.list({ q, isActive, limit: 10000, offset: 0, maxLimit: 10000 });
    const active = rows.filter((r) => r.is_active !== false).length;

    const info = [
      ['Busca', q || 'Todas'],
      ['Status', isActive === true ? 'Ativas' : isActive === false ? 'Inativas' : 'Todos'],
    ];
    const today = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const { buildSimpleListWorkbook } = await import('../generationPdf/generationSimpleListExcel.js');
      const buffer = await buildSimpleListWorkbook({
        title: 'Relatório de Grades',
        subtitle: 'Cores, tamanhos e variações',
        sheetName: 'Grades',
        info,
        columns: GRADE_COLUMNS.map((c) => ({ ...c, value: c.value })),
        rows,
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="grades-${today}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    const { generateSimpleListPdf } = await import('../generationPdf/generationSimpleListPdf.js');
    const pdf = await generateSimpleListPdf({
      title: 'Relatório de Grades',
      subtitle: 'Cores, tamanhos e variações',
      info,
      kpis: [
        { label: 'Grades', value: String(rows.length), hint: 'Registros no relatório' },
        { label: 'Ativas', value: String(active), hint: 'Disponíveis para uso' },
        { label: 'Inativas', value: String(rows.length - active), hint: 'Fora de uso' },
      ],
      columns: GRADE_COLUMNS,
      rows,
      emptyText: 'Nenhuma grade encontrada com os filtros escolhidos.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="grades-${today}.pdf"`);
    return res.send(pdf);
  } catch (e) {
    console.error('ERRO AO EXPORTAR GRADES:', e?.message);
    return httpError(res, e, 500);
  }
}
