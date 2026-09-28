// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationSalesCommissionsFromInvoicesPdf.js                        ║
// ║ PDF - Relatório de Comissões por NF-e                                ║
// ║ CONSART ERP | PDFKit | ESM                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import PDFDocument from 'pdfkit';

function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    });
}

function number(value, digits = 2) {
    return Number(value || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function dateBR(value) {
    if (!value) return '-';

    const s = String(value).slice(0, 10);
    const [y, m, d] = s.split('-');

    if (!y || !m || !d) return '-';

    return `${d}/${m}/${y}`;
}

function safe(value, fallback = '-') {
    const s = String(value ?? '').trim();
    return s || fallback;
}

function drawHeader(doc, { filters = {} }) {
    doc.rect(0, 0, doc.page.width, 72).fill('#172033');

    doc.fillColor('#ffffff')
        .fontSize(18)
        .font('Helvetica-Bold')
        .text('Relatório de Comissões por NF-e', 36, 22);

    doc.fontSize(9)
        .font('Helvetica')
        .fillColor('#d8e2f0')
        .text('CONSART ERP - Comissões reais geradas a partir das notas fiscais emitidas.', 36, 45);

    const period = `${dateBR(filters.dateStart)} até ${dateBR(filters.dateEnd)}`;

    doc.fontSize(9)
        .fillColor('#ffffff')
        .text(`Período: ${period}`, 600, 24, {
            width: 210,
            align: 'right',
        });
}

function drawFooter(doc) {
    const bottom = doc.page.height - 32;

    doc.fontSize(8)
        .fillColor('#718096')
        .text(
            `Gerado em ${new Date().toLocaleString('pt-BR')}`,
            36,
            bottom,
            { width: 400 }
        );

    doc.text(
        `Página ${doc.page.number}`,
        doc.page.width - 140,
        bottom,
        { width: 100, align: 'right' }
    );
}

function drawKpiCard(doc, x, y, w, title, value) {
    doc.roundedRect(x, y, w, 54, 10).fillAndStroke('#ffffff', '#dce4ef');

    doc.fillColor('#66778f')
        .font('Helvetica')
        .fontSize(8)
        .text(title, x + 12, y + 10, { width: w - 24 });

    doc.fillColor('#172033')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(value, x + 12, y + 28, { width: w - 24 });
}

function drawTableHeader(doc, y) {
    const columns = getColumns();

    doc.rect(28, y, 786, 24).fill('#eef3f9');

    doc.fillColor('#334155')
        .font('Helvetica-Bold')
        .fontSize(7);

    columns.forEach((col) => {
        doc.text(col.label, col.x, y + 8, {
            width: col.w,
            align: col.align || 'left',
        });
    });

    return y + 24;
}

function getColumns() {
    return [
        { label: 'Data', x: 30, w: 48 },
        { label: 'NF-e', x: 80, w: 34 },
        { label: 'Pedido', x: 116, w: 38 },
        { label: 'Cliente', x: 156, w: 140 },
        { label: 'Vendedor', x: 298, w: 110 },
        { label: 'SKU', x: 410, w: 54 },
        { label: 'Tabela', x: 466, w: 56 },
        { label: 'Qtd', x: 524, w: 42, align: 'right' },
        { label: 'Total Item', x: 568, w: 70, align: 'right' },
        { label: 'Tipo', x: 642, w: 48 },
        { label: '%', x: 692, w: 42, align: 'right' },
        { label: 'Fixo', x: 736, w: 38, align: 'right' },
        { label: 'Comissão', x: 776, w: 38, align: 'right' },
    ];
}

function drawRow(doc, row, y, index) {
    const columns = getColumns();
    const bg = index % 2 === 0 ? '#ffffff' : '#f8fbff';

    doc.rect(28, y, 786, 24).fill(bg);

    const values = [
        dateBR(row.issue_date),
        safe(row.invoice_id),
        safe(row.order_id),
        safe(row.customer_name),
        safe(row.seller_name || row.seller_id),
        safe(row.sku),
        safe(row.price_table_name || row.price_id),
        number(row.quantity, 3),
        money(row.item_total),
        safe(row.commission_type),
        row.percent_value ? number(row.percent_value, 4) : '-',
        row.fixed_value ? money(row.fixed_value) : '-',
        money(row.item_commission),
    ];

    doc.fillColor('#223044')
        .font('Helvetica')
        .fontSize(7);

    columns.forEach((col, i) => {
        const isLast = i === columns.length - 1;

        doc.font(isLast ? 'Helvetica-Bold' : 'Helvetica')
            .text(values[i], col.x, y + 8, {
                width: col.w,
                align: col.align || 'left',
                ellipsis: true,
            });
    });

    doc.moveTo(28, y + 24)
        .lineTo(814, y + 24)
        .strokeColor('#edf2f7')
        .lineWidth(0.5)
        .stroke();

    return y + 24;
}

export async function generateSalesCommissionsFromInvoicesPdf({
    filters = {},
    diagnostics = {},
    rows = [],
} = {}) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                layout: 'landscape',
                margin: 28,
                bufferPages: true,
            });

            const chunks = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            drawHeader(doc, { filters });

            let y = 94;

            const cardW = 188;
            const gap = 10;

            drawKpiCard(doc, 28, y, cardW, 'Total registros', number(diagnostics.total || rows.length, 0));
            drawKpiCard(doc, 28 + cardW + gap, y, cardW, 'Total faturado', money(diagnostics.total_faturado));
            drawKpiCard(doc, 28 + (cardW + gap) * 2, y, cardW, 'Total comissão', money(diagnostics.total_comissao));
            drawKpiCard(doc, 28 + (cardW + gap) * 3, y, cardW, 'Sem regra', number(diagnostics.sem_commission_id, 0));

            y += 76;

            doc.fillColor('#172033')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text('Itens de comissão', 28, y);

            y += 22;
            y = drawTableHeader(doc, y);

            if (!rows.length) {
                doc.fillColor('#718096')
                    .font('Helvetica')
                    .fontSize(10)
                    .text('Nenhuma comissão encontrada para os filtros selecionados.', 28, y + 24, {
                        width: 786,
                        align: 'center',
                    });
            }

            rows.forEach((row, index) => {
                if (y > doc.page.height - 64) {
                    drawFooter(doc);
                    doc.addPage();
                    drawHeader(doc, { filters });
                    y = 94;
                    y = drawTableHeader(doc, y);
                }

                y = drawRow(doc, row, y, index);
            });

            drawFooter(doc);

            const range = doc.bufferedPageRange();

            for (let i = range.start; i < range.start + range.count; i += 1) {
                doc.switchToPage(i);

                doc.fontSize(8)
                    .fillColor('#718096')
                    .text(
                        `Página ${i + 1} de ${range.count}`,
                        doc.page.width - 140,
                        doc.page.height - 32,
                        { width: 100, align: 'right' }
                    );
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

export default generateSalesCommissionsFromInvoicesPdf;