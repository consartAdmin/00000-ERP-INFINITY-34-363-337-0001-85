// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: generateManufacturesOrderManufacturerPdf.js                   ║
// ║ MODULE: Manufactures Orders                                         ║
// ║ DESCRIPTION: PDF PARA ENVIO AO FABRICANTE - LANDSCAPE               ║
// ║ CONSART ERP | PDFKIT                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { C, PAGE, drawFullHeader, drawCompactHeader, drawFooters, nowBR } from './consartPdfTheme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const LOGO_BH3_PATHS = [
  path.join(ROOT_DIR, 'public', 'imagens', 'logoBH3.png'),
  path.join(ROOT_DIR, 'public', 'imagens', 'bh3.png'),
  path.join(ROOT_DIR, 'public', 'imagens', 'logo-bh3.png'),
];

const COMPANY = {
  name: 'BH3 DISTRIBUIDORA DE PRODUTOS DE LIMPEZA LTDA',
  cnpj: 'CNPJ: 34.363.337/0001-85',
  address1: 'Rua Alcântara, 126',
  address2: 'Nova Granada - Belo Horizonte/MG',
  cep: 'CEP: 30.431-315',
  phone: 'Telefone: (31) 9 8467-6552',
  email: 'contato@bh3distribuidora.com.br',
};

function findFirstExisting(paths = []) {
  return paths.find(filePath => fs.existsSync(filePath)) || null;
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function dateBR(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
}

function statusLabel(status = '') {
  const map = {
    OPEN: 'ABERTO',
    IN_PROGRESS: 'EM PRODUÇÃO',
    FINISHED: 'FINALIZADO',
    CANCELLED: 'CANCELADO',
  };

  return map[status] || status || '-';
}

function safe(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;

  const text = String(value).trim();

  return text || fallback;
}

function sanitizeFilename(value = 'pedido') {
  return String(value)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getManufacturesOrderManufacturerPdfFilename(order = {}) {
  const number =
    order.order_number ||
    order.manufacture_order_id ||
    order.id ||
    'pedido';

  return sanitizeFilename(`pedido-fabricante-${number}.pdf`);
}

const REPORT_TITLE = 'Pedido para Fabricante';

// Cabeçalho padrão (consartPdfTheme) com o logo da BH3 e os dados da empresa logo abaixo
function drawHeader(doc, order = {}) {
  const logoBh3 = findFirstExisting(LOGO_BH3_PATHS);

  const y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    brand: COMPANY.name,
    subtitle: COMPANY.cnpj,
    info: [
      ['Pedido Nº', safe(order.order_number)],
      ['Data', dateBR(order.created_at)],
      ['Fabricante', safe(order.manufacturer_name)],
    ],
    logo: logoBh3 || undefined,
    logoTile: Boolean(logoBh3),
  });

  doc
    .font('Helvetica')
    .fontSize(7.7)
    .fillColor(C.muted)
    .text(
      [COMPANY.address1, COMPANY.address2, COMPANY.cep, COMPANY.phone, COMPANY.email].join('  ·  '),
      PAGE.margin,
      y + 8,
      { width: doc.page.width - PAGE.margin * 2, align: 'center', lineBreak: false },
    );

  return y + 26;
}

function drawContinuationHeader(doc, order = {}) {
  const logoBh3 = findFirstExisting(LOGO_BH3_PATHS);
  return drawCompactHeader(doc, {
    title: `${REPORT_TITLE} Nº ${safe(order.order_number)}`,
    subtitle: `${safe(order.manufacturer_name)} (continuação)`,
    logo: logoBh3 || undefined,
    logoTile: Boolean(logoBh3),
  }) + 14;
}

function drawInfoBox(doc, order = {}, startY = 132) {
  const x = 28;
  const w = doc.page.width - 56;
  const h = 76;

  doc
    .roundedRect(x, startY, w, h, 8)
    .strokeColor(C.border)
    .lineWidth(1)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#334155')
    .text('Número Pedido', x + 14, startY + 12)
    .text('Fabricante', x + 210, startY + 12)
    .text('Status', x + 560, startY + 12)
    .text('Data', x + 680, startY + 12);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(safe(order.order_number), x + 14, startY + 30, { width: 170 })
    .text(safe(order.manufacturer_name), x + 210, startY + 30, { width: 325 })
    .text(statusLabel(order.status), x + 560, startY + 30, { width: 100 })
    .text(dateBR(order.created_at), x + 680, startY + 30, { width: 110 });

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#334155')
    .text('Observações', x + 14, startY + 54);

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#0f172a')
    .text(safe(order.notes, ''), x + 92, startY + 54, {
      width: w - 110,
      height: 18,
      ellipsis: true,
    });

  return startY + h + 18;
}

function drawTableHeader(doc, y) {
  const x = 28;
  const w = doc.page.width - 56;

  doc.rect(x, y, w, 24).fill(C.blue);

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('SKU', x + 8, y + 8, { width: 80 })
    .text('DESCRIÇÃO', x + 96, y + 8, { width: 390 })
    .text('U.M', x + 500, y + 8, { width: 45, align: 'center' })
    .text('QTDE', x + 550, y + 8, { width: 55, align: 'right' })
    .text('UNITÁRIO', x + 620, y + 8, { width: 80, align: 'right' })
    .text('TOTAL', x + 706, y + 8, { width: 74, align: 'right' }); // termina dentro da faixa (antes passava 4pt)

  return y + 24;
}

function drawTableRow(doc, item, y, index) {
  const x = 28;
  const w = doc.page.width - 56;
  const rowH = 25;

  const qty = Number(item.quantity || 0);
  const cost = Number(item.cost_price || item.cost || 0);
  const total = qty * cost;

  if (index % 2 === 0) {
    doc.rect(x, y, w, rowH).fill(C.zebra);
  }

  doc
    .rect(x, y, w, rowH)
    .strokeColor('#e5e7eb')
    .lineWidth(0.5)
    .stroke();

  doc
    .fillColor('#0f172a')
    .font('Helvetica')
    .fontSize(8)
    .text(safe(item.sku || item.product_code), x + 8, y + 8, { width: 80 })
    .text(safe(item.description), x + 96, y + 8, { width: 390, ellipsis: true })
    .text(safe(item.unit || item.um || item.unidade, 'UN'), x + 500, y + 8, { width: 45, align: 'center' })
    .text(String(qty), x + 550, y + 8, { width: 55, align: 'right' })
    .text(money(cost), x + 620, y + 8, { width: 80, align: 'right' })
    .text(money(total), x + 706, y + 8, { width: 74, align: 'right' });

  return {
    nextY: y + rowH,
    total,
  };
}

function drawTotalBox(doc, y, total) {
  const boxW = 230;
  const boxH = 42;
  const x = doc.page.width - 28 - boxW;

  doc.roundedRect(x, y, boxW, boxH, 8).fill(C.navy);

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('TOTAL GERAL', x + 14, y + 8);

  doc
    .fontSize(15)
    .text(money(total), x + 14, y + 22, {
      width: boxW - 28,
      align: 'right',
    });
}

function addNewPage(doc, order) {
  doc.addPage();
  return drawTableHeader(doc, drawContinuationHeader(doc, order));
}

export function buildManufacturesOrderManufacturerPdf(order = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 28, left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerH + 12 },
    bufferPages: true,
  });

  const items = Array.isArray(order.items) ? order.items : [];

  let y = drawInfoBox(doc, order, drawHeader(doc, order));
  y = drawTableHeader(doc, y);

  let grandTotal = 0;

  items.forEach((item, index) => {
    if (y > doc.page.height - 70) {
      y = addNewPage(doc, order);
    }

    const result = drawTableRow(doc, item, y, index);

    y = result.nextY;
    grandTotal += result.total;
  });

  if (y > doc.page.height - 105) {
    // só o total na página seguinte: cabeçalho compacto, sem repetir o cabeçalho da tabela
    doc.addPage();
    y = drawContinuationHeader(doc, order);
  }

  y += 18;

  drawTotalBox(doc, y, grandTotal);
  drawFooters(doc, { title: `${REPORT_TITLE} Nº ${safe(order.order_number)}`, generatedAt: nowBR() });

  return doc;
}

export default buildManufacturesOrderManufacturerPdf;