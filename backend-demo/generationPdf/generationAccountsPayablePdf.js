// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationAccountsPayablePdf.js — Exportação PDF                    ║
// ║ CONSART ERP — Contas a Pagar                                        ║
// ║ Layout padrão (consartPdfTheme.js)                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
    C, SERIES, PAGE,
    createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, money, number, nowBR,
} from './consartPdfTheme.js';
import { list } from '../repositories/accountsPayable/accountsPayable.index.js';
import { PAYABLE_GROUPS, parseGroups } from '../repositories/accountsPayable/accountsPayable.groups.js';

const EXPORT_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 20000;

const STATUS_LABELS = Object.freeze({
    PENDING: 'Pendente',
    PAID: 'Pago',
    OVERDUE: 'Vencido',
    CANCELLED: 'Cancelado',
    CANCELED: 'Cancelado',
    PARTIAL: 'Parcial',
});

/* =====================================================================
 * Helpers
 * ===================================================================== */

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(toNumber(value, 0));
}

/**
 * Converte datas SQL / ISO para DD/MM/AAAA.
 *
 * Importante:
 * não usamos new Date('2026-09-09') para evitar alteração
 * de dia causada por timezone.
 */
function formatDateBR(value) {
    if (!value) return '';

    // ------------------------------------------------------------
    // 1. Quando já é um objeto Date
    // ------------------------------------------------------------
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const day = String(value.getUTCDate()).padStart(2, '0');
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const year = value.getUTCFullYear();

        return `${day}/${month}/${year}`;
    }

    const raw = String(value).trim();

    // ------------------------------------------------------------
    // 2. PostgreSQL / ISO
    // Ex:
    // 2026-09-10
    // 2026-09-10T00:00:00.000Z
    // ------------------------------------------------------------
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (isoMatch) {
        const [, year, month, day] = isoMatch;

        return `${day}/${month}/${year}`;
    }

    // ------------------------------------------------------------
    // 3. Quando já está em formato brasileiro
    // ------------------------------------------------------------
    const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

    if (brMatch) {
        const [, day, month, year] = brMatch;

        return `${day}/${month}/${year}`;
    }

    // ------------------------------------------------------------
    // 4. Datas JS em texto
    // Ex:
    // Thu Sep 10 2026 00:00:00 GMT...
    // ------------------------------------------------------------
    const parsed = new Date(raw);

    if (!Number.isNaN(parsed.getTime())) {
        const day = String(parsed.getUTCDate()).padStart(2, '0');
        const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        const year = parsed.getUTCFullYear();

        return `${day}/${month}/${year}`;
    }

    return '';
}

function formatStatus(value) {
    const status = String(value || '')
        .trim()
        .toUpperCase();

    return STATUS_LABELS[status] || status || '-';
}

function getBalance(row) {
    if (
        row?.balance != null &&
        Number.isFinite(Number(row.balance))
    ) {
        return Number(row.balance);
    }

    return Math.max(
        0,
        toNumber(row?.total_value) -
        toNumber(row?.amount_paid)
    );
}

/* =====================================================================
 * Filtros
 * ===================================================================== */

function formatGroup(key) {
    return PAYABLE_GROUPS.find((g) => g.key === key)?.label || key;
}

function normalizeFilters(filters = {}) {
    return {
        search: filters.search || undefined,
        status: filters.status || undefined,
        supplierId: filters.supplierId || undefined,
        fromDueDate: filters.fromDueDate || undefined,
        toDueDate: filters.toDueDate || undefined,
        month: filters.month || undefined,
        year: filters.year || undefined,
        groups: filters.groups || undefined,
        orderBy: filters.orderBy || 'due_date asc',
    };
}

async function loadAllRows(filters = {}) {
    const normalized = normalizeFilters(filters);

    const rows = [];

    let page = 1;
    let total = 0;

    do {
        const result = await list({
            ...normalized,
            page,
            pageSize: EXPORT_PAGE_SIZE,
        });

        const chunk = Array.isArray(result?.rows)
            ? result.rows
            : [];

        total = Number(result?.total || chunk.length);

        rows.push(...chunk);

        if (
            !chunk.length ||
            rows.length >= total ||
            rows.length >= MAX_EXPORT_ROWS
        ) {
            break;
        }

        page += 1;

    } while (true);

    return rows.slice(0, MAX_EXPORT_ROWS);
}

function makeFilename() {
    const stamp = new Date()
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '');

    return `contas-a-pagar-${stamp}.pdf`;
}

/* =====================================================================
 * Gerador PDF
 * ===================================================================== */

const REPORT_TITLE = 'Contas a Pagar';

const STATUS_COLORS = Object.freeze({
    PAID: C.green,
    OVERDUE: C.red,
    PARTIAL: C.amber,
    CANCELLED: C.muted,
    CANCELED: C.muted,
});

function headerInfo(filters = {}) {
    const info = [];
    const from = filters.fromDueDate ? formatDateBR(filters.fromDueDate) : '';
    const to = filters.toDueDate ? formatDateBR(filters.toDueDate) : '';

    if (from || to) info.push(['Vencimento', from && to ? `${from} a ${to}` : (from ? `A partir de ${from}` : `Até ${to}`)]);
    else if (filters.month || filters.year) info.push(['Competência', [filters.month ? String(filters.month).padStart(2, '0') : '', filters.year].filter(Boolean).join('/')]);
    else info.push(['Período', 'Todos os períodos']);

    info.push(['Status', filters.status ? formatStatus(filters.status) : 'Todos']);

    const groups = parseGroups(filters.groups);
    info.push(['Grupos', groups.length ? groups.map(formatGroup).join(', ') : 'Todos']);

    if (filters.search) info.push(['Busca', filters.search]);
    return info;
}

export async function generateAccountsPayablePdf(filters = {}) {

    const rows = await loadAllRows(filters);

    const { doc, done } = createThemedDoc({ title: REPORT_TITLE, subject: 'Relatório de Contas a Pagar' });
    const generatedAt = nowBR();

    /* ---------------- Totais ---------------- */

    const totalValue = rows.reduce((sum, row) => sum + toNumber(row.total_value), 0);
    const amountPaid = rows.reduce((sum, row) => sum + toNumber(row.amount_paid), 0);
    const balance = rows.reduce((sum, row) => sum + getBalance(row), 0);

    const overdue = rows.filter((row) => String(row.status || '').toUpperCase() === 'OVERDUE');
    const overdueBalance = overdue.reduce((sum, row) => sum + getBalance(row), 0);

    /* ---------------- Cabeçalho + KPIs ---------------- */

    let y = drawFullHeader(doc, {
        title: REPORT_TITLE,
        subtitle: 'Títulos a pagar por vencimento',
        info: headerInfo(filters),
    }) + 14;

    y = drawKpis(doc, y, [
        { label: 'Títulos', value: number(rows.length, 0), hint: 'Registros no relatório', color: SERIES[0] },
        { label: 'Valor total', value: money(totalValue), hint: 'Soma dos títulos', color: SERIES[5] },
        { label: 'Pago', value: money(amountPaid), hint: 'Valor já baixado', color: SERIES[1] },
        { label: 'Saldo a pagar', value: money(balance), hint: 'Valor - pago', color: SERIES[2] },
        { label: 'Vencidos', value: money(overdueBalance), hint: `${number(overdue.length, 0)} título(s) vencido(s)`, color: overdue.length ? C.red : SERIES[7] },
    ]) + 16;

    /* ---------------- Tabela ---------------- */

    const table = makeTable(doc, {
        title: 'Títulos',
        continuation: { title: REPORT_TITLE, subtitle: 'Títulos (continuação)' },
        rowH: 18,
        fontSize: 7.5,
        headFontSize: 7.5,
        columns: [
            { label: 'Vencimento', w: 70, align: 'center' },
            { label: 'Fornecedor' },
            { label: 'Documento', w: 90 },
            { label: 'Descrição' },
            { label: 'Status', w: 70, align: 'center' },
            { label: 'Valor', w: 86, align: 'right' },
            { label: 'Pago', w: 86, align: 'right' },
            { label: 'Saldo', w: 86, align: 'right', bold: true },
        ],
    });

    y = table.section(y);

    if (!rows.length) {
        doc.font('Helvetica').fontSize(9).fillColor(C.muted)
            .text('Nenhum título encontrado para os filtros selecionados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
    }

    rows.forEach((row, index) => {
        const statusKey = String(row.status || '').trim().toUpperCase();

        y = table.row(y, [
            formatDateBR(row.due_date),
            row.supplier_name || '-',
            row.document_number || row.invoice_number || '-',
            row.description || '-',
            { text: formatStatus(row.status), color: STATUS_COLORS[statusKey] || C.text, bold: true },
            formatCurrency(row.total_value),
            formatCurrency(row.amount_paid),
            formatCurrency(getBalance(row)),
        ], { index });
    });

    if (rows.length) {
        table.total(y, [
            'TOTAL', `${number(rows.length, 0)} registro(s)`, '', '', '',
            formatCurrency(totalValue), formatCurrency(amountPaid), formatCurrency(balance),
        ]);
    }

    drawFooters(doc, { title: REPORT_TITLE, generatedAt });
    doc.end();

    const buffer = await done;

    return {
        buffer,
        filename: makeFilename(),
        rowCount: rows.length,
    };
}

export default generateAccountsPayablePdf;
