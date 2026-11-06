// ╔══════════════════════════════════════════════════════════════════════╗
// ║ taxHistory.repository.js — Evolução mensal de impostos e apuração   ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Impostos sobre vendas mês a mês (slide Impostos)                 ║
// ║ ✅ Débito, crédito e a recolher mês a mês (slide Apuração)          ║
// ║                                                                      ║
// ║ Reaproveita loadSalesTaxes / loadTaxAssessment, um mês por vez; o   ║
// ║ último mês vai só até a data final pedida (mês em andamento).       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { loadSalesTaxes } from '../salesTaxes/salesTaxes.repository.js';
import { loadTaxAssessment } from '../taxAssessment/taxAssessment.repository.js';
import { normalizeDate } from '../salesAnalytics/salesAnalytics.sanitizers.js';


const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 12;

// Each month runs several queries; two at a time keeps the pool free.
const CONCURRENCY = 2;

const MONTH_LABELS = Object.freeze([
    'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
]);


function pad(value) {
    return String(value).padStart(2, '0');
}


function todaySaoPaulo() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}


/**
 * Calendar months ending in the month of `endDate`.
 * The last one stops at `endDate` itself (month in progress).
 */
export function buildMonthRanges({ endDate = '', months = DEFAULT_MONTHS } = {}) {
    const end = normalizeDate(endDate) || todaySaoPaulo();
    const count = Math.min(MAX_MONTHS, Math.max(1, Number.parseInt(months, 10) || DEFAULT_MONTHS));
    const [endYear, endMonth, endDay] = end.split('-').map(Number);
    const ranges = [];

    for (let offset = count - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(endYear, endMonth - 1 - offset, 1));
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const isLast = offset === 0;
        const day = isLast ? Math.min(endDay, lastDay) : lastDay;

        ranges.push({
            month: `${year}-${pad(month)}`,
            label: `${MONTH_LABELS[month - 1]}/${String(year).slice(2)}`,
            startDate: `${year}-${pad(month)}-01`,
            endDate: `${year}-${pad(month)}-${pad(day)}`,
            partial: isLast && day < lastDay,
        });
    }

    return ranges;
}


async function mapLimited(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;

    const worker = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await task(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}


function round2(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}


// ======================================================================
// IMPOSTOS SOBRE VENDAS
// ======================================================================

export async function loadSalesTaxesHistory({ endDate = '', months = DEFAULT_MONTHS } = {}) {
    const ranges = buildMonthRanges({ endDate, months });

    const data = await mapLimited(ranges, CONCURRENCY, async (range) => {
        const sales = await loadSalesTaxes({ startDate: range.startDate, endDate: range.endDate });
        const summary = sales.summary || {};

        return {
            ...range,
            revenue: round2(summary.totalRevenue),
            totalTaxes: round2(summary.totalTaxes),
            effectiveRate: round2(summary.effectiveRate),
            netAfterTaxes: round2(summary.netAfterTaxes),
            byTax: (sales.byTax || [])
                .filter((tax) => !tax.informative && Number(tax.value) > 0)
                .map((tax) => ({ key: tax.key, label: tax.label, value: round2(tax.value) })),
        };
    });

    return { months: data };
}


// ======================================================================
// APURAÇÃO (DÉBITO × CRÉDITO)
// ======================================================================

export async function loadTaxAssessmentHistory({ endDate = '', months = DEFAULT_MONTHS } = {}) {
    const ranges = buildMonthRanges({ endDate, months });

    const data = await mapLimited(ranges, CONCURRENCY, async (range) => {
        const assessment = await loadTaxAssessment({ startDate: range.startDate, endDate: range.endDate });
        const summary = assessment.summary || {};

        return {
            ...range,
            debits: round2(summary.debits),
            credits: round2(summary.credits),
            toPay: round2(summary.toPay),
            creditBalance: round2(summary.creditBalance),
        };
    });

    return { months: data };
}
