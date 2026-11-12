// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationCustomerTrainingPdf.js — Relatório de Treinamento (PDF)   ║
// ║ - Cabeçalho com logo CONSART                                        ║
// ║ - Dados do treinamento / conteúdo programático                      ║
// ║ - Lista de presença, observações, pendências e assinaturas          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C, PAGE, drawFullHeader, autoCompactHeader, drawFooters, nowBR } from './consartPdfTheme.js';
import { FORMAT_LABELS, STATUS_LABELS } from '../repositories/customerTrainings/customerTrainings.constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGO_PATH = path.resolve(__dirname, '../public/imagens/brasaoConsartInfinity.png');

const COLORS = {
  dark: C.navy,
  text: C.text,
  muted: C.muted,
  border: C.border,
  headBg: C.blue,
};

// "YYYY-MM-DDTHH:mm" → "DD/MM/YYYY às HH:mm" (sem conversão de fuso)
export function formatScheduledAt(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : '-';
}

export function formatDuration(minutes) {
  const total = Number(minutes) || 0;
  if (!total) return '-';
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (!h) return `${min} min`;
  return min ? `${h}h${String(min).padStart(2, '0')}` : `${h}h`;
}

function formatTaxId(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return value || '';
}

function drawHeader(doc, title, training = {}) {
  const docTitle = `${title} nº ${training.training_id ?? ''}`.trim();
  const y = drawFullHeader(doc, {
    title,
    subtitle: 'Treinamentos de Clientes',
    info: [
      ['Treinamento', training.training_id != null ? `nº ${training.training_id}` : ''],
      ['Data', formatScheduledAt(training.scheduled_at)],
      ['Situação', STATUS_LABELS[training.status] || training.status || ''],
    ],
    logo: LOGO_PATH,
  });
  autoCompactHeader(doc, { title: docTitle, subtitle: training.title || 'Treinamentos de Clientes', logo: LOGO_PATH });

  doc.fillColor(COLORS.text);
  return y + 18;
}

function ensureSpace(doc, y, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + needed <= bottom) return y;
  doc.addPage();
  return doc.page.margins.top;
}

function sectionTitle(doc, text, y) {
  y = ensureSpace(doc, y, 40);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.navy).text(text, doc.page.margins.left, y);
  doc.rect(doc.page.margins.left, doc.y + 1, 34, 2).fill(C.teal);
  return doc.y + 8;
}

// Caixa com texto livre (altura acompanha o conteúdo)
function textBox(doc, text, y, emptyText) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const pad = 8;
  const content = String(text || '').trim() || emptyText;

  doc.font('Helvetica').fontSize(10);
  const height = doc.heightOfString(content, { width: width - pad * 2 }) + pad * 2;
  y = ensureSpace(doc, y, Math.min(height, 200));

  const top = y;
  doc.fillColor(String(text || '').trim() ? COLORS.text : COLORS.muted)
    .text(content, left + pad, top + pad, { width: width - pad * 2 });

  // Se o texto quebrou página, desenha a borda só na página final
  const boxTop = doc.y < top ? doc.page.margins.top : top;
  doc.lineWidth(0.5).strokeColor(COLORS.border)
    .rect(left, boxTop, width, doc.y + pad - boxTop).stroke();

  return doc.y + pad + 14;
}

// Grade de pares rótulo/valor em 2 colunas
function infoGrid(doc, pairs, y) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const colWidth = width / 2;
  const rowHeight = 30;
  const rows = Math.ceil(pairs.length / 2);

  y = ensureSpace(doc, y, rows * rowHeight);
  doc.lineWidth(0.5).strokeColor(COLORS.border).rect(left, y, width, rows * rowHeight).stroke();

  pairs.forEach(([label, value], i) => {
    const x = left + (i % 2) * colWidth;
    const rowY = y + Math.floor(i / 2) * rowHeight;

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(label.toUpperCase(), x + 8, rowY + 5, { width: colWidth - 16 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text)
      .text(String(value ?? '-') || '-', x + 8, rowY + 15, { width: colWidth - 16, height: 13, ellipsis: true });
  });

  return y + rows * rowHeight + 16;
}

function attendeesTable(doc, attendees, y, showAttendance) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const cols = showAttendance
    ? [['Participante', 0.34], ['E-mail', 0.32], ['Telefone', 0.18], ['Presença', 0.16]]
    : [['Participante', 0.38], ['E-mail', 0.38], ['Telefone', 0.24]];
  const rowHeight = 20;

  const drawHead = (top) => {
    doc.save().rect(left, top, width, rowHeight).fill(COLORS.headBg).restore();
    let x = left;
    cols.forEach(([label, w]) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
        .text(label, x + 6, top + 6, { width: width * w - 12 });
      x += width * w;
    });
    return top + rowHeight;
  };

  y = ensureSpace(doc, y, rowHeight * 2);
  y = drawHead(y);

  if (!attendees.length) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text('Nenhum participante informado.', left + 6, y + 6);
    return y + rowHeight + 16;
  }

  attendees.forEach((a) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = drawHead(doc.page.margins.top);
    }

    const presence = a.attended === true ? 'Presente' : a.attended === false ? 'Ausente' : '-';
    const values = showAttendance
      ? [a.name, a.email, a.phone, presence]
      : [a.name, a.email, a.phone];

    let x = left;
    values.forEach((value, i) => {
      const w = width * cols[i][1];
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
        .text(value || '-', x + 6, y + 6, { width: w - 12, height: 11, ellipsis: true });
      x += w;
    });

    doc.lineWidth(0.5).strokeColor(COLORS.border)
      .moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).stroke();
    y += rowHeight;
  });

  return y + 16;
}

function signatures(doc, training, y) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const lineWidth = (width - 40) / 2;

  y = ensureSpace(doc, y + 30, 50);
  if (y === doc.page.margins.top) y += 30; // página nova: espaço para assinar abaixo do cabeçalho

  [
    [left, training.trainer_name || 'Instrutor', 'Instrutor'],
    [left + lineWidth + 40, training.customer_trade_name || training.customer_legal_name || 'Cliente', 'Responsável pelo cliente'],
  ].forEach(([x, name, role]) => {
    doc.lineWidth(0.5).strokeColor(COLORS.muted).moveTo(x, y).lineTo(x + lineWidth, y).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
      .text(name, x, y + 4, { width: lineWidth, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(role, x, doc.y + 1, { width: lineWidth, align: 'center' });
  });

  return doc.y + 20;
}

/**
 * Gera o relatório / lista de presença de um treinamento.
 * @param {Object} training Retorno de customerTrainings.getById (com attendees)
 * @returns {Promise<Buffer>}
 */
export default function generateCustomerTrainingPdf(training) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerH + 16 },
        bufferPages: true,
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const isDone = training.status === 'done';
      const headerTitle = isDone ? 'Relatório de Treinamento' : 'Programação de Treinamento';
      let y = drawHeader(doc, headerTitle, training);

      // 1. Título
      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text)
        .text(training.title || 'Treinamento', doc.page.margins.left, y);
      y = doc.y + 10;

      // 2. Dados gerais
      const customerName = training.customer_trade_name || training.customer_legal_name || '-';
      const taxId = formatTaxId(training.customer_tax_id);

      y = infoGrid(doc, [
        ['Cliente', customerName],
        ['CNPJ / CPF', taxId || '-'],
        ['Data e horário', formatScheduledAt(training.scheduled_at)],
        ['Duração', formatDuration(training.duration_minutes)],
        ['Formato', FORMAT_LABELS[training.format] || training.format || '-'],
        ['Instrutor', training.trainer_name || '-'],
        ['Local / link', training.location_or_link || '-'],
        ['Situação', STATUS_LABELS[training.status] || training.status || '-'],
      ], y);

      // 3. Conteúdo programático
      y = sectionTitle(doc, 'Conteúdo programático', y);
      y = textBox(doc, training.topics, y, 'Nenhum conteúdo informado.');

      // 4. Participantes / presença
      y = sectionTitle(doc, isDone ? 'Lista de presença' : 'Participantes', y);
      y = attendeesTable(doc, training.attendees || [], y, isDone);

      // 5. Observações e pendências (após a realização)
      if (isDone) {
        y = sectionTitle(doc, 'Observações do treinamento', y);
        y = textBox(doc, training.notes, y, 'Sem observações.');

        y = sectionTitle(doc, 'Pendências', y);
        y = textBox(doc, training.pending_items, y, 'Sem pendências.');

        y = signatures(doc, training, y);
      }

      // Rodapé (layout padrão) em todas as páginas
      drawFooters(doc, { title: `Treinamento nº ${training.training_id ?? '-'}`, generatedAt: nowBR() });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
