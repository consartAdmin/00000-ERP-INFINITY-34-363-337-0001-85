// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationReportsSuppliersPdf.js — Relatório de Fornecedores       ║
// ║ CONSART ERP · PDFKit · ESM · layout padrão (consartPdfTheme.js)    ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
    C, SERIES, PAGE,
    createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, number,
} from './consartPdfTheme.js';

const COLUMNS = Object.freeze([
    { key: 'supplierId', label: '#', width: 38, align: 'center' },
    { key: 'name', label: 'Nome', width: 174, align: 'left' },
    { key: 'taxId', label: 'CNPJ / CPF', width: 103, align: 'left' },
    { key: 'city', label: 'Cidade', width: 105, align: 'left' },
    { key: 'state', label: 'UF', width: 30, align: 'center' },
    { key: 'phone', label: 'Telefone', width: 86, align: 'left' },
    { key: 'email', label: 'Email', width: 152, align: 'left' },
    { key: 'status', label: 'Status', width: 55, align: 'center' },
]);

function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

function onlyDigits(value) {
    return text(value).replace(/\D+/g, '');
}

function formatTaxId(value) {
    const digits = onlyDigits(value);

    if (digits.length === 14) {
        return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }

    if (digits.length === 11) {
        return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }

    return text(value);
}

function formatStatus(value) {
    const status = text(value).toUpperCase();
    return ['INACTIVE', 'INATIVO', 'FALSE', '0'].includes(status) ? 'Inativo' : 'Ativo';
}

function normalizeSupplier(supplier = {}) {
    return {
        supplierId: text(supplier.supplier_id ?? supplier.id),
        name: text(supplier.name ?? supplier.supplier_name),
        taxId: formatTaxId(supplier.tax_id ?? supplier.cnpj_cpf),
        city: text(supplier.city),
        state: text(supplier.state ?? supplier.uf).toUpperCase(),
        phone: text(supplier.phone),
        email: text(supplier.email),
        status: formatStatus(supplier.status ?? supplier.active ?? supplier.is_active),
    };
}

/**
 * Gera o relatório de fornecedores em formato PDF.
 *
 * @param {Array<object>} suppliers Fornecedores retornados pelo banco.
 * @param {object} [options]
 * @param {string} [options.title='Relatório de Fornecedores']
 * @param {Date|string} [options.generatedAt=new Date()]
 * @returns {Promise<Buffer>}
 */
export async function generateReportsSuppliersPdf(suppliers = [], options = {}) {
    if (!Array.isArray(suppliers)) {
        throw new TypeError('suppliers deve ser um array.');
    }

    const title = text(options.title) || 'Relatório de Fornecedores';
    const parsedDate = new Date(options.generatedAt ?? Date.now());
    const generatedAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    const rows = suppliers.map(normalizeSupplier);

    const { doc, done } = createThemedDoc({ title, subject: 'Relatório de fornecedores' });

    const active = rows.filter((r) => r.status === 'Ativo').length;
    const states = new Set(rows.map((r) => r.state).filter(Boolean));
    const withEmail = rows.filter((r) => r.email).length;

    let y = drawFullHeader(doc, {
        title,
        subtitle: 'Cadastro de fornecedores',
        info: [
            ['Fornecedores', number(rows.length, 0)],
            ['Ativos', number(active, 0)],
        ],
    }) + 14;

    y = drawKpis(doc, y, [
        { label: 'Fornecedores', value: number(rows.length, 0), hint: 'Registros no relatório', color: SERIES[0] },
        { label: 'Ativos', value: number(active, 0), hint: 'Status ativo', color: SERIES[1] },
        { label: 'Inativos', value: number(rows.length - active, 0), hint: 'Status inativo', color: rows.length - active ? C.red : SERIES[7] },
        { label: 'Estados', value: number(states.size, 0), hint: 'UFs diferentes', color: SERIES[5] },
        { label: 'Com e-mail', value: number(withEmail, 0), hint: 'Cadastros com e-mail', color: SERIES[2] },
    ]) + 16;

    const table = makeTable(doc, {
        title: 'Fornecedores',
        continuation: { title, subtitle: 'Fornecedores (continuação)' },
        rowH: 18,
        fontSize: 7.5,
        columns: COLUMNS.map((c) => ({ label: c.label, w: c.width, align: c.align })),
    });

    y = table.section(y);

    if (!rows.length) {
        doc.font('Helvetica').fontSize(9).fillColor(C.muted)
            .text('Nenhum fornecedor encontrado.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
    }

    rows.forEach((supplier, index) => {
        y = table.row(y, COLUMNS.map((c) => (c.key === 'status'
            ? { text: supplier.status, color: supplier.status === 'Ativo' ? C.green : C.red, bold: true }
            : supplier[c.key])), { index });
    });

    drawFooters(doc, {
        title,
        extra: `${number(rows.length, 0)} fornecedor(es)`,
        generatedAt: generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    });
    doc.end();

    return done;
}

export default generateReportsSuppliersPdf;
