// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesPdfDashboard.js — Dashboard dos PDFs de Vendas                  ║
// ║ Modelo: Relatório de Comissões por NF-e (consartPdfTheme.js)         ║
// ║ 3 painéis lado a lado: barras (top clientes), rosca (produtos)       ║
// ║ e colunas (vendas por dia)                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
    PAGE, SERIES, C, num, dateBR, money, contentWidth, contentBottom,
    drawPanel, drawHorizontalBars, drawDonut, drawColumns,
} from './consartPdfTheme.js';

/**
 * Top N por valor + "Outros" com o restante (para a rosca).
 * rows: [{ label, value }]
 */
export function topWithOthers(rows = [], n = 4, othersLabel = 'Outros') {
    const sorted = rows
        .map((r) => ({ label: String(r.label ?? '').trim() || '-', value: num(r.value) }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value);

    if (sorted.length <= n + 1) return sorted;

    const top = sorted.slice(0, n);
    const rest = sorted.slice(n).reduce((s, r) => s + r.value, 0);
    return rest > 0 ? [...top, { label: othersLabel, value: rest, color: C.muted }] : top;
}

export function topN(rows = [], n = 5) {
    return rows
        .map((r) => ({ label: String(r.label ?? '').trim() || '-', value: num(r.value) }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, n);
}

// pg devolve coluna date como Date na meia-noite local: usa getters locais
function dayBR(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '-';
        const dd = String(value.getDate()).padStart(2, '0');
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${value.getFullYear()}`;
    }
    return dateBR(value);
}

// Vendas por dia -> colunas (dd/mm), em ordem de data
export function dailySeries(rows = [], { dayKey = 'day', valueKey = 'total_amount' } = {}) {
    return rows
        .map((r) => ({ raw: dayBR(r[dayKey]), value: num(r[valueKey]) }))
        .filter((r) => r.raw !== '-')
        .sort((a, b) => a.raw.split('/').reverse().join('').localeCompare(b.raw.split('/').reverse().join('')))
        .map((r) => ({ label: r.raw.slice(0, 5), value: r.value }));
}

/**
 * Desenha a linha de painéis. panels: [{ type: 'bars'|'donut'|'columns', title, subtitle, data, centerLabel, opts }]
 * Retorna o y logo abaixo dos painéis.
 */
export function drawDashboardRow(doc, y, panels = [], { h = 190, gap = 12 } = {}) {
    const list = panels.filter(Boolean);
    if (!list.length) return y;

    // não cabe na página: começa os painéis numa página nova
    if (y + h > contentBottom(doc)) {
        doc.addPage();
        y = doc.y;
    }

    const totalW = contentWidth(doc);
    const w = (totalW - gap * (list.length - 1)) / list.length;

    list.forEach((p, i) => {
        const x = PAGE.margin + i * (w + gap);
        const area = drawPanel(doc, x, y, w, h, p.title, p.subtitle);

        if (p.type === 'bars') {
            drawHorizontalBars(doc, area, p.data || [], { color: SERIES[0], format: money, labelW: Math.min(110, area.cw * 0.4), valueW: 70, ...(p.opts || {}) });
        } else if (p.type === 'donut') {
            drawDonut(doc, area, p.data || [], p.centerLabel || 'total', { maxR: 48, ...(p.opts || {}) });
        } else {
            drawColumns(doc, area, p.data || [], { color: SERIES[1], ...(p.opts || {}) });
        }
    });

    doc.x = PAGE.margin;
    doc.y = y + h;
    return y + h;
}

export default { topWithOthers, topN, dailySeries, drawDashboardRow };
