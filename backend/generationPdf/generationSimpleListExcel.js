// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationSimpleListExcel.js — XLSX de listas de cadastro simples     ║
// ║ (Grades, Unidades...) com cabeçalho CONSART e tabela com filtros      ║
// ║                                                                      ║
// ║ buildSimpleListWorkbook({                                            ║
// ║   title, subtitle, info: [[label, valor]], sheetName,                ║
// ║   columns: [{ key, label, width?, align?, numFmt?, value?(row) }],   ║
// ║   rows, emptyText,                                                   ║
// ║ }) -> Promise<Buffer>                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname, '../public/imagens/brasaoConsart.png');

const ARGB = {
  navy: 'FF0F2747',
  blue: 'FF174A7E',
  teal: 'FF14B8A6',
  text: 'FF1E293B',
  white: 'FFFFFFFF',
  sub: 'FFC7D4E6',
};

const FONT = 'Calibri';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// Nome de tabela do Excel: só letras/números/_ e começando por letra
function tableName(text) {
  const clean = String(text || 'Tabela').normalize('NFD').replace(/[^\w]/g, '');
  return /^[A-Za-z]/.test(clean) ? clean : `T${clean}`;
}

export async function buildSimpleListWorkbook({
  title = 'Relatório',
  subtitle = '',
  info = [],
  sheetName,
  columns = [],
  rows = [],
  emptyText = 'Nenhum registro encontrado com os filtros atuais.',
} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CONSART ERP';
  workbook.created = new Date();
  workbook.title = title;

  const sheet = workbook.addWorksheet(String(sheetName || title).slice(0, 31), {
    properties: { tabColor: { argb: ARGB.blue } },
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: 'portrait',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8CONSART ERP · ${title}&R&8Página &P de &N` },
  });

  const lastCol = Math.max(columns.length, 2);
  const last = colLetter(lastCol);
  columns.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width || 16; });

  /* ---------------- Cabeçalho CONSART (linhas 1–4) ---------------- */
  sheet.getRow(1).height = 34;
  sheet.getRow(2).height = 18;
  sheet.getRow(3).height = 20;
  sheet.getRow(4).height = 4;

  for (let r = 1; r <= 4; r += 1) {
    for (let c = 1; c <= lastCol; c += 1) {
      sheet.getCell(r, c).fill = fill(r === 4 ? ARGB.teal : ARGB.navy);
    }
  }

  sheet.mergeCells(`B1:${last}1`);
  sheet.mergeCells(`B2:${last}2`);
  sheet.mergeCells(`B3:${last}3`);

  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  Object.assign(sheet.getCell('B1'), {
    value: String(title).toUpperCase(),
    font: { name: FONT, size: 16, bold: true, color: { argb: ARGB.white } },
    alignment: { vertical: 'middle', indent: 1 },
  });

  Object.assign(sheet.getCell('B2'), {
    value: ['CONSART ERP', subtitle].filter(Boolean).join('  ·  '),
    font: { name: FONT, size: 10, color: { argb: ARGB.sub } },
    alignment: { vertical: 'middle', indent: 1 },
  });

  Object.assign(sheet.getCell('B3'), {
    value: [...info, ['Gerado em', generatedAt]].map(([l, v]) => `${l}: ${v}`).join('     |     '),
    font: { name: FONT, size: 9, color: { argb: ARGB.white } },
    alignment: { vertical: 'middle', indent: 1 },
  });

  try {
    if (fs.existsSync(LOGO_PATH)) {
      const logoId = workbook.addImage({ buffer: fs.readFileSync(LOGO_PATH), extension: 'png' });
      sheet.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 52, height: 52 }, editAs: 'oneCell' });
    }
  } catch {
    // sem logo
  }

  /* ---------------- Tabela com filtros (a partir da linha 6) ---------------- */
  sheet.getRow(5).height = 8;
  const headerRow = 6;
  const firstData = headerRow + 1;

  const data = rows.map((row) => columns.map((col) => {
    const v = typeof col.value === 'function' ? col.value(row) : row?.[col.key];
    return v === undefined ? null : v;
  }));

  if (!data.length) data.push(columns.map((_, i) => (i === 1 || columns.length === 1 ? emptyText : null)));

  sheet.addTable({
    name: tableName(sheetName || title),
    ref: `A${headerRow}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columns.map((c) => ({ name: c.label, filterButton: true })),
    rows: data,
  });

  for (let r = firstData; r < firstData + data.length; r += 1) {
    const row = sheet.getRow(r);
    row.height = 18;
    row.font = { name: FONT, size: 10, color: { argb: ARGB.text } };
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
      if (col.numFmt) cell.numFmt = col.numFmt;
      if (col.bold) cell.font = { name: FONT, size: 10, bold: true, color: { argb: ARGB.navy } };
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }];
  return workbook.xlsx.writeBuffer();
}

export default buildSimpleListWorkbook;
