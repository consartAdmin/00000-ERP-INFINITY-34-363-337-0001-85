'use strict';

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, number as themeNumber, nowBR,
} from './consartPdfTheme.js';

const MAX_ROWS = 20000;

const STATUS_LABELS = Object.freeze({
  PENDING: 'Pendente', PAID: 'Pago', OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado', CANCELED: 'Cancelado', PARTIAL: 'Parcial',
});

const OPEN_STATUSES = new Set(['PENDING', 'OVERDUE', 'PARTIAL']);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dateBR(value) {
  if (!value) return '-';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }

  const source = String(value).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;

  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(source);
  if (brMatch) return `${brMatch[1]}/${brMatch[2]}/${brMatch[3]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(parsed);
}

function text(value, fallback = '-') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function statusLabel(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return STATUS_LABELS[key] || text(value);
}

const REPORT_TITLE = 'Contas a Receber';

const STATUS_COLORS = Object.freeze({
  PAID: C.green, OVERDUE: C.red, PARTIAL: C.amber, CANCELLED: C.muted, CANCELED: C.muted,
});

function headerInfo(filters = {}) {
  const dateType = String(filters.dateType || '').toLowerCase() === 'issue_date' ? 'issue_date' : 'due_date';
  const fromDate = filters.fromDate || (dateType === 'issue_date' ? filters.fromIssueDate : filters.fromDueDate);
  const toDate = filters.toDate || (dateType === 'issue_date' ? filters.toIssueDate : filters.toDueDate);

  const info = [];
  if (fromDate || toDate) {
    info.push([dateType === 'issue_date' ? 'Emissão' : 'Vencimento', `${dateBR(fromDate)} a ${dateBR(toDate)}`]);
  } else {
    info.push(['Período', 'Todos os períodos']);
  }
  info.push(['Status', filters.status ? statusLabel(filters.status) : 'Todos']);
  if (filters.search) info.push(['Busca', filters.search]);
  return info;
}

export async function generateAccountsReceivablePdf({ rows = [], filters = {} } = {}) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];
  const { doc, done } = createThemedDoc({ title: REPORT_TITLE, subject: 'Relatório de Contas a Receber' });
  const generatedAt = nowBR();

  const totals = safeRows.reduce((acc, row) => {
    const total = number(row.value);
    const paid = number(row.paid_value);
    const balance = Math.max(0, total - paid);
    const status = String(row.status ?? '').trim().toUpperCase();
    acc.total += total;
    acc.paid += paid;
    if (OPEN_STATUSES.has(status)) acc.balance += balance;
    if (status === 'OVERDUE') { acc.overdue += balance; acc.overdueCount += 1; }
    return acc;
  }, { total: 0, paid: 0, balance: 0, overdue: 0, overdueCount: 0 });

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Títulos a receber de clientes',
    info: headerInfo(filters),
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Títulos', value: themeNumber(safeRows.length, 0), hint: 'Registros no relatório', color: SERIES[0] },
    { label: 'Valor total', value: money(totals.total), hint: 'Soma dos títulos', color: SERIES[5] },
    { label: 'Recebido', value: money(totals.paid), hint: 'Valor já recebido', color: SERIES[1] },
    { label: 'Em aberto', value: money(totals.balance), hint: 'Pendentes, vencidos e parciais', color: SERIES[2] },
    { label: 'Vencidos', value: money(totals.overdue), hint: `${themeNumber(totals.overdueCount, 0)} título(s) vencido(s)`, color: totals.overdueCount ? C.red : SERIES[7] },
  ]) + 16;

  const table = makeTable(doc, {
    title: 'Títulos',
    continuation: { title: REPORT_TITLE, subtitle: 'Títulos (continuação)' },
    rowH: 17,
    columns: [
      { label: 'ID', w: 40 },
      { label: 'Cliente' },
      { label: 'Nº Fatura', w: 76 },
      { label: 'Emissão', w: 62 },
      { label: 'Vencimento', w: 66 },
      { label: 'Status', w: 66 },
      { label: 'Total', w: 84, align: 'right' },
      { label: 'Recebido', w: 84, align: 'right' },
      { label: 'Saldo', w: 88, align: 'right', bold: true },
    ],
  });

  y = table.section(y);

  if (!safeRows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhum título encontrado para os filtros selecionados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  safeRows.forEach((row, index) => {
    const statusKey = String(row.status ?? '').trim().toUpperCase();
    y = table.row(y, [
      text(row.id),
      text(row.customer_name),
      text(row.invoice_number),
      dateBR(row.issue_date ?? row.emissao),
      dateBR(row.due_date ?? row.vencimento),
      { text: statusLabel(row.status), color: STATUS_COLORS[statusKey] || C.text, bold: true },
      money(row.value),
      money(row.paid_value),
      money(number(row.value) - number(row.paid_value)),
    ], { index });
  });

  if (safeRows.length) {
    table.total(y, [
      'TOTAL', `${themeNumber(safeRows.length, 0)} registro(s)`, '', '', '', '',
      money(totals.total), money(totals.paid), `Aberto ${money(totals.balance)}`,
    ]);
  }

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();
  return done;
}

export default generateAccountsReceivablePdf;
