// ╔══════════════════════════════════════════════════════════════════════╗
// ║ dashboardPeriod.js — Período da página Financeiro da home           ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Seletor de período no cabeçalho do carrossel (página Financeiro)  ║
// ║ ✅ Atalhos: mês atual/anterior/próximo, 30 dias, trimestre, ano     ║
// ║ ✅ Avisa os cards (gráficos, totais do período, inadimplência)      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js';

const STORAGE_KEY = 'consart.dashboard.financialPeriod';
const EVENT_NAME = 'consart:financial-period-change';

export const FINANCIAL_PERIOD_PRESETS = Object.freeze([
    { value: 'current-month', label: 'Mês atual' },
    { value: 'previous-month', label: 'Mês anterior' },
    { value: 'next-month', label: 'Próximo mês' },
    { value: 'next-30', label: 'Próximos 30 dias' },
    { value: 'current-quarter', label: 'Trimestre atual' },
    { value: 'current-year', label: 'Ano atual' },
    { value: 'custom', label: 'Personalizado' },
]);


// ======================================================================
// DATES
// ======================================================================

function pad(value) {
    return String(value).padStart(2, '0');
}

function toIso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthRange(year, monthIndex) {
    return {
        startDate: toIso(new Date(year, monthIndex, 1)),
        endDate: toIso(new Date(year, monthIndex + 1, 0)),
    };
}

function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

/** Whole calendar periods: due dates later in the month still count. */
export function rangeForPreset(preset, today = new Date()) {
    const year = today.getFullYear();
    const month = today.getMonth();

    switch (preset) {
        case 'previous-month':
            return monthRange(year, month - 1);
        case 'next-month':
            return monthRange(year, month + 1);
        case 'next-30':
            return {
                startDate: toIso(today),
                endDate: toIso(new Date(year, month, today.getDate() + 29)),
            };
        case 'current-quarter': {
            const first = Math.floor(month / 3) * 3;
            return {
                startDate: toIso(new Date(year, first, 1)),
                endDate: toIso(new Date(year, first + 3, 0)),
            };
        }
        case 'current-year':
            return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
        default:
            return monthRange(year, month);
    }
}


// ======================================================================
// STATE
// ======================================================================

let current = null;

function readStored() {
    try {
        const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (!stored) return null;

        // Presets follow the calendar: "Mês atual" saved yesterday is still the current month.
        if (stored.preset && stored.preset !== 'custom') {
            return { preset: stored.preset, ...rangeForPreset(stored.preset) };
        }

        if (isIsoDate(stored.startDate) && isIsoDate(stored.endDate) && stored.startDate <= stored.endDate) {
            return { preset: 'custom', startDate: stored.startDate, endDate: stored.endDate };
        }
    } catch {
        // ignore broken storage
    }
    return null;
}

export function getFinancialPeriod() {
    if (!current) current = readStored() || { preset: 'current-month', ...rangeForPreset('current-month') };
    return { ...current };
}

export function setFinancialPeriod({ preset = 'custom', startDate, endDate }) {
    const range = preset === 'custom' ? { startDate, endDate } : rangeForPreset(preset);

    if (!isIsoDate(range.startDate) || !isIsoDate(range.endDate) || range.startDate > range.endDate) {
        throw new Error('Período inválido.');
    }

    current = { preset, ...range };

    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // storage full or blocked: the period still applies to this page
    }

    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...current } }));
    return { ...current };
}

export function onFinancialPeriodChange(callback, options = {}) {
    const handler = (event) => callback(event.detail);
    window.addEventListener(EVENT_NAME, handler, options);
    return () => window.removeEventListener(EVENT_NAME, handler);
}

export function financialPeriodQuery(period = getFinancialPeriod()) {
    return new URLSearchParams({ startDate: period.startDate, endDate: period.endDate }).toString();
}


// ======================================================================
// LABELS
// ======================================================================

export function formatDateBR(value) {
    const [year, month, day] = String(value || '').slice(0, 10).split('-');
    return day && month && year ? `${day}/${month}/${year}` : '—';
}

/** "Mês 11/2026" for a whole month, otherwise "01/10/2026 a 15/10/2026". */
export function financialPeriodLabel(period = getFinancialPeriod()) {
    const [startYear, startMonth, startDay] = period.startDate.split('-').map(Number);
    const whole = monthRange(startYear, startMonth - 1);

    if (startDay === 1 && period.endDate === whole.endDate) {
        return `Mês ${pad(startMonth)}/${startYear}`;
    }

    return `${formatDateBR(period.startDate)} a ${formatDateBR(period.endDate)}`;
}

/** True when the period is one whole calendar month. */
export function isWholeMonth(period = getFinancialPeriod()) {
    const [year, month, day] = period.startDate.split('-').map(Number);
    return day === 1 && period.endDate === monthRange(year, month - 1).endDate;
}


// ======================================================================
// PICKER (CABEÇALHO DO CARROSSEL)
// ======================================================================

export function renderFinancialPeriodPicker() {
    const period = getFinancialPeriod();

    return `
      <div class="dashboard-period" data-financial-period-picker role="group" aria-label="Período dos painéis financeiros">
        <select class="dashboard-period__preset" data-period-preset aria-label="Atalho de período">
          ${FINANCIAL_PERIOD_PRESETS.map((item) => `
            <option value="${item.value}"${item.value === period.preset ? ' selected' : ''}>${item.label}</option>
          `).join('')}
        </select>
        <input class="dashboard-period__date" type="date" id="dashboardPeriodStart" data-period-start value="${period.startDate}" aria-label="Data inicial" />
        <span class="dashboard-period__sep">até</span>
        <input class="dashboard-period__date" type="date" id="dashboardPeriodEnd" data-period-end value="${period.endDate}" aria-label="Data final" />
        <button type="button" class="dashboard-period__apply" data-period-apply>Aplicar</button>
      </div>
    `;
}

export function bindFinancialPeriodPicker(container, { signal, onError } = {}) {
    const picker = container?.querySelector('[data-financial-period-picker]');
    if (!picker) return;

    const preset = picker.querySelector('[data-period-preset]');
    const start = picker.querySelector('[data-period-start]');
    const end = picker.querySelector('[data-period-end]');
    const apply = picker.querySelector('[data-period-apply]');
    const options = signal ? { signal } : {};

    const sync = (period) => {
        preset.value = period.preset;
        start.value = period.startDate;
        end.value = period.endDate;
        apply.disabled = true;
    };

    const markDirty = () => {
        const period = getFinancialPeriod();
        apply.disabled = start.value === period.startDate && end.value === period.endDate;
    };

    preset.addEventListener('change', () => {
        if (preset.value === 'custom') {
            start.focus();
            return;
        }
        sync(setFinancialPeriod({ preset: preset.value }));
    }, options);

    // dd/mm/aaaa no lugar do formato do idioma do navegador.
    [start, end].forEach((input) => enhanceBrDateTime(input));

    // Typing (text field) or the calendar (native field) both bubble here.
    picker.addEventListener('input', (event) => {
        if (event.target === preset) return;
        preset.value = 'custom';
        markDirty();
    }, options);
    picker.addEventListener('change', (event) => {
        if (event.target === preset) return;
        markDirty();
    }, options);

    const submit = () => {
        if (!start.value || !end.value) {
            onError?.('Informe a data inicial e a data final.');
            return;
        }
        if (start.value > end.value) {
            onError?.('A data inicial não pode ser maior que a data final.');
            return;
        }
        sync(setFinancialPeriod({ preset: 'custom', startDate: start.value, endDate: end.value }));
    };

    apply.addEventListener('click', submit, options);
    picker.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('input')) submit();
    }, options);

    sync(getFinancialPeriod());
}
