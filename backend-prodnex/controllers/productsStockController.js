// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🏬 productsStockController.js — Controller Express                      ║
// ║ CONSART ERP | ESM                                                       ║
// ║ ✅ CRUD Estoque Min./Máx.                                               ║
// ║ ✅ Busca digitada por produto/SKU                                       ║
// ║ ✅ Filtros grupo/subgrupo/fabricante                                    ║
// ║ ✅ PDF Sugestão de Compra                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE, createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable,
  number as themeNumber, nowBR as themeNowBR,
} from '../generationPdf/consartPdfTheme.js';

import productsStockApi from '../repositories/productsStock/productsStock.manager.js';

export async function filterOptions(req, res) {
  try {
    const data = await productsStockApi.filterOptions();
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

const ok = (res, data, code = 200) => res.status(code).json(data);

const fail = (res, err, code = 400) => {
  console.error('[productsStockController]', err);
  return res.status(code).json({
    ok: false,
    error: err?.message || 'Erro interno',
  });
};

function moneyNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtQty(v) {
  return moneyNum(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function safe(v, fallback = '-') {
  return v === null || v === undefined || v === '' ? fallback : String(v);
}

export async function ensure(req, res) {
  try {
    const r = await productsStockApi.ensureTable();
    return ok(res, r);
  } catch (err) {
    return fail(res, err);
  }
}

export async function list(req, res) {
  try {
    const data = await productsStockApi.list({
      limit: req.query.limit,
      offset: req.query.offset,
      status: req.query.status,
      q: req.query.q,
      group_id: req.query.group_id,
      subgroup_id: req.query.subgroup_id,
      manufacturer_id: req.query.manufacturer_id,
      order: req.query.order,
    });

    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

export async function getByCode(req, res) {
  try {
    const productCode = String(
      req.params?.product_code ??
      req.query?.product_code ??
      ''
    ).trim();

    if (!productCode) {
      return ok(
        res,
        {
          ok: false,
          error: 'product_code é obrigatório',
        },
        400,
      );
    }

    const data =
      await productsStockApi.getByProductCode(productCode);

    if (!data) {
      return ok(
        res,
        {
          ok: false,
          error: `Estoque não encontrado para o SKU ${productCode}`,
        },
        404,
      );
    }

    const returnedCode = String(
      data.product_code ?? ''
    ).trim();

    if (
      returnedCode &&
      returnedCode !== productCode
    ) {
      console.error(
        '[productsStockController][getByCode] SKU inconsistente',
        {
          requestedProductCode: productCode,
          returnedProductCode: returnedCode,
          productStockId: data.product_stock_id,
        },
      );

      return ok(
        res,
        {
          ok: false,
          error:
            `Estoque inconsistente: solicitado SKU ${productCode}, ` +
            `mas encontrado SKU ${returnedCode}.`,
        },
        409,
      );
    }

    return ok(res, {
      ok: true,
      data,
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function get(req, res) {
  try {
    const data = await productsStockApi.getById(req.params.id);

    if (!data) {
      return ok(res, { ok: false, error: 'Registro não encontrado' }, 404);
    }

    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

export async function create(req, res) {
  try {
    const data = await productsStockApi.create(req.body || {});
    return ok(res, data, 201);
  } catch (err) {
    return fail(res, err);
  }
}

export async function update(req, res) {
  try {
    const data = await productsStockApi.update(req.params.id, req.body || {});

    if (!data) {
      return ok(res, { ok: false, error: 'Registro não encontrado' }, 404);
    }

    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

export async function adjust(req, res) {
  try {
    const data = await productsStockApi.adjust(req.params.id, req.body?.delta);

    if (!data) {
      return ok(res, { ok: false, error: 'Registro não encontrado' }, 404);
    }

    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

export async function remove(req, res) {
  try {
    const data = await productsStockApi.remove(req.params.id);

    if (!data) {
      return ok(res, { ok: false, error: 'Registro não encontrado' }, 404);
    }

    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

export async function purchaseSuggestionPdf(req, res) {
  try {
    const rows = await productsStockApi.listPurchaseSuggestion({
      q: req.query.q,
      group_id: req.query.group_id,
      subgroup_id: req.query.subgroup_id,
      manufacturer_id: req.query.manufacturer_id,
    });

    const REPORT_TITLE = 'Sugestão de Compra';
    const { doc } = createThemedDoc({ title: REPORT_TITLE, subject: 'Sugestão de compra (estoque x máximo)', collect: false });

    const filename = `sugestao_de_compra_${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    const lines = rows.map((r) => ({ r, suggestion: Math.max(0, moneyNum(r.stock_max) - moneyNum(r.stock_qty)) }));
    const totalSuggestion = lines.reduce((acc, l) => acc + l.suggestion, 0);
    const zeroStock = lines.filter((l) => moneyNum(l.r.stock_qty) <= 0).length;
    const belowMin = lines.filter((l) => moneyNum(l.r.stock_qty) < moneyNum(l.r.stock_min)).length;

    const filters = [req.query.q ? `Busca: ${req.query.q}` : '', req.query.group_id ? `Grupo #${req.query.group_id}` : '',
      req.query.subgroup_id ? `Subgrupo #${req.query.subgroup_id}` : '', req.query.manufacturer_id ? `Fabricante #${req.query.manufacturer_id}` : '']
      .filter(Boolean).join(' · ');

    let y = drawFullHeader(doc, {
      title: REPORT_TITLE,
      subtitle: 'Estoque atual x mínimo / máximo',
      info: [
        ['Filtro', filters || 'Nenhum'],
        ['Itens', themeNumber(lines.length, 0)],
      ],
    }) + 14;

    y = drawKpis(doc, y, [
      { label: 'Itens sugeridos', value: themeNumber(lines.length, 0), hint: 'Produtos abaixo do máximo', color: SERIES[0] },
      { label: 'Total a comprar', value: fmtQty(totalSuggestion), hint: 'Soma (máximo - atual)', color: SERIES[1] },
      { label: 'Abaixo do mínimo', value: themeNumber(belowMin, 0), hint: 'Estoque atual < mínimo', color: belowMin ? C.amber : SERIES[7] },
      { label: 'Sem estoque', value: themeNumber(zeroStock, 0), hint: 'Estoque atual zerado ou negativo', color: zeroStock ? C.red : SERIES[7] },
    ]) + 16;

    const table = makeTable(doc, {
      title: 'Produtos',
      continuation: { title: REPORT_TITLE, subtitle: 'Produtos (continuação)' },
      rowH: 17,
      fontSize: 7.5,
      columns: [
        { label: 'SKU', w: 80 },
        { label: 'Produto' },
        { label: 'Grupo', w: 160 },
        { label: 'Atual', w: 70, align: 'right' },
        { label: 'Mín.', w: 70, align: 'right' },
        { label: 'Máx.', w: 70, align: 'right' },
        { label: 'Comprar', w: 80, align: 'right', bold: true },
      ],
    });

    y = table.section(y);

    if (!lines.length) {
      doc.font('Helvetica').fontSize(9).fillColor(C.muted)
        .text('Nenhum produto com sugestão de compra.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
    }

    lines.forEach(({ r, suggestion }, index) => {
      y = table.row(y, [
        safe(r.product_code),
        safe(r.product_description),
        safe(r.product_group_name),
        { text: fmtQty(r.stock_qty), color: moneyNum(r.stock_qty) < moneyNum(r.stock_min) ? C.red : undefined },
        fmtQty(r.stock_min),
        fmtQty(r.stock_max),
        fmtQty(suggestion),
      ], { index });
    });

    if (lines.length) {
      table.total(y, ['TOTAL', `${themeNumber(lines.length, 0)} item(ns)`, '', '', '', '', fmtQty(totalSuggestion)]);
    }

    drawFooters(doc, { title: REPORT_TITLE, generatedAt: themeNowBR() });
    doc.end();
  } catch (err) {
    return fail(res, err, 500);
  }
}

export default {
  ensure,
  list,
  getByCode,
  get,
  create,
  update,
  adjust,
  remove,
  purchaseSuggestionPdf,
  filterOptions,
};