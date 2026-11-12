// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ generationOrdersKanbanPdf.js — Gerador PDF (Pendências Kanban Pedidos)     ║
// ║ CONSART ERP — PDFKit | ESM                                                 ║
// ║                                                                            ║
// ║ Exporta: generateOrdersKanbanPendingsPdf({ rows, filtroDesc, ... })         ║
// ║ Retorna: { buffer, filename }                                              ║
// ╚════════════════════════════════════════════════════════════════════════════╝

import PDFDocument from 'pdfkit';
import {
  C, SERIES, PAGE,
  drawFullHeader, drawCompactHeader, drawFooters, drawKpis, contentBottom,
} from './consartPdfTheme.js';
import moment from 'moment-timezone';
import fs from 'node:fs';

/**
 * Espera rows com (ou equivalentes):
 * - card_id
 * - order_separation_number
 * - customer_name
 * - product_code
 * - unit (productsBarCode)
 * - product_description
 * - quantity
 * - status
 * - obs (observações)
 */
export async function generateOrdersKanbanPendingsPdf({
  rows,
  filtroDesc = 'Todas',
  tz = 'America/Sao_Paulo',

  company = {
    name: 'BH3 DISTRIBUIDORA DE PRODUTOS DE LIMPEZA LTDA',
    cnpj: '34.363.337/0001-85',
    address: 'AV. BIAS FORTES 784, LOURDES – CEP 30.170-012',
    phones: '(31) 3566-0070 / (31) 3566-8888',
    email: 'vendas@bh3distribuidora.com.br',
    site: 'www.bh3distribuidora.com.br',
  },

  watermarkPath,

  page = { size: 'A4', layout: 'landscape', margin: 40 },
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('Nenhuma pendência encontrada para gerar o PDF.');
    err.code = 'NO_ROWS';
    throw err;
  }

  const now = moment().tz(tz);
  const filename = `pendencias_rota_${now.format('YYYY-MM-DD_HHmm')}.pdf`;

  const doc = new PDFDocument({
    margins: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerH + 12 },
    size: page?.size ?? 'A4',
    layout: page?.layout ?? 'landscape',
    compress: true,
    bufferPages: true,
  });
  const REPORT_TITLE = 'Relatório de Pendências';

  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  doc.info = {
    Title: 'Relatório de Pendências',
    Author: company?.name || 'CONSART ERP',
    Subject: 'Pendências de Rota',
    Keywords: 'BH3, pendências, rota, logística, kanban',
    CreationDate: new Date(),
  };

  const margin = PAGE.margin;
  const startX = margin;
  const endX = doc.page.width - margin;
  const topY = margin;
  const bottomY = contentBottom(doc) + 20;

  const headers = ['Card', 'Pedido', 'Cliente', 'Produto', 'Descrição', 'Qtd', 'Status', 'Observações'];
  const alignMap = ['center', 'center', 'left', 'left', 'left', 'right', 'center', 'left'];
  const baseColWidths = [50, 55, 180, 65, 230, 45, 70, 200];
  const totalDisponivel = endX - startX;

  function fitColumns(widths, alvo) {
    const soma = widths.reduce((a, b) => a + b, 0);
    const scale = alvo / soma;
    const ajust = widths.map((w) => Math.floor(w * scale));
    const diff = alvo - ajust.reduce((a, b) => a + b, 0);
    ajust[ajust.length - 1] += diff;
    return ajust;
  }

  let colWidths = fitColumns(baseColWidths, totalDisponivel);
  let cursorY = topY;
  let zebraOn = false;

  function addWatermark() {
    if (!watermarkPath) return;
    try {
      if (!fs.existsSync(watermarkPath)) return;

      const largura = 280;
      const x = (doc.page.width - largura) / 2;
      const y = (doc.page.height - largura) / 2;

      doc.save();
      doc.opacity(0.07);
      doc.image(watermarkPath, x, y, { width: largura });
      doc.opacity(1);
      doc.restore();
    } catch {
      // nunca quebra o PDF
    }
  }

  function drawTableHeader() {
    const headerHeight = 22;
    let x = startX;

    doc.rect(startX, cursorY, colWidths.reduce((a, b) => a + b, 0), headerHeight).fill(C.blue);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white);

    headers.forEach((h, i) => {
      doc.text(h, x + 4, cursorY + 7, { width: colWidths[i] - 8, align: 'left', lineBreak: false });
      x += colWidths[i];
    });
    doc.fillColor(C.text);

    cursorY += headerHeight;
  }

  let firstPage = true;
  function drawHeader() {
    if (firstPage) {
      firstPage = false;
      const subtitle = [company?.name, company?.cnpj ? `CNPJ ${company.cnpj}` : ''].filter(Boolean).join('  ·  ');
      cursorY = drawFullHeader(doc, {
        title: `${REPORT_TITLE} – ${moment().tz(tz).format('DD/MM/YYYY')}`,
        subtitle,
        info: [
          ['Filtro', filtroDesc],
          ['Registros', String(rows.length)],
        ],
      }) + 14;
      // a tabela começa no cabeçalho do primeiro card
      cursorY = drawKpis(doc, cursorY, kpis) + 16;
    } else {
      cursorY = drawCompactHeader(doc, { title: REPORT_TITLE, subtitle: 'Pendências por card (continuação)' }) + 12;
      drawTableHeader();
    }
  }

  function normalizeStatus(s) {
    const raw = (s ?? '').toString().trim();
    const n = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    // OPEN
    if (
      n === 'aberto' || n === 'aberta' || n === 'abertos' || n === 'abertas' ||
      n.startsWith('abert') ||
      n === 'open' ||
      n === 'pending' || n.startsWith('pend')
    ) return 'ABERTO';

    // DONE
    if (
      n === 'concluido' || n === 'concluida' || n === 'concluidos' || n === 'concluidas' ||
      n.startsWith('conclu') ||
      n === 'completed' || n.startsWith('comp') ||
      n === 'finalizado' || n === 'finalizada' || n.startsWith('finaliz') ||
      n === 'done'
    ) return 'CONCLUÍDO';

    return raw ? raw.toUpperCase() : '–';
  }

  function ensureSpace(neededHeight) {
    if (cursorY + neededHeight > bottomY - 20) {
      doc.addPage({ size: page?.size ?? 'A4', layout: page?.layout ?? 'landscape' });
      return true;
    }
    return false;
  }

  function drawRowZebra(values) {
    doc.font('Helvetica').fontSize(8);

    const heights = values.map((val, i) => {
      const txt = (val ?? '').toString();
      return doc.heightOfString(txt, { width: colWidths[i] - 8, align: alignMap[i] || 'left' }) + 8;
    });

    const rowHeight = Math.max(24, ...heights);

    if (ensureSpace(rowHeight)) return drawRowZebra(values);

    if (zebraOn) {
      doc.rect(startX, cursorY, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(C.zebra);
    }
    zebraOn = !zebraOn;

    let x = startX;
    values.forEach((val, i) => {
      const align = alignMap[i] || 'left';
      doc.rect(x, cursorY, colWidths[i], rowHeight).lineWidth(0.4).strokeColor(C.border).stroke();
      const isStatus = i === 6;
      doc.font(isStatus ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(isStatus ? (val === 'ABERTO' ? C.red : (val === 'CONCLUÍDO' ? C.green : C.text)) : C.text);
      doc.text((val ?? '').toString(), x + 4, cursorY + 4, { width: colWidths[i] - 8, align });
      x += colWidths[i];
    });

    cursorY += rowHeight;
  }

  function drawCardSectionHeader(cardInfo) {
    const faixaH = 26;
    const faixaW = colWidths.reduce((a, b) => a + b, 0);

    if (ensureSpace(faixaH + 28)) return drawCardSectionHeader(cardInfo);

    doc.rect(startX, cursorY, faixaW, faixaH).fill(C.totalFill);
    doc.rect(startX, cursorY, 3, faixaH).fill(C.teal);
    doc.fillColor(C.navy);

    const yTxt = cursorY + 7;

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        `Card #${cardInfo.card_id || '—'}  •  Pedido: ${cardInfo.pedido_id || '—'}  •  Cliente: ${cardInfo.cliente_nome || '—'}`,
        startX + 8,
        yTxt,
        { width: faixaW - 260, ellipsis: true }
      );

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(C.text)
      .text(`Pendentes: ${cardInfo.pend}  |  Concluídas: ${cardInfo.concl}`, startX + faixaW - 240, yTxt, {
        width: 230,
        align: 'right',
      });

    cursorY += faixaH;
    zebraOn = false;
    drawTableHeader();
  }

  doc.on('pageAdded', () => {
    addWatermark();
    drawHeader();
  });

  // KPIs do cabeçalho
  const kpis = (() => {
    const cards = new Set(rows.map((r) => r.card_id ?? '—'));
    const abertos = rows.filter((r) => normalizeStatus(r.status) === 'ABERTO').length;
    const concluidos = rows.filter((r) => normalizeStatus(r.status) === 'CONCLUÍDO').length;
    return [
      { label: 'Cards', value: String(cards.size), hint: 'Cards com pendências', color: SERIES[0] },
      { label: 'Itens', value: String(rows.length), hint: 'Registros no relatório', color: SERIES[5] },
      { label: 'Pendentes', value: String(abertos), hint: 'Status aberto', color: abertos ? C.red : SERIES[7] },
      { label: 'Concluídos', value: String(concluidos), hint: 'Status concluído', color: SERIES[1] },
    ];
  })();

  addWatermark();
  drawHeader();

  // Group by card_id
  const grupos = (() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.card_id ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  })();

  const cardsOrdenados = Array.from(grupos.keys()).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    return (Number.isNaN(na) || Number.isNaN(nb)) ? String(a).localeCompare(String(b)) : na - nb;
  });

  for (const cardId of cardsOrdenados) {
    const itens = grupos.get(cardId) || [];
    const base = itens[0] || {};

    let pend = 0;
    let concl = 0;
    for (const i of itens) {
      const s = normalizeStatus(i.status);
      if (s === 'ABERTO') pend++;
      if (s === 'CONCLUÍDO') concl++;
    }

    drawCardSectionHeader({
      card_id: base.card_id,
      pedido_id: base.order_separation_number,
      cliente_nome: base.customer_name,
      pend,
      concl,
    });

    itens.sort((a, b) => {
      const sa = normalizeStatus(a.status);
      const sb = normalizeStatus(b.status);
      if (sa !== sb) return sa.localeCompare(sb);
      return String(a.product_code || '').localeCompare(String(b.product_code || ''));
    });

    for (const p of itens) {
      drawRowZebra([
        p.card_id ?? '-',
        p.order_separation_number ?? '-',
        p.customer_name ?? '-',
        p.product_code ?? '-',
        p.product_description ?? '-',
        (p.quantity != null ? `${p.quantity}${p.unit ? ` ${p.unit}` : ''}` : '-'),
        normalizeStatus(p.status),
        p.obs ?? '-',
      ]);
    }

    cursorY += 6;
  }

  drawFooters(doc, { title: REPORT_TITLE });
  doc.end();

  const buffer = await new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });

  return { buffer, filename };
}
