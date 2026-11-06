// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesTaxes.export.js — Impostos sobre vendas (Excel / PDF)          ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Resumo (faturamento, impostos, carga, líquido)                   ║
// ║ ✅ Impostos por tipo                                                ║
// ║ ✅ Impostos por produto                                             ║
// ║ ✅ PDF no layout padrão (consartPdfTheme.js)                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import ExcelJS from 'exceljs';
import {
    C as THEME,
    createThemedDoc, drawFullHeader, drawKpis, drawFooters, makeTable,
    money, nowBR,
} from '../../generationPdf/consartPdfTheme.js';


const MONEY_FORMAT = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const PDF_TITLE = 'Impostos sobre vendas';

const COLORS = Object.freeze({
    title: '1E3A8A',
    total: 'F1F5F9',
    muted: '64748B',
});


function num(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function percent(value) {
    return `${num(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function dateBR(value) {
    return String(value || '').slice(0, 10).split('-').reverse().join('/');
}

function periodText(data) {
    return `${dateBR(data.filters?.startDate)} até ${dateBR(data.filters?.endDate)}`;
}

function regimeText(data) {
    return data.regime?.summary || data.regime?.label || 'sem regime cadastrado';
}

function countedTaxes(data) {
    return (data.byTax || []).filter((tax) => !tax.informative && num(tax.value) > 0);
}

function informativeTaxes(data) {
    return (data.byTax || []).filter((tax) => tax.informative && num(tax.value) > 0);
}

export function salesTaxesFileName(data, extension) {
    const start = String(data.filters?.startDate || '').slice(0, 10);
    const end = String(data.filters?.endDate || '').slice(0, 10);
    return `impostos_vendas_${start}_${end}.${extension}`;
}


// ======================================================================
// EXCEL
// ======================================================================

export async function buildSalesTaxesXlsx(data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CONSART ERP';
    workbook.created = new Date();

    addTaxesSheet(workbook, data);
    addProductsSheet(workbook, data);

    return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addHeader(sheet, data, title, lastColumn) {
    sheet.mergeCells(`A1:${lastColumn}1`);
    sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: COLORS.title } };

    sheet.mergeCells(`A2:${lastColumn}2`);
    sheet.getCell('A2').value = `Período: ${periodText(data)} · Regime: ${regimeText(data)}`;
    sheet.getCell('A2').font = { size: 10, color: { argb: COLORS.muted } };

    sheet.mergeCells(`A3:${lastColumn}3`);
    sheet.getCell('A3').value = `Gerado em ${new Date().toLocaleString('pt-BR')} · impostos gravados na emissão das NF-e`;
    sheet.getCell('A3').font = { size: 9, italic: true, color: { argb: COLORS.muted } };
}

function styleHeaderRow(row) {
    row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.title } };
    });
}

function styleTotalRow(row) {
    row.font = { bold: true };
    row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.total } };
    });
}

function addTaxesSheet(workbook, data) {
    const sheet = workbook.addWorksheet('Impostos por tipo');
    const summary = data.summary || {};

    sheet.columns = [
        { key: 'label', width: 40 },
        { key: 'value', width: 18 },
        { key: 'rate', width: 16 },
        { key: 'share', width: 16 },
        { key: 'note', width: 40 },
    ];

    addHeader(sheet, data, 'Impostos sobre vendas — por tipo', 'E');
    sheet.addRow([]);

    [
        ['Total faturamento', num(summary.totalRevenue)],
        ['Total impostos', num(summary.totalTaxes)],
        ['Carga tributária sobre faturamento', num(summary.effectiveRate) / 100],
        ['Líquido após impostos', num(summary.netAfterTaxes)],
        ['Notas com impostos', `${num(summary.coveredInvoices)} de ${num(summary.totalInvoices)}`],
    ].forEach(([label, value]) => {
        const row = sheet.addRow([label, value]);
        row.getCell(1).font = { bold: true };
        if (typeof value === 'number') {
            row.getCell(2).numFmt = label.startsWith('Carga') ? '0.00%' : MONEY_FORMAT;
        }
    });

    sheet.addRow([]);
    styleHeaderRow(sheet.addRow(['Imposto', 'Valor', '% do faturamento', '% dos impostos', 'Observação']));

    const firstRow = sheet.rowCount + 1;
    countedTaxes(data).forEach((tax) => {
        const row = sheet.addRow([
            tax.label,
            num(tax.value),
            num(tax.rateOverRevenue) / 100,
            num(tax.percentage) / 100,
            tax.estimated ? 'Estimado pelo Regime Tributário' : '',
        ]);
        row.getCell(2).numFmt = MONEY_FORMAT;
        row.getCell(3).numFmt = '0.00%';
        row.getCell(4).numFmt = '0.0%';
    });

    const totalRow = sheet.addRow(['TOTAL', num(summary.totalTaxes), num(summary.effectiveRate) / 100, 1, '']);
    totalRow.getCell(2).numFmt = MONEY_FORMAT;
    totalRow.getCell(3).numFmt = '0.00%';
    totalRow.getCell(4).numFmt = '0.0%';
    styleTotalRow(totalRow);

    const informative = informativeTaxes(data);
    if (informative.length) {
        sheet.addRow([]);
        const title = sheet.addRow(['Informativo (fora do total)']);
        title.getCell(1).font = { bold: true, color: { argb: COLORS.muted } };

        informative.forEach((tax) => {
            const row = sheet.addRow([tax.label, num(tax.value), num(tax.rateOverRevenue) / 100, '', 'Informativo']);
            row.getCell(2).numFmt = MONEY_FORMAT;
            row.getCell(3).numFmt = '0.00%';
            row.font = { italic: true, color: { argb: COLORS.muted } };
        });
    }

    sheet.views = [{ state: 'frozen', ySplit: firstRow - 1 }];
}

function addProductsSheet(workbook, data) {
    const sheet = workbook.addWorksheet('Impostos por produto');

    sheet.columns = [
        { key: 'label', width: 56 },
        { key: 'netTotal', width: 18 },
        { key: 'value', width: 18 },
        { key: 'rate', width: 12 },
        { key: 'share', width: 14 },
    ];

    addHeader(sheet, data, 'Impostos sobre vendas — por produto', 'E');
    sheet.addRow([]);
    styleHeaderRow(sheet.addRow(['Produto', 'Vendido', 'Impostos', 'Carga', '% dos impostos']));

    const products = data.byProduct || [];
    products.forEach((product) => {
        const row = sheet.addRow([
            product.label,
            num(product.netTotal),
            num(product.value),
            num(product.effectiveRate) / 100,
            num(product.percentage) / 100,
        ]);
        row.getCell(2).numFmt = MONEY_FORMAT;
        row.getCell(3).numFmt = MONEY_FORMAT;
        row.getCell(4).numFmt = '0.00%';
        row.getCell(5).numFmt = '0.0%';
    });

    const sold = products.reduce((sum, product) => sum + num(product.netTotal), 0);
    const taxes = products.reduce((sum, product) => sum + num(product.value), 0);
    const share = products.reduce((sum, product) => sum + num(product.percentage), 0) / 100;
    const totalRow = sheet.addRow(['TOTAL', sold, taxes, sold > 0 ? taxes / sold : 0, share]);
    totalRow.getCell(2).numFmt = MONEY_FORMAT;
    totalRow.getCell(3).numFmt = MONEY_FORMAT;
    totalRow.getCell(4).numFmt = '0.00%';
    totalRow.getCell(5).numFmt = '0.0%';
    styleTotalRow(totalRow);

    sheet.views = [{ state: 'frozen', ySplit: 5 }];
}


// ======================================================================
// PDF
// ======================================================================

export async function buildSalesTaxesPdf(data) {
    const { doc, done } = createThemedDoc({ title: PDF_TITLE, layout: 'portrait' });

    writePdf(doc, data);
    drawFooters(doc, { title: PDF_TITLE, generatedAt: nowBR() });
    doc.end();

    return done;
}

function writePdf(doc, data) {
    const summary = data.summary || {};

    let y = drawFullHeader(doc, {
        title: PDF_TITLE,
        subtitle: 'Impostos por tipo e por produto',
        info: [
            ['Período', periodText(data)],
            ['Regime', regimeText(data)],
        ],
    }) + 14;

    y = drawKpis(doc, y, [
        { label: 'Faturamento', value: money(summary.totalRevenue), color: THEME.green },
        { label: 'Total impostos', value: money(summary.totalTaxes), color: THEME.red, valueColor: '#be123c' },
        { label: 'Carga tributária', value: percent(summary.effectiveRate), color: THEME.amber },
        { label: 'Líquido', value: money(summary.netAfterTaxes), color: THEME.navy },
    ]) + 16;

    // ---------------- POR TIPO ----------------
    const taxTable = makeTable(doc, {
        title: 'Impostos por tipo',
        columns: [
            { label: 'Imposto' },
            { label: 'Valor', w: 110, align: 'right' },
            { label: '% do faturamento', w: 100, align: 'right' },
            { label: '% dos impostos', w: 100, align: 'right' },
        ],
        continuation: { title: PDF_TITLE },
    });

    y = taxTable.section(y);
    countedTaxes(data).forEach((tax, index) => {
        y = taxTable.row(y, [
            tax.label + (tax.estimated ? ' (estimado)' : ''),
            money(tax.value),
            percent(tax.rateOverRevenue),
            percent(tax.percentage),
        ], { index });
    });
    y = taxTable.total(y, ['TOTAL', money(summary.totalTaxes), percent(summary.effectiveRate), '100,00%']);

    informativeTaxes(data).forEach((tax, index) => {
        y = taxTable.row(y, [
            { text: `${tax.label} (informativo, fora do total)`, color: THEME.muted },
            { text: money(tax.value), color: THEME.muted },
            { text: percent(tax.rateOverRevenue), color: THEME.muted },
            '',
        ], { index });
    });

    // ---------------- POR PRODUTO ----------------
    const productTable = makeTable(doc, {
        title: 'Impostos por produto',
        columns: [
            { label: 'Produto' },
            { label: 'Vendido', w: 95, align: 'right' },
            { label: 'Impostos', w: 90, align: 'right' },
            { label: 'Carga', w: 60, align: 'right' },
            { label: '% dos impostos', w: 80, align: 'right' },
        ],
        continuation: { title: PDF_TITLE },
    });

    y = productTable.section(y + 18);
    const products = data.byProduct || [];

    if (!products.length) {
        productTable.row(y, ['Sem impostos no período.', '', '', '', '']);
        return;
    }

    products.forEach((product, index) => {
        y = productTable.row(y, [
            product.label,
            money(product.netTotal),
            money(product.value),
            percent(product.effectiveRate),
            percent(product.percentage),
        ], { index });
    });

    const sold = products.reduce((sum, product) => sum + num(product.netTotal), 0);
    const taxes = products.reduce((sum, product) => sum + num(product.value), 0);
    const share = products.reduce((sum, product) => sum + num(product.percentage), 0);
    productTable.total(y, ['TOTAL', money(sold), money(taxes), percent(sold > 0 ? (taxes / sold) * 100 : 0), percent(share)]);
}
