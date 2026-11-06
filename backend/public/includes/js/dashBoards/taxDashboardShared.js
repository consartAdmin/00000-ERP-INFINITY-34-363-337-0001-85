// ╔══════════════════════════════════════════════════════════════════════╗
// ║ taxDashboardShared.js — Peças comuns dos slides Impostos e Apuração ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Períodos: mês atual, mês anterior, trimestre, ano, personalizado ║
// ║ ✅ Período anterior para comparação dos KPIs                        ║
// ║ ✅ Rosca (donut) SVG com total no centro                            ║
// ║ ✅ Colunas mensais SVG (empilhadas ou agrupadas) + linha opcional   ║
// ║ ✅ Download Excel / PDF                                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { moneyBR } from './dashboardUtils.js';


// ======================================================================
// COLORS
// ======================================================================

// Same color for a tax in the table, the donut and the monthly chart.
const TAX_COLORS = Object.freeze([
    '#1d4ed8', '#0891b2', '#7dd3fc', '#7e22ce', '#f59e0b', '#10b981', '#e11d48', '#64748b',
]);

export function buildColorMap(keys = []) {
    const map = new Map();
    keys.forEach((key) => {
        if (!map.has(key)) map.set(key, TAX_COLORS[map.size % TAX_COLORS.length]);
    });
    return map;
}

export function colorFor(map, key) {
    if (!map.has(key)) map.set(key, TAX_COLORS[map.size % TAX_COLORS.length]);
    return map.get(key);
}


// ======================================================================
// PERIOD
// ======================================================================

const MONTH_LABELS = Object.freeze([
    'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
]);

export const PERIOD_OPTIONS_HTML = `
  <option value="current-month">Mês atual</option>
  <option value="previous-month">Mês anterior</option>
  <option value="current-quarter">Trimestre atual</option>
  <option value="current-year">Ano atual</option>
  <option value="custom">Escolher período</option>
`;

function pad(value) {
    return String(value).padStart(2, '0');
}

function toIso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIso(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day);
}

function lastDayOf(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

export function todayIso() {
    return toIso(new Date());
}

/** Range of a preset period; every preset stops at today. */
export function rangeForMode(mode) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    if (mode === 'previous-month') {
        const start = new Date(year, month - 1, 1);
        return {
            startDate: toIso(start),
            endDate: toIso(new Date(start.getFullYear(), start.getMonth(), lastDayOf(start.getFullYear(), start.getMonth()))),
        };
    }

    if (mode === 'current-quarter') {
        return { startDate: toIso(new Date(year, Math.floor(month / 3) * 3, 1)), endDate: toIso(today) };
    }

    if (mode === 'current-year') {
        return { startDate: `${year}-01-01`, endDate: toIso(today) };
    }

    return { startDate: toIso(new Date(year, month, 1)), endDate: toIso(today) };
}

function shiftMonths(iso, months) {
    const date = parseIso(iso);
    const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
    const day = Math.min(date.getDate(), lastDayOf(target.getFullYear(), target.getMonth()));
    return new Date(target.getFullYear(), target.getMonth(), day);
}

function isMonthEnd(iso) {
    const date = parseIso(iso);
    return date.getDate() === lastDayOf(date.getFullYear(), date.getMonth());
}

/**
 * Period used to compare the KPIs:
 * month → same days of the previous month; quarter → previous quarter;
 * year → previous year; custom → same number of days right before.
 */
export function previousRange(mode, startDate, endDate) {
    if (!startDate || !endDate) return null;

    const months = { 'current-month': 1, 'previous-month': 1, 'current-quarter': 3, 'current-year': 12 }[mode];

    if (months) {
        const start = shiftMonths(startDate, months);
        let end = shiftMonths(endDate, months);

        // A whole month compares with the whole previous month.
        if (isMonthEnd(endDate)) {
            end = new Date(end.getFullYear(), end.getMonth(), lastDayOf(end.getFullYear(), end.getMonth()));
        }

        const label = months === 12
            ? String(start.getFullYear())
            : months === 3
                ? 'trimestre anterior'
                : `${MONTH_LABELS[start.getMonth()]}/${String(start.getFullYear()).slice(2)}`;

        return { startDate: toIso(start), endDate: toIso(end), label };
    }

    const start = parseIso(startDate);
    const end = parseIso(endDate);
    const days = Math.round((end - start) / 86400000) + 1;
    const previousEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    const previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() - days + 1);

    return { startDate: toIso(previousStart), endDate: toIso(previousEnd), label: 'período anterior' };
}

/**
 * Wires the period select / custom dates / apply button of a slide.
 * `prefix` is the data-attribute prefix: "tax" → data-tax-filter.
 */
export function bindPeriodFilter(card, prefix, reload, warn) {
    if (card.dataset.periodFilterBound === 'true') return;

    const mode = card.querySelector(`[data-${prefix}-filter="periodMode"]`);
    const start = card.querySelector(`[data-${prefix}-filter="startDate"]`);
    const end = card.querySelector(`[data-${prefix}-filter="endDate"]`);
    const custom = card.querySelector(`[data-${prefix}-period-custom]`);
    const apply = card.querySelector(`[data-${prefix}-action="applyPeriod"]`);

    if (!mode || !start || !end || !custom || !apply) return;

    const initial = rangeForMode('current-month');
    start.value = initial.startDate;
    end.value = initial.endDate;
    start.max = todayIso();
    end.max = todayIso();

    const run = async () => {
        apply.disabled = true;
        mode.disabled = true;
        apply.textContent = 'Carregando...';

        try {
            await reload();
        } catch (error) {
            console.error(`[dashboard][${prefix}] Failed to apply period:`, error);
            warn('Não foi possível carregar o período selecionado.', 'error');
        } finally {
            apply.disabled = false;
            mode.disabled = false;
            apply.textContent = 'Aplicar';
        }
    };

    mode.addEventListener('change', async () => {
        const isCustom = mode.value === 'custom';
        custom.hidden = !isCustom;
        if (isCustom) return;

        const range = rangeForMode(mode.value);
        start.value = range.startDate;
        end.value = range.endDate;
        await run();
    });

    apply.addEventListener('click', async () => {
        if (!start.value || !end.value) {
            warn('Informe a data inicial e a data final.');
            return;
        }

        if (start.value > end.value) {
            warn('A data inicial não pode ser maior que a data final.');
            return;
        }

        await run();
    });

    card.dataset.periodFilterBound = 'true';
}

export function readPeriod(card, prefix) {
    return {
        mode: card.querySelector(`[data-${prefix}-filter="periodMode"]`)?.value || 'current-month',
        startDate: card.querySelector(`[data-${prefix}-filter="startDate"]`)?.value || '',
        endDate: card.querySelector(`[data-${prefix}-filter="endDate"]`)?.value || '',
    };
}

export function periodQuery({ startDate, endDate }) {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return params.toString();
}

export function formatDateBR(value) {
    if (!value) return '—';
    const [year, month, day] = String(value).split('-');
    return `${day}/${month}/${year}`;
}


// ======================================================================
// COMPARISON
// ======================================================================

/** "▲ 4,2% vs. out/26" — `invert` paints a rise red (taxes going up). */
export function comparisonHtml(current, previous, label, { invert = false } = {}) {
    const now = Number(current || 0);
    const before = Number(previous || 0);

    if (!label) return '';
    if (before === 0) {
        return now === 0
            ? `<span class="tax-kpi-delta is-flat">= vs. ${escapeHtml(label)}</span>`
            : `<span class="tax-kpi-delta is-flat">sem movimento em ${escapeHtml(label)}</span>`;
    }

    const delta = ((now - before) / Math.abs(before)) * 100;
    const rounded = Math.abs(delta) < 0.05 ? 0 : delta;
    const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '=';
    const good = invert ? rounded < 0 : rounded > 0;
    const tone = rounded === 0 ? 'is-flat' : good ? 'is-good' : 'is-bad';

    return `<span class="tax-kpi-delta ${tone}" title="${escapeHtml(label)}: ${moneyOrText(previous)}">` +
        `${arrow} ${formatNumber(Math.abs(rounded), 1)}% vs. ${escapeHtml(label)}</span>`;
}

function moneyOrText(value) {
    return moneyBR(Number(value || 0));
}

export function setKpiHint(card, selector, html) {
    const element = card.querySelector(selector);
    if (!element) return;
    element.innerHTML = html || '';
    element.hidden = !html;
}


// ======================================================================
// DONUT
// ======================================================================

/**
 * items: [{ label, value, color }]
 */
export function donutSvg(items, { centerLabel = 'Total', centerValue = '', size = 200 } = {}) {
    const visible = items.filter((item) => Number(item.value) > 0);
    const total = visible.reduce((sum, item) => sum + Number(item.value), 0);

    if (!total) return '';

    const center = size / 2;
    const outer = size / 2 - 6;
    const inner = outer * 0.62;
    let angle = -Math.PI / 2;

    const point = (radius, theta) => [center + radius * Math.cos(theta), center + radius * Math.sin(theta)];

    const slices = visible.map((item) => {
        const share = Number(item.value) / total;
        const title = `<title>${escapeHtml(item.label)} — ${moneyBR(item.value)} — ${formatNumber(share * 100, 1)}%</title>`;

        if (share >= 0.9999) {
            return `
              <g>${title}
                <circle cx="${center}" cy="${center}" r="${(outer + inner) / 2}" fill="none"
                  stroke="${item.color}" stroke-width="${outer - inner}"></circle>
              </g>`;
        }

        const sweep = share * Math.PI * 2;
        const end = angle + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const [x1, y1] = point(outer, angle);
        const [x2, y2] = point(outer, end);
        const [x3, y3] = point(inner, end);
        const [x4, y4] = point(inner, angle);

        angle = end;

        return `
          <path d="M${x1.toFixed(2)} ${y1.toFixed(2)} A${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}
                   L${x3.toFixed(2)} ${y3.toFixed(2)} A${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z"
            fill="${item.color}" stroke="#ffffff" stroke-width="2">${title}</path>`;
    }).join('');

    return `
      <svg class="tax-donut__svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(centerLabel)} ${escapeHtml(centerValue)}">
        ${slices}
        <text x="${center}" y="${center - 7}" text-anchor="middle" class="tax-donut__center-label">${escapeHtml(centerLabel)}</text>
        <text x="${center}" y="${center + 12}" text-anchor="middle" class="tax-donut__center-value">${escapeHtml(centerValue)}</text>
      </svg>`;
}

export function legendHtml(items, { showShare = true } = {}) {
    const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);

    return `
      <ul class="tax-legend">
        ${items.map((item) => {
        const share = total > 0 ? (Number(item.value || 0) / total) * 100 : 0;
        return `
            <li title="${escapeHtml(item.label)}">
              <i style="background:${item.color}"></i>
              <span class="tax-legend__name">${escapeHtml(item.label)}</span>
              <strong>${moneyBR(item.value)}${showShare ? ` · ${formatNumber(share, 1)}%` : ''}</strong>
            </li>`;
    }).join('')}
      </ul>`;
}


// ======================================================================
// MONTHLY COLUMNS
// ======================================================================

/**
 * months: [{ label, partial, title }]
 * series: [{ label, color, values: number[] }]
 * mode: 'stacked' | 'grouped'
 * line:  { label, color, values: number[], format(v) } (own scale, optional)
 */
export function monthlyColumnsSvg({ months, series, mode = 'stacked', line = null, height = 210, format = null }) {
    // format: opcional, para valores que não são dinheiro (ex.: contagem de produtos)
    const fmtValue = format || moneyBR;
    const fmtTotal = format || shortMoney;
    const width = 420;
    const top = 18;
    const bottom = 24;
    const left = 8;
    const right = 8;
    const plotHeight = height - top - bottom;
    const slot = (width - left - right) / Math.max(1, months.length);

    const totals = months.map((_, index) => (mode === 'stacked'
        ? series.reduce((sum, item) => sum + Number(item.values[index] || 0), 0)
        : Math.max(0, ...series.map((item) => Number(item.values[index] || 0)))));
    const max = Math.max(1, ...totals);
    const barGroup = Math.min(54, slot * 0.62);

    const columns = months.map((month, index) => {
        const x = left + slot * index + (slot - barGroup) / 2;
        let bars = '';

        if (mode === 'stacked') {
            let y = top + plotHeight;
            series.forEach((item) => {
                const value = Number(item.values[index] || 0);
                const h = (value / max) * plotHeight;
                if (h <= 0) return;
                y -= h;
                bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barGroup.toFixed(1)}" height="${h.toFixed(1)}" fill="${item.color}"${month.partial ? ' fill-opacity="0.75"' : ''}>
                  <title>${escapeHtml(month.title || month.label)} — ${escapeHtml(item.label)}: ${escapeHtml(fmtValue(value))}</title></rect>`;
            });
        } else {
            const each = barGroup / series.length;
            series.forEach((item, seriesIndex) => {
                const value = Number(item.values[index] || 0);
                const h = Math.max(value > 0 ? 1.5 : 0, (value / max) * plotHeight);
                bars += `<rect x="${(x + seriesIndex * each).toFixed(1)}" y="${(top + plotHeight - h).toFixed(1)}" width="${(each - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${item.color}"${month.partial ? ' fill-opacity="0.75"' : ''}>
                  <title>${escapeHtml(month.title || month.label)} — ${escapeHtml(item.label)}: ${escapeHtml(fmtValue(value))}</title></rect>`;
            });
        }

        const total = totals[index];
        const labelY = top + plotHeight - (total / max) * plotHeight - 4;
        const totalLabel = mode === 'stacked' && total > 0
            ? `<text x="${(x + barGroup / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="tax-columns__total">${escapeHtml(fmtTotal(total))}</text>`
            : '';

        return `
          <g>
            ${bars}
            ${totalLabel}
            <text x="${(x + barGroup / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="tax-columns__month">${escapeHtml(month.label)}${month.partial ? '*' : ''}</text>
          </g>`;
    }).join('');

    let lineSvg = '';
    if (line && line.values.some((value) => Number(value) > 0)) {
        const values = line.values.map((value) => Number(value || 0));
        const lineMax = Math.max(...values) * 1.15 || 1;
        const lineMin = Math.max(0, Math.min(...values) * 0.7);
        const points = values.map((value, index) => {
            const x = left + slot * index + slot / 2;
            const y = top + plotHeight - ((value - lineMin) / (lineMax - lineMin || 1)) * plotHeight;
            return [x, y];
        });

        lineSvg = `
          <polyline points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${line.color}" stroke-width="2.5" stroke-linejoin="round"></polyline>
          ${points.map(([x, y], index) => `
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#ffffff" stroke="${line.color}" stroke-width="2">
              <title>${escapeHtml(months[index].title || months[index].label)} — ${escapeHtml(line.label)}: ${escapeHtml(line.format(values[index]))}</title>
            </circle>`).join('')}`;
    }

    return `
      <svg class="tax-columns__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <line x1="${left}" x2="${width - right}" y1="${top + plotHeight}" y2="${top + plotHeight}" stroke="#e2e8f0"></line>
        ${columns}
        ${lineSvg}
      </svg>`;
}

export function monthTitle(month) {
    return month.partial
        ? `${month.label} (até ${formatDateBR(month.endDate)})`
        : month.label;
}


// ======================================================================
// EXPORT
// ======================================================================

export async function downloadFile(url, button, fallbackName) {
    const label = button.textContent;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    button.disabled = true;
    button.textContent = 'Gerando...';

    try {
        const response = await fetch(url, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.message || `HTTP ${response.status}`);
        }

        const disposition = response.headers.get('Content-Disposition') || '';
        const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');

        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}


// ======================================================================
// FORMAT
// ======================================================================

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export function formatNumber(value, digits = 2) {
    return Number(value || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

export function formatPercentage(value, digits = 2) {
    return `${formatNumber(value, digits)}%`;
}

export function formatInteger(value) {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function formatPlain(value) {
    return formatNumber(value, 2);
}

/** 1.234 → "1,2 mil" for chart labels. */
export function shortMoney(value) {
    const number = Number(value || 0);
    if (Math.abs(number) >= 1_000_000) return `${formatNumber(number / 1_000_000, 1)} mi`;
    if (Math.abs(number) >= 10_000) return `${formatNumber(number / 1000, 0)} mil`;
    if (Math.abs(number) >= 1000) return `${formatNumber(number / 1000, 1)} mil`;
    return formatNumber(number, 0);
}

export function truncateText(value, maxLength = 30) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
