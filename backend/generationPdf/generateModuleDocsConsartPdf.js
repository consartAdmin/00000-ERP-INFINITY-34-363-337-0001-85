// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generateModuleDocsConsartPdf.js — Documentação dos módulos (A4)      ║
// ║ CONSART ERP — PDFKit                                                ║
// ║ • Cabeçalho com logo Consart, título, data e filtros usados         ║
// ║ • Itens na ordem do menu: faixa por módulo, submenus e telas com    ║
// ║   descrição, funções (lista), observações e caminho                 ║
// ║ Retorna um Buffer com o PDF.                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GREEN = '#0f6b5c';
const GREEN_LIGHT = '#e6f2ef';
const MUTED = '#475569';
const LINE = '#e2e8f0';

const STATUS_COLORS = Object.freeze({
  PENDENTE: { bg: '#fef3c7', fg: '#b45309' },
  REVISAR: { bg: '#dbeafe', fg: '#1d4ed8' },
  DOCUMENTADO: { bg: '#dcfce7', fg: '#15803d' },
});

const TYPE_FILTER_LABELS = Object.freeze({
  dropdown: 'Módulos', submenu: 'Submenus', link: 'Telas', none: 'Fora do menu',
});
const SYSTEM_FILTER_LABELS = Object.freeze({
  CORE: 'Core', EDGE: 'Edge', INFINITY: 'Infinity', NONE: 'Sem sistema',
});
const STATUS_FILTER_LABELS = Object.freeze({
  PENDENTE: 'Pendentes', REVISAR: 'A revisar', DOCUMENTADO: 'Documentados',
});

const clean = (v) => String(v ?? '').trim();
const join = (values, sep = ' · ') => values.map(clean).filter(Boolean).join(sep);

// Helvetica (WinAnsi) não tem emoji nem setas como '▹' dos nomes do menu
const pdfText = (v) => clean(
  String(v ?? '')
    .replace(/[^\n\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u203A]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
);

function dateTimeBR(date = new Date()) {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function defaultLogo() {
  const candidates = [
    path.resolve(__dirname, '../public/imagens/brasaoConsartInfinity.png'),
    path.resolve(process.cwd(), 'public/imagens/brasaoConsartInfinity.png'),
    path.resolve(process.cwd(), 'backend/public/imagens/brasaoConsartInfinity.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** "Módulo: Vendas · Tipo: Telas · Busca: "pedido"" */
function describeFilters(filters = {}) {
  const parts = [];
  if (clean(filters.moduleName)) parts.push(`Módulo: ${clean(filters.moduleName)}`);
  if (TYPE_FILTER_LABELS[filters.type]) parts.push(`Tipo: ${TYPE_FILTER_LABELS[filters.type]}`);
  const system = clean(filters.system).toUpperCase();
  if (SYSTEM_FILTER_LABELS[system]) parts.push(`Sistema: ${SYSTEM_FILTER_LABELS[system]}`);
  if (clean(filters.softwareName)) parts.push(`Software: ${clean(filters.softwareName)}`);
  if (STATUS_FILTER_LABELS[filters.status]) parts.push(`Documentação: ${STATUS_FILTER_LABELS[filters.status]}`);
  const act = clean(filters.active).toLowerCase();
  if (act === 'true') parts.push('Somente ativos');
  if (act === 'false') parts.push('Somente inativos');
  if (clean(filters.q)) parts.push(`Busca: "${clean(filters.q)}"`);
  return parts.length ? parts.join(' · ') : 'Todos os módulos';
}

/**
 * @param {object} data
 * @param {object[]} data.rows     itens já filtrados, na ordem do menu
 * @param {object}   data.summary  { total, PENDENTE, REVISAR, DOCUMENTADO }
 * @param {object}   data.filters  filtros usados (+ moduleName)
 * @param {boolean}  [data.showEmpty=true] imprime itens sem descrição/funções
 * @param {boolean}  [data.showPaths=true] imprime o caminho (URL) das telas
 * @param {boolean}  [data.showNotes=true] imprime as observações
 */
export async function generateModuleDocsConsartPdf({
  rows = [], summary = {}, filters = {}, showEmpty = true, showPaths = true, showNotes = true,
}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24; // espaço do rodapé

  const ensureSpace = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // ── Cabeçalho ───────────────────────────────────────────────────
  const top = doc.y;
  let textX = left;
  const logo = defaultLogo();
  if (logo) {
    try {
      doc.image(logo, left, top, { fit: [48, 48] });
      textX = left + 58;
    } catch (error) {
      console.warn('[PDF Documentação Módulos] logo inválido:', error.message);
    }
  }

  doc.font('Helvetica-Bold').fontSize(16).fillColor(GREEN)
    .text('DOCUMENTAÇÃO DOS MÓDULOS', textX, top + 4, { width: right - textX });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`Consart ERP · Gerado em ${dateTimeBR()}`, textX, doc.y + 2, { width: right - textX })
    .text(`Filtros: ${pdfText(describeFilters(filters))}`, { width: right - textX });

  const headerBottom = Math.max(doc.y, top + 50) + 8;
  doc.moveTo(left, headerBottom).lineTo(right, headerBottom).lineWidth(2.5).strokeColor(GREEN).stroke();
  doc.y = headerBottom + 10;

  // Resumo
  const total = Number(summary.total || rows.length);
  doc.font('Helvetica').fontSize(9).fillColor('#334155').text(
    `${total} ${total === 1 ? 'item' : 'itens'} · ${summary.DOCUMENTADO || 0} documentados · `
    + `${summary.REVISAR || 0} a revisar · ${summary.PENDENTE || 0} pendentes`,
    left, doc.y, { width },
  );
  doc.moveDown(0.8);

  // ── Blocos ──────────────────────────────────────────────────────
  function statusPill(status, label, x, y) {
    const colors = STATUS_COLORS[status] || STATUS_COLORS.PENDENTE;
    doc.font('Helvetica-Bold').fontSize(7);
    const w = doc.widthOfString(label) + 12;
    doc.roundedRect(x - w, y, w, 12, 6).fill(colors.bg);
    doc.fillColor(colors.fg).text(label, x - w, y + 2.6, { width: w, align: 'center', lineBreak: false });
  }

  function moduleBand(name) {
    ensureSpace(40);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(left, y, width, 20).fill(GREEN);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff')
      .text(clean(name).toUpperCase(), left + 8, y + 5, { width: width - 16, lineBreak: false, ellipsis: true });
    doc.x = left;
    doc.y = y + 26;
  }

  function measureItem(r, x, w) {
    let h = r.software_label ? 30 : 18;
    doc.font('Helvetica').fontSize(9);
    if (r.description) h += doc.heightOfString(r.description, { width: w, lineGap: 1.5 }) + 4;
    r.functions_list.forEach((f) => { h += doc.heightOfString(f, { width: w - 12, lineGap: 1 }) + 1; });
    if (r.functions_list.length) h += 14;
    if (showNotes && r.notes) h += doc.heightOfString(r.notes, { width: w, lineGap: 1 }) + 16;
    return h;
  }

  function item(r) {
    const indent = Math.min(r.level, 3) * 14;
    const x = left + indent;
    const w = right - x;

    // Mantém título + começo do texto na mesma página
    ensureSpace(Math.min(measureItem(r, x, w), 160));

    const y = doc.y;
    const isModule = r.level === 0;
    if (isModule) doc.rect(left, y - 3, width, 18).fill(GREEN_LIGHT);

    const title = `${r.name}${r.is_active ? '' : ' (inativo)'}`;
    doc.font('Helvetica-Bold').fontSize(isModule ? 10.5 : 9.5).fillColor(r.is_active ? '#111' : '#94a3b8')
      .text(title, x + (isModule ? 6 : 0), y, { width: w - 220, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(join([r.type_label, r.systems_label]), right - 215, y + 1.5, { width: 140, align: 'right', lineBreak: false });
    statusPill(r.doc_status, r.doc_status_label, right - 2, y - 0.5);

    doc.x = x;
    doc.y = y + (isModule ? 21 : 15);

    if (r.software_label) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREEN)
        .text(`Software: ${r.software_label}`, x, doc.y, { width: w });
      doc.moveDown(0.2);
    }

    if (showPaths && r.type === 'link' && clean(r.path) && clean(r.path) !== '#') {
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(clean(r.path), x, doc.y, { width: w });
      doc.moveDown(0.2);
    }

    if (r.description) {
      doc.font('Helvetica').fontSize(9).fillColor('#1e293b')
        .text(r.description, x, doc.y, { width: w, lineGap: 1.5 });
      doc.moveDown(0.3);
    } else if (!r.functions_list.length) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#94a3b8')
        .text('Sem descrição cadastrada.', x, doc.y, { width: w });
      doc.moveDown(0.3);
    }

    if (r.functions_list.length) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREEN)
        .text('FUNÇÕES', x, doc.y, { width: w, characterSpacing: 0.6 });
      doc.moveDown(0.15);
      r.functions_list.forEach((f) => {
        ensureSpace(14);
        const fy = doc.y;
        doc.circle(x + 4, fy + 4.2, 1.6).fill(GREEN);
        doc.font('Helvetica').fontSize(9).fillColor('#1e293b')
          .text(f, x + 12, fy, { width: w - 12, lineGap: 1 });
        doc.moveDown(0.05);
      });
      doc.moveDown(0.2);
    }

    if (showNotes && r.notes) {
      ensureSpace(24);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED)
        .text('OBSERVAÇÕES', x, doc.y, { width: w, characterSpacing: 0.6 });
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(r.notes, x, doc.y + 1, { width: w, lineGap: 1 });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.25);
    doc.moveTo(x, doc.y).lineTo(right, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
    doc.x = left;
  }

  rows = rows.map((r) => ({
    ...r,
    name: pdfText(r.name),
    module_name: pdfText(r.module_name),
    software_label: pdfText(r.software_label),
    description: pdfText(r.description),
    notes: pdfText(r.notes),
    functions_list: r.functions_list.map(pdfText).filter(Boolean),
  }));

  const printable = showEmpty
    ? rows
    : rows.filter((r) => clean(r.description) || r.functions_list.length || (showNotes && clean(r.notes)));

  if (!printable.length) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#64748b')
      .text('Nenhum módulo encontrado com os filtros escolhidos.', left, doc.y, { width, align: 'center' });
  }

  let currentModule = null;
  printable.forEach((r) => {
    if (r.module_id !== currentModule) {
      currentModule = r.module_id;
      // Faixa do módulo quando o próprio módulo não está na lista (filtro)
      if (r.level > 0) moduleBand(r.module_name);
      else if (doc.y > headerBottom + 40) doc.moveDown(0.4);
    }
    item(r);
  });

  // ── Rodapé em todas as páginas ──────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = doc.page.height - 50;
    doc.page.margins.bottom = 0; // escrever no rodapé sem abrir página nova
    doc.moveTo(left, fy - 4).lineTo(right, fy - 4).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text('Documentação dos Módulos · Consart ERP', left, fy, { width: width / 2, lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, left + width / 2, fy, {
      width: width / 2, align: 'right', lineBreak: false,
    });
  }

  doc.end();
  return done;
}
