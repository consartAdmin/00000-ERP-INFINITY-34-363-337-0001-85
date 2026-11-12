// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ generateStockPositionPdf.js — PDF Posição de Estoque (Custo x Qtde)         ║
// ║ CONSART ERP — PDFKit — layout padrão (consartPdfTheme.js)                    ║
// ║ Exporta: generateStockPositionPdf({ rows, filterText }) -> Buffer           ║
// ║ Colunas: ID, Código, Descrição, Custo, Estoque, Total (Custo x Estoque)      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, money, number, nowBR,
} from './consartPdfTheme.js';

const REPORT_TITLE = 'Posição de Estoque';

const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR');

export async function generateStockPositionPdf({ rows = [], filterText = '' } = {}) {
  const { doc, done } = createThemedDoc({ title: REPORT_TITLE, subject: 'Posição de Estoque (Custo x Quantidade)' });
  const generatedAt = nowBR();

  const lines = rows.map((r = {}) => {
    const stock = Number(r.stock ?? r.stock_qty ?? 0) || 0;
    const cost = Number(r.cost ?? r.cost_price ?? 0) || 0;
    return { r: r || {}, stock, cost, total: stock * cost };
  });

  const totalStock = lines.reduce((s, l) => s + l.stock, 0);
  const totalCost = lines.reduce((s, l) => s + l.total, 0);
  const withStock = lines.filter((l) => l.stock > 0).length;
  const negative = lines.filter((l) => l.stock < 0).length;

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Custo x quantidade em estoque',
    info: [
      ['Filtro', filterText || 'Nenhum'],
      ['Produtos', number(lines.length, 0)],
    ],
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Produtos', value: number(lines.length, 0), hint: `${number(withStock, 0)} com estoque positivo`, color: SERIES[0] },
    { label: 'Total estoque', value: fmtNum(totalStock), hint: 'Soma das quantidades', color: SERIES[5] },
    { label: 'Total (custo)', value: money(totalCost), hint: 'Custo x estoque', color: SERIES[1] },
    { label: 'Custo médio', value: money(totalStock > 0 ? totalCost / totalStock : 0), hint: 'Total (custo) / estoque', color: SERIES[2] },
    { label: 'Estoque negativo', value: number(negative, 0), hint: 'Produtos com saldo abaixo de zero', color: negative ? C.red : SERIES[7] },
  ]) + 16;

  const table = makeTable(doc, {
    title: 'Produtos',
    continuation: { title: REPORT_TITLE, subtitle: 'Produtos (continuação)' },
    rowH: 17,
    fontSize: 7.5,
    columns: [
      { label: 'ID', w: 58 },
      { label: 'Código', w: 110 },
      { label: 'Descrição' },
      { label: 'Custo', w: 100, align: 'right' },
      { label: 'Estoque', w: 90, align: 'right' },
      { label: 'Total', w: 120, align: 'right', bold: true },
    ],
  });

  y = table.section(y);

  if (!lines.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhum produto encontrado para o filtro selecionado.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  lines.forEach(({ r, stock, cost, total }, i) => {
    y = table.row(y, [
      String(r.id ?? r.product_id ?? ''),
      String(r.code ?? r.product_code ?? ''),
      String(r.description ?? r.descricao ?? ''),
      money(cost),
      { text: fmtNum(stock), color: stock < 0 ? C.red : undefined },
      money(total),
    ], { index: i });
  });

  if (lines.length) {
    table.total(y, ['TOTAL', `${number(lines.length, 0)} produto(s)`, '', '', fmtNum(totalStock), money(totalCost)]);
  }

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();

  return done;
}
