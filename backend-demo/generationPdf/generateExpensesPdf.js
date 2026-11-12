// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generateExpensesPdf.js — Relatório PDF de Despesas (Expenses)        ║
// ║ Path: backend/generationPdf/generateExpensesPdf.js                   ║
// ║ CONSART ERP | ESM                                                    ║
// ║ - Gera PDF A4 Paisagem                                               ║
// ║ - Layout padrão (consartPdfTheme.js)                                 ║
// ║ - Filtros: q, name, status, category, vendor, date_from, date_to     ║
// ║ - Ordenação compatível com o frontend (created_at_desc etc.)         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, number, nowBR,
} from './consartPdfTheme.js';
import pool from '../config/db.js';
import { sortOrderBy } from '../repositories/expenses/expenses.sql.js';

const TB = 'public."Expenses"'; // ajuste se seu schema/tabela for diferente

// pasta pública para download: backend/public (servida em /public pelo server.js).
// Relativo a este arquivo, não ao cwd — com cwd=backend o caminho virava backend/backend/public.
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'pdfs', 'expenses');

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function fmtDateTimeBR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function moneyBR(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'PAID') return 'PAGO';
  if (v === 'CANCELLED') return 'CANCELADO';
  return 'PENDENTE';
}

function normalizeStr(s) {
  return String(s ?? '').trim();
}

/**
 * order_by keys (igual no frontend):
 * created_at_desc, created_at_asc,
 * due_date_asc, due_date_desc,
 * value_desc, value_asc,
 * name_asc, name_desc,
 * update_at_desc, update_at_asc  (frontend tem "update_at_*" (typo))
 */
function mapOrderBy(order_by) {
  const key = String(order_by || 'created_at_desc');
  switch (key) {
    case 'created_at_asc':  return `"created_at" ASC`;
    case 'created_at_desc': return `"created_at" DESC`;
    case 'due_date_asc':    return `"due_date" ASC NULLS LAST`;
    case 'due_date_desc':   return `"due_date" DESC NULLS LAST`;
    case 'value_asc':       return `"value" ASC NULLS LAST`;
    case 'value_desc':      return `"value" DESC NULLS LAST`;
    case 'name_asc':        return `"name" ASC NULLS LAST`;
    case 'name_desc':       return `"name" DESC NULLS LAST`;
    case 'update_at_asc':   return `"updated_at" ASC NULLS LAST`;
    case 'update_at_desc':  return `"updated_at" DESC NULLS LAST`;
    case 'updated_at_asc':  return `"updated_at" ASC NULLS LAST`;
    case 'updated_at_desc': return `"updated_at" DESC NULLS LAST`;
    default:                return `"created_at" DESC`;
  }
}

function buildWhereAndParams(filters = {}) {
  const params = [];
  const where = [];

  const q = normalizeStr(filters.q);
  const name = normalizeStr(filters.name);
  const status = normalizeStr(filters.status);
  const category = normalizeStr(filters.category);
  const vendor = normalizeStr(filters.vendor);
  const date_from = normalizeStr(filters.date_from);
  const date_to = normalizeStr(filters.date_to);

  // busca ampla
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(
      COALESCE("name",'') ILIKE ${p} OR
      COALESCE("description",'') ILIKE ${p} OR
      COALESCE("vendor",'') ILIKE ${p} OR
      COALESCE("category",'') ILIKE ${p}
    )`);
  }

  if (name) {
    params.push(`%${name}%`);
    where.push(`COALESCE("name",'') ILIKE $${params.length}`);
  }

  if (status) {
    params.push(status.toUpperCase());
    where.push(`UPPER(COALESCE("status",'')) = $${params.length}`);
  }

  if (category) {
    params.push(`%${category}%`);
    where.push(`COALESCE("category",'') ILIKE $${params.length}`);
  }

  if (vendor) {
    params.push(`%${vendor}%`);
    where.push(`COALESCE("vendor",'') ILIKE $${params.length}`);
  }

  // período (pelo due_date)
  if (date_from) {
    params.push(date_from);
    where.push(`"due_date" >= $${params.length}::date`);
  }

  if (date_to) {
    params.push(date_to);
    where.push(`"due_date" <= $${params.length}::date`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

async function fetchExpensesForPdf({
  q, name, status, category, vendor,
  date_from, date_to,
  order_by = 'created_at_desc',
  sort = '',
  dir = '',
  limit = 2000, // limite de segurança (pdf não deve explodir)
} = {}) {
  const { whereSql, params } = buildWhereAndParams({
    q, name, status, category, vendor, date_from, date_to,
  });

  // Ordem do cabeçalho da tabela (sort/dir) tem prioridade
  const orderSql = sortOrderBy(sort, dir) || mapOrderBy(order_by);

  // total + soma (mesmos filtros)
  const sqlAgg = `
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(COALESCE("value",0)),0)::numeric AS total_value
    FROM ${TB}
    ${whereSql}
  `;

  const agg = await pool.query(sqlAgg, params);
  const total = agg.rows?.[0]?.total || 0;
  const total_value = agg.rows?.[0]?.total_value || 0;

  // linhas
  const params2 = [...params];
  params2.push(Number(limit));
  const pLimit = `$${params2.length}`;

  const sqlRows = `
    SELECT
      "id",
      "name",
      "category",
      "vendor",
      "value",
      "due_date",
      "status",
      "created_at",
      "updated_at"
    FROM ${TB}
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ${pLimit}
  `;

  const rows = await pool.query(sqlRows, params2);
  return { total, total_value, rows: rows.rows || [] };
}

/* ──────────────────────────────────────────────────────────────
   Layout padrão
────────────────────────────────────────────────────────────── */
const REPORT_TITLE = 'Relatório de Despesas';

const STATUS_COLORS = { PAGO: C.green, CANCELADO: C.muted, PENDENTE: C.amber };

function headerInfo(f = {}) {
  const info = [];
  if (f.date_from || f.date_to) {
    info.push(['Vencimento', `${f.date_from ? fmtDateBR(f.date_from) : '...'} a ${f.date_to ? fmtDateBR(f.date_to) : '...'}`]);
  } else {
    info.push(['Período', 'Todos os períodos']);
  }
  info.push(['Status', f.status ? statusLabel(f.status) : 'Todos']);
  const extra = [];
  if (f.q) extra.push(`Busca "${f.q}"`);
  if (f.name) extra.push(`Nome "${f.name}"`);
  if (f.category) extra.push(`Categoria "${f.category}"`);
  if (f.vendor) extra.push(`Fornecedor "${f.vendor}"`);
  info.push(['Filtros', extra.length ? extra.join(' · ') : 'Nenhum']);
  return info;
}

/* ──────────────────────────────────────────────────────────────
   MAIN: generateExpensesPdf()
────────────────────────────────────────────────────────────── */
/**
 * @param {object} options
 * @param {object} options.filters
 * @param {string} options.baseUrl  (ex: http://localhost:8080) -> para montar url pública
 * @returns {Promise<{ ok:true, filePath:string, publicUrl:string, filename:string, total:number, total_value:number }>}
 */
export async function generateExpensesPdf({ filters = {}, baseUrl = '' } = {}) {
  ensureDirSync(OUT_DIR);

  // 1) fetch data
  const { total, total_value, rows } = await fetchExpensesForPdf({
    q: filters.q,
    name: filters.name,
    status: filters.status,
    category: filters.category,
    vendor: filters.vendor,
    date_from: filters.date_from,
    date_to: filters.date_to,
    order_by: filters.order_by || 'created_at_desc',
    sort: filters.sort,
    dir: filters.dir,
    limit: filters.limit || 2000,
  });

  // 2) output file
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const filename = `expenses_${stamp}.pdf`;
  const filePath = path.join(OUT_DIR, filename);

  // 3) totais
  const sumBy = (st) => rows.filter((r) => statusLabel(r.status) === st).reduce((s, r) => s + Number(r.value || 0), 0);
  const countBy = (st) => rows.filter((r) => statusLabel(r.status) === st).length;
  const paid = sumBy('PAGO');
  const pending = sumBy('PENDENTE');

  // 4) PDF
  const { doc, done } = createThemedDoc({ title: REPORT_TITLE, subject: 'Despesas' });
  const generatedAt = nowBR();

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Financeiro · Gestão de Despesas',
    info: headerInfo(filters),
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Despesas', value: number(total, 0), hint: rows.length < total ? `${number(rows.length, 0)} listadas no PDF` : 'Registros no relatório', color: SERIES[0] },
    { label: 'Valor total', value: moneyBR(total_value), hint: 'Soma dos valores', color: SERIES[5] },
    { label: 'Pagas', value: moneyBR(paid), hint: `${number(countBy('PAGO'), 0)} despesa(s)`, color: SERIES[1] },
    { label: 'Pendentes', value: moneyBR(pending), hint: `${number(countBy('PENDENTE'), 0)} despesa(s)`, color: SERIES[2] },
  ]) + 16;

  const table = makeTable(doc, {
    title: 'Despesas',
    continuation: { title: REPORT_TITLE, subtitle: 'Despesas (continuação)' },
    rowH: 18,
    fontSize: 7.5,
    columns: [
      { label: 'ID', w: 44 },
      { label: 'Nome' },
      { label: 'Categoria' },
      { label: 'Fornecedor' },
      { label: 'Valor', w: 86, align: 'right', bold: true },
      { label: 'Venc.', w: 64, align: 'center' },
      { label: 'Status', w: 66, align: 'center' },
      { label: 'Criado em', w: 84 },
    ],
  });

  y = table.section(y);

  if (!rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhuma despesa encontrada para os filtros selecionados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  rows.forEach((row, index) => {
    const st = statusLabel(row.status);
    y = table.row(y, [
      String(row.expense_id || row.id || ''),
      String(row.name || ''),
      String(row.category || ''),
      String(row.vendor || ''),
      moneyBR(row.value),
      fmtDateBR(row.due_date),
      { text: st, color: STATUS_COLORS[st] || C.text, bold: true },
      fmtDateTimeBR(row.created_at),
    ], { index });
  });

  if (rows.length) {
    table.total(y, ['TOTAL', `${number(rows.length, 0)} registro(s)`, '', '', moneyBR(rows.reduce((s, r) => s + Number(r.value || 0), 0)), '', '', '']);
  }

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();

  await fs.promises.writeFile(filePath, await done);

  // public url
  // arquivo salvo em: backend/public/pdfs/expenses/<file>
  const publicPath = `/public/pdfs/expenses/${filename}`;
  const publicUrl = baseUrl ? `${String(baseUrl).replace(/\/$/, '')}${publicPath}` : publicPath;

  return {
    ok: true,
    filename,
    filePath,
    publicUrl,
    total,
    total_value: Number(total_value || 0),
  };
}
