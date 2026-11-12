// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationSalesPerformancePdf.js — PDF Desempenho de Vendedores     ║
// ║ CONSART ERP | PDFKit | ESM | layout padrão (consartPdfTheme.js)     ║
// ║ Caminho: backend/generationPdf/generationSalesPerformancePdf.js     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
    C, SERIES, PAGE,
    createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, nowBR,
} from './consartPdfTheme.js';

function safeText(value, def = '-') {
    const s = String(value ?? '').trim();
    return s || def;
}

function numberBR(value) {
    return Number(value || 0).toLocaleString('pt-BR');
}

function moneyBR(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function dateBR(value) {
    if (!value) return '-';

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';

    return d.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo'
    });
}

function hourBR(value) {
    if (!value) return '-';

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';

    return d.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateInputBR(value) {
    if (!value) return '-';

    const [ano, mes, dia] = String(value).split('-');
    if (!ano || !mes || !dia) return value;

    return `${dia}/${mes}/${ano}`;
}

function normalizeTipo(tipo) {
    return String(tipo || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');
}

function isPerda(tipo) {
    return [
        'OUTCOME_LOSS',
        'OUTCOME_NO_CONTACT',
        'OUTCOME_DROP',
        'OUTCOME_CANCELLED',
        'LOSS',
        'LOST',
        'NO_CONTACT',
        'SEM_EXITO',
        'SEM_EXITO_CONTATO',
        'QUEDA_VENDA',
        'CANCELLED'
    ].includes(normalizeTipo(tipo));
}

function formatTipo(tipo) {
    const mapa = {
        OUTCOME_LOSS: 'Perda',
        OUTCOME_NO_CONTACT: 'Sem Êxito no Contato',
        OUTCOME_DROP: 'Queda de Venda',
        OUTCOME_CANCELLED: 'Cancelado',
        LOSS: 'Perda',
        LOST: 'Perdido',
        NO_CONTACT: 'Sem Contato',
        SEM_EXITO: 'Sem Êxito',
        SEM_EXITO_CONTATO: 'Sem Êxito no Contato',
        QUEDA_VENDA: 'Queda de Venda',
        CANCELLED: 'Cancelado',
        OUTCOME_CONVERSION: 'Conversão',
        CONVERSION: 'Conversão',
        DEAL_WON: 'Negócio Ganho',
        WON: 'Ganho',
        CREATE_DEAL: 'Criação de Lead',
        CREATE_CONTACT: 'Criação de Contato',
        MOVE_STAGE: 'Movimentação de Etapa',
        UPDATE_DEAL: 'Atualização do Lead'
    };

    const t = normalizeTipo(tipo);
    return mapa[t] || safeText(tipo);
}

function getCliente(row) {
    return safeText(
        row?.cliente ||
        row?.client_name ||
        row?.customer_name ||
        row?.razao_social ||
        row?.nome_fantasia
    );
}

function getVendedor(row) {
    return safeText(
        row?.vendedor ||
        row?.responsavel ||
        row?.seller_name ||
        row?.usuario
    );
}

function getMotivoPerda(row) {
    return safeText(
        row?.motivo_perda ||
        row?.lost_reason ||
        row?.loss_reason ||
        row?.reason_lost ||
        row?.lost_motive ||
        row?.motivo ||
        row?.observacao_perda ||
        row?.notes,
        '-'
    );
}

const KPI_LABELS = {
    contatosInseridos: 'Quantos Contatos Foram Inseridos',
    leadsEncerrados: 'Quantos Leads Foram Encerrados',
    leadsConvertidos: 'Quantos Leads Foram Convertidos',
    leadsPerdidos: 'Quantos Leads Foram Perdidos',
    movimentosEtapa: 'Movimentações de Etapa',
    atualizacoes: 'Atualizações Realizadas',
    totalAcoes: 'Total de Ações',
    clientesUnicos: 'Clientes Únicos'
};

const REPORT_TITLE = 'Desempenho de Vendedores';

const KPI_SHORT = {
    contatosInseridos: ['Contatos inseridos', 'Quantos contatos foram inseridos'],
    leadsEncerrados: ['Leads encerrados', 'Quantos leads foram encerrados'],
    leadsConvertidos: ['Leads convertidos', 'Quantos leads foram convertidos'],
    leadsPerdidos: ['Leads perdidos', 'Quantos leads foram perdidos'],
    movimentosEtapa: ['Mov. de etapa', 'Movimentações de etapa'],
    atualizacoes: ['Atualizações', 'Atualizações realizadas'],
    totalAcoes: ['Total de ações', 'Todas as ações no CRM'],
    clientesUnicos: ['Clientes únicos', 'Clientes diferentes'],
};

const KPI_COLORS = {
    leadsConvertidos: C.green,
    leadsPerdidos: C.red,
};

const CONVERSION_TYPES = ['OUTCOME_CONVERSION', 'CONVERSION', 'DEAL_WON', 'SALE_CONVERTED', 'GANHO', 'WON'];

function tipoColor(tipo) {
    if (isPerda(tipo)) return C.red;
    if (CONVERSION_TYPES.includes(normalizeTipo(tipo))) return C.green;
    return C.text;
}

export async function generateSalesPerformancePdf({
    inicio,
    fim,
    responsavel = 'Todos',
    metricas = {},
    movimentacoes = [],
    configPdf = {}
} = {}) {
    const { doc, done } = createThemedDoc({ title: REPORT_TITLE });
    const generatedAt = nowBR();

    let y = drawFullHeader(doc, {
        title: REPORT_TITLE,
        subtitle: 'Indicadores e movimentações do CRM',
        info: [
            ['Período', `${formatDateInputBR(inicio)} a ${formatDateInputBR(fim)}`],
            ['Responsável', safeText(responsavel, 'Todos')],
        ],
    }) + 14;

    /* ---------------- Indicadores ---------------- */

    const kpisSelecionados = Array.isArray(configPdf?.kpis) ? configPdf.kpis : [];
    const keys = kpisSelecionados.length ? kpisSelecionados : Object.keys(KPI_LABELS);
    const cards = keys.map((key, i) => ({
        label: KPI_SHORT[key]?.[0] || KPI_LABELS[key] || key,
        value: numberBR(metricas[key] || 0),
        hint: KPI_SHORT[key]?.[1] || '',
        color: KPI_COLORS[key] || SERIES[i % SERIES.length],
    }));

    for (let i = 0; i < cards.length; i += 4) {
        y = drawKpis(doc, y, cards.slice(i, i + 4)) + 10;
    }
    y += 6;

    /* ---------------- Movimentações ---------------- */

    const somentePerdidos = kpisSelecionados.length === 1 && kpisSelecionados.includes('leadsPerdidos');
    const somenteConvertidos = kpisSelecionados.length === 1 && kpisSelecionados.includes('leadsConvertidos');

    let rowsBase = [...movimentacoes];
    if (somentePerdidos) rowsBase = rowsBase.filter((m) => isPerda(m?.tipo));
    if (somenteConvertidos) rowsBase = rowsBase.filter((m) => CONVERSION_TYPES.includes(normalizeTipo(m?.tipo)));

    const columns = [
        { label: 'Data', w: 62 },
        { label: 'Hora', w: 44 },
        { label: 'Vendedor', w: 110 },
        { label: 'Cliente' },
        { label: 'Tipo', w: 120 },
        ...(somentePerdidos ? [{ label: 'Motivo da Perda' }] : []),
        { label: 'Valor', w: 90, align: 'right', bold: true },
    ];

    const table = makeTable(doc, {
        title: 'Movimentações detalhadas',
        continuation: { title: REPORT_TITLE, subtitle: 'Movimentações detalhadas (continuação)' },
        rowH: 18,
        fontSize: 7.5,
        columns,
    });

    y = table.section(y);

    if (!rowsBase.length) {
        doc.font('Helvetica').fontSize(9).fillColor(C.muted)
            .text('Sem movimentações para o período.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
    }

    rowsBase.forEach((m, index) => {
        const row = [
            dateBR(m?.datahora || m?.created_at),
            hourBR(m?.datahora || m?.created_at),
            getVendedor(m),
            getCliente(m),
            { text: formatTipo(m?.tipo), color: tipoColor(m?.tipo), bold: true },
        ];
        if (somentePerdidos) row.push(getMotivoPerda(m));
        row.push(moneyBR(m?.valor ?? m?.value_at_moment ?? m?.estimated_value ?? 0));
        y = table.row(y, row, { index });
    });

    drawFooters(doc, { title: REPORT_TITLE, generatedAt });
    doc.end();
    return done;
}

export default generateSalesPerformancePdf;
