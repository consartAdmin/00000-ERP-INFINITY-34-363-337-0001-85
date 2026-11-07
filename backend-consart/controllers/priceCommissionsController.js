// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissionsController.js — Controller | CONSART ERP (ESM)       ║
// ║ Rotas: /api/price-commissions                                        ║
// ║ Path: /backend/controllers/priceCommissionsController.js             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import priceCommissionsApi from '../repositories/priceCommissions/priceCommissions.index.js';

export async function initPriceCommissionsController() {
  try {
    await priceCommissionsApi.ensureTables?.();
  } catch (err) {
    console.error('initPriceCommissionsController() failed:', err);
  }
}

export async function listPriceCommissions(req, res) {
  try {
    const {
      q = '',
      price_id,
      seller_id,
      active,
      date,
      dateFrom,
      dateTo,
      sort,
      dir,
      limit = 200,
      offset = 0,
    } = req.query;

    const out = await priceCommissionsApi.list({
      q,
      price_id,
      seller_id,
      active,
      date,
      dateFrom,
      dateTo,
      sort,
      dir,
      limit: Number(limit) || 200,
      offset: Number(offset) || 0,
    });

    if (!out?.ok) return res.status(400).json(out);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

export async function getPriceCommissionById(req, res) {
  try {
    const out = await priceCommissionsApi.getById(req.params.id);
    if (!out?.ok) {
      const code = out.error === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

export async function createPriceCommission(req, res) {
  try {
    const out = await priceCommissionsApi.create(req.body ?? {});
    if (!out?.ok) return res.status(400).json(out);
    return res.status(201).json(out);
  } catch (err) {
    return res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
}

export async function updatePriceCommission(req, res) {
  try {
    const out = await priceCommissionsApi.update(req.params.id, req.body ?? {});
    if (!out?.ok) {
      const code = out.error === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  } catch (err) {
    return res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
}

export async function deletePriceCommission(req, res) {
  try {
    const out = await priceCommissionsApi.remove(req.params.id);
    if (!out?.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

// combos auxiliares
export async function listPrices(req, res) {
  try {
    const activeOnly = String(req.query.activeOnly ?? 'true') !== 'false';
    const out = await priceCommissionsApi.listPrices({ activeOnly });
    if (!out?.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

export async function listSellers(req, res) {
  try {
    const activeOnly = String(req.query.activeOnly ?? 'true') !== 'false';
    const out = await priceCommissionsApi.listSellers({ activeOnly });
    if (!out?.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

/* ──────────────────────────────────────────────────────────────
   exportPriceCommissions() — GET /api/price-commissions/export
   ?format=pdf|xlsx + os mesmos filtros/ordenação da lista, sem paginação.
────────────────────────────────────────────────────────────── */
const fmtDateBR = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v instanceof Date ? v.toISOString() : String(v || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const fmtType = (t) => (t === 'FIXED' ? 'Fixo (R$)' : 'Percentual (%)');
const fmtValue = (row) => (row.commission_type === 'FIXED'
  ? Number(row.fixed_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  : `${Number(row.percent_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`);
const fmtStatus = (row) => (row.active ? 'Ativo' : 'Inativo');

const COMMISSION_COLUMNS = [
  { key: 'commission_id', label: 'ID', w: 45, width: 8, align: 'center' },
  { key: 'price_name', label: 'Tabela de Preço', w: 130, width: 22, bold: true },
  { key: 'seller_name', label: 'Vendedor', w: 220, width: 32 },
  { key: 'commission_type', label: 'Tipo', w: 90, width: 16, align: 'center', format: (v) => fmtType(v), value: (r) => fmtType(r.commission_type) },
  { key: 'value', label: 'Comissão', w: 80, width: 14, align: 'right', format: (_v, r) => fmtValue(r), value: (r) => fmtValue(r) },
  { key: 'valid_from', label: 'Válido a partir', w: 80, width: 15, align: 'center', format: (v) => fmtDateBR(v), value: (r) => fmtDateBR(r.valid_from) },
  { key: 'valid_to', label: 'Válido até', w: 80, width: 15, align: 'center', format: (v) => fmtDateBR(v) || 'Sem data final', value: (r) => fmtDateBR(r.valid_to) || 'Sem data final' },
  {
    key: 'active', label: 'Status', w: 60, width: 11, align: 'center',
    format: (_v, r) => fmtStatus(r), value: (r) => fmtStatus(r),
    color: (r) => (r.active ? '#166534' : '#991b1b'),
  },
];

export async function exportPriceCommissions(req, res) {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    if (!['pdf', 'xlsx'].includes(format)) {
      return res.status(400).json({ ok: false, error: 'format deve ser pdf ou xlsx.' });
    }

    const { q = '', price_id, seller_id, active, date, sort, dir } = req.query;
    const out = await priceCommissionsApi.list({
      q, price_id, seller_id, active, date, sort, dir, limit: 10000, offset: 0,
    });
    if (!out?.ok) return res.status(400).json(out);
    const rows = out.rows || [];

    const nameOf = (list, key, id) => list.find((r) => String(r[key]) === String(id))?.name;
    const [prices, sellers] = await Promise.all([
      price_id ? priceCommissionsApi.listPrices({ activeOnly: false }) : null,
      seller_id ? priceCommissionsApi.listSellers({ activeOnly: false }) : null,
    ]);

    // O cabeçalho do PDF mostra até 4 linhas: a Busca só entra quando foi digitada.
    const info = [
      ...(String(q).trim() ? [['Busca', String(q).trim()]] : []),
      ['Tabela de Preço', price_id ? (nameOf(prices?.rows || [], 'price_id', price_id) || `#${price_id}`) : 'Todas'],
      ['Vendedor', seller_id ? (nameOf(sellers?.rows || [], 'id', seller_id) || `#${seller_id}`) : 'Todos'],
      ['Status', active === 'true' ? 'Ativos' : active === 'false' ? 'Inativos' : 'Todos'],
      ['Vigente em', date ? fmtDateBR(date) : 'Qualquer data'],
    ];

    const title = 'Relatório de Comissões';
    const subtitle = 'Comissão por tabela de preço e vendedor';
    const today = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const { buildSimpleListWorkbook } = await import('../generationPdf/generationSimpleListExcel.js');
      const buffer = await buildSimpleListWorkbook({
        title, subtitle, sheetName: 'Comissões', info, columns: COMMISSION_COLUMNS, rows,
        emptyText: 'Nenhuma comissão encontrada com os filtros escolhidos.',
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="comissoes-${today}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    const activeCount = rows.filter((r) => r.active).length;
    const sellersCount = new Set(rows.map((r) => r.seller_id)).size;
    const pricesCount = new Set(rows.map((r) => r.price_id)).size;

    const { generateSimpleListPdf } = await import('../generationPdf/generationSimpleListPdf.js');
    const pdf = await generateSimpleListPdf({
      title, subtitle, info, layout: 'landscape',
      kpis: [
        { label: 'Regras', value: String(rows.length), hint: 'Registros no relatório' },
        { label: 'Ativas', value: String(activeCount), hint: `${rows.length - activeCount} inativas` },
        { label: 'Vendedores', value: String(sellersCount), hint: 'Com regra de comissão' },
        { label: 'Tabelas de preço', value: String(pricesCount), hint: 'Com regra de comissão' },
      ],
      columns: COMMISSION_COLUMNS,
      rows,
      emptyText: 'Nenhuma comissão encontrada com os filtros escolhidos.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comissoes-${today}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error('ERRO AO EXPORTAR COMISSÕES:', err?.message);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
