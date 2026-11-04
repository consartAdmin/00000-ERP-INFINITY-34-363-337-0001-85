// /backend/reports/generationCustomersPdf.js
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ generationCustomersPdf.js — Relatório de Clientes (PDF | GRID | ESM)         ║
// ║ - A4 Paisagem (landscape)                                                    ║
// ║ - 1 cliente por linha (tabela “Excel” contínua)                              ║
// ║ - Colunas: ID | Nome Fantasia | CNPJ/CPF | E-mail | Telefone | Cidade | UF | ║
// ║           Vendedor | Segmento | Status | Situação                            ║
// ║ - ✅ Corrige “última coluna cortada” (ajuste de largura + rounding fix)      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, contentWidth, number, nowBR,
} from './consartPdfTheme.js';

/* ─────────────────────────────────────────────────────────────
   Utils
───────────────────────────────────────────────────────────── */
function safe(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (s === 'null' || s === 'undefined') return '';
  return s;
}
function fmtBool(v) {
  if (v === true) return 'Ativo';
  if (v === false) return 'Inativo';
  return '';
}
function normalizeFilters(filters = {}) {
  const q = (filters.q ?? '').toString().trim() || '';
  const is_active =
    filters.is_active === true ? true :
    filters.is_active === false ? false :
    null;
  return { q, is_active };
}
function pick(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  return null;
}
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function buildFileName() {
  return `relatorio_clientes_${nowStamp()}.pdf`;
}

/* ─────────────────────────────────────────────────────────────
   Colunas
───────────────────────────────────────────────────────────── */
function getColumns() {
  return [
    { label: 'ID',            w: 6,  align: 'left',   value: (c) => safe(pick(c.customer_id, c.id)) },
    { label: 'Nome Fantasia', w: 20, align: 'left',   value: (c) => safe(pick(c.trade_name, c.nome_fantasia, c.fantasy_name)) },
    { label: 'CNPJ/CPF',      w: 12, align: 'left',   value: (c) => safe(pick(c.tax_id, c.cnpj_cpf, c.cnpjCpf, c.cpf_cnpj)) },
    { label: 'E-mail',        w: 18, align: 'left',   value: (c) => safe(pick(c.email, c.mail)) },
    { label: 'Telefone',      w: 12, align: 'left',   value: (c) => safe(pick(c.phone_number, c.phone, c.telefone, c.mobile_number, c.mobile)) },
    { label: 'Cidade',        w: 12, align: 'left',   value: (c) => safe(pick(c.city, c.cidade)) },
    { label: 'UF',            w: 5,  align: 'center', value: (c) => safe(pick(c.state, c.uf)) },
    { label: 'Vendedor',      w: 12, align: 'left',   value: (c) => safe(pick(c.salesperson, c.vendedor, c.seller_name)) },
    { label: 'Segmento',      w: 10, align: 'left',   value: (c) => safe(pick(c.business_segment, c.segmento)) },
    { label: 'Status',        w: 10, align: 'left',   value: (c) => safe(pick(c.status_name_pt, c.status_name, c.status_internal_code)) },
    // ✅ dá um pouco mais de “peso” na última coluna
    { label: 'Situação',      w: 10, align: 'center', value: (c) => fmtBool(pick(c.is_active)) },
  ];
}

/* ─────────────────────────────────────────────────────────────
   MAIN — layout padrão (consartPdfTheme.js)
───────────────────────────────────────────────────────────── */
const REPORT_TITLE = 'Relatório de Clientes';

/**
 * @param {Object} params
 * @param {import('express').Request} params.req
 * @param {import('express').Response} params.res
 * @param {Array<Object>} params.rows
 * @param {Object} params.filters
 */
export async function generateCustomersPdf({ req, res, rows = [], filters = {} } = {}) {
  const filename = buildFileName();
  const { q, is_active } = normalizeFilters(filters);
  const data = Array.isArray(rows) ? rows : [];

  const { doc, done } = createThemedDoc({ title: REPORT_TITLE });
  const generatedAt = nowBR();

  const active = data.filter((c) => pick(c.is_active) === true).length;
  const inactive = data.filter((c) => pick(c.is_active) === false).length;
  const states = new Set(data.map((c) => safe(pick(c.state, c.uf)).toUpperCase()).filter(Boolean));
  const sellers = new Set(data.map((c) => safe(pick(c.salesperson, c.vendedor, c.seller_name))).filter(Boolean));

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Cadastro de clientes',
    info: [
      ['Filtro', q || 'Nenhum'],
      ['Situação', is_active === null ? 'Todas' : (is_active ? 'Ativos' : 'Inativos')],
      ['Clientes', number(data.length, 0)],
    ],
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Clientes', value: number(data.length, 0), hint: 'Registros no relatório', color: SERIES[0] },
    { label: 'Ativos', value: number(active, 0), hint: 'Situação ativa', color: SERIES[1] },
    { label: 'Inativos', value: number(inactive, 0), hint: 'Situação inativa', color: inactive ? C.red : SERIES[7] },
    { label: 'Estados', value: number(states.size, 0), hint: 'UFs diferentes', color: SERIES[5] },
    { label: 'Vendedores', value: number(sellers.size, 0), hint: 'Com clientes na lista', color: SERIES[2] },
  ]) + 16;

  const defs = getColumns();
  const weight = defs.reduce((s, c) => s + (c.w || 1), 0);
  const width = contentWidth(doc);

  const table = makeTable(doc, {
    title: 'Clientes',
    continuation: { title: REPORT_TITLE, subtitle: 'Clientes (continuação)' },
    rowH: 17,
    columns: defs.map((c) => ({ label: c.label, align: c.align, w: (width * (c.w || 1)) / weight })),
  });

  y = table.section(y);

  if (!data.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhum cliente encontrado para os filtros informados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  data.forEach((row, index) => {
    y = table.row(y, defs.map((c) => {
      const v = c.value ? c.value(row) : safe(row?.[c.key]);
      if (c.label === 'Situação') return { text: v, color: v === 'Ativo' ? C.green : (v === 'Inativo' ? C.red : undefined), bold: true };
      return v;
    }), { index });
  });

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();

  const pdf = await done;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  res.end(pdf);
}

export default { generateCustomersPdf };
