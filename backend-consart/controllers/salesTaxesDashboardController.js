// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesTaxesDashboardController.js — Sales Taxes Dashboard Controller ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { loadSalesTaxes } from '../repositories/salesTaxes/salesTaxes.repository.js';
import {
    buildSalesTaxesXlsx,
    buildSalesTaxesPdf,
    salesTaxesFileName,
} from '../repositories/salesTaxes/salesTaxes.export.js';
import { loadSalesTaxesHistory } from '../repositories/taxHistory/taxHistory.repository.js';


const EXPORT_FORMATS = Object.freeze({
    xlsx: {
        extension: 'xlsx',
        build: buildSalesTaxesXlsx,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    pdf: {
        extension: 'pdf',
        build: buildSalesTaxesPdf,
        contentType: 'application/pdf',
    },
});


function readPeriod(req) {
    return {
        startDate: String(req.query?.startDate || '').trim(),
        endDate: String(req.query?.endDate || '').trim(),
    };
}


function sendError(res, error, code, message) {
    return res.status(Number(error?.status) || 500).json({
        ok: false,
        code: error?.code || code,
        message: error?.message || message,
    });
}


export async function getSalesTaxesDashboard(req, res) {
    try {
        const data = await loadSalesTaxes(readPeriod(req));

        // regimeContext is internal (used by the apuração slide).
        const { regimeContext, ...response } = data;

        return res.json({
            ok: true,
            ...response,
        });
    } catch (error) {
        console.error('[salesTaxesDashboardController] getSalesTaxesDashboard:', error);
        return sendError(res, error, 'SALES_TAXES_ERROR', 'Unable to load sales taxes dashboard.');
    }
}


// GET /api/dashboard/sales-taxes/history?endDate=YYYY-MM-DD&months=6
export async function getSalesTaxesHistory(req, res) {
    try {
        const data = await loadSalesTaxesHistory({
            endDate: String(req.query?.endDate || '').trim(),
            months: req.query?.months,
        });

        return res.json({ ok: true, ...data });
    } catch (error) {
        console.error('[salesTaxesDashboardController] getSalesTaxesHistory:', error);
        return sendError(res, error, 'SALES_TAXES_HISTORY_ERROR', 'Unable to load sales taxes history.');
    }
}


// GET /api/dashboard/sales-taxes/export?format=xlsx|pdf&startDate=...&endDate=...
export async function exportSalesTaxes(req, res) {
    const format = EXPORT_FORMATS[String(req.query?.format || '').toLowerCase()];

    if (!format) {
        return res.status(400).json({
            ok: false,
            code: 'INVALID_FORMAT',
            message: 'Formato inválido. Use xlsx ou pdf.',
        });
    }

    try {
        const data = await loadSalesTaxes(readPeriod(req));
        const buffer = await format.build(data);

        res.setHeader('Content-Type', format.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${salesTaxesFileName(data, format.extension)}"`);
        res.setHeader('Cache-Control', 'no-store');

        return res.send(buffer);
    } catch (error) {
        console.error('[salesTaxesDashboardController] exportSalesTaxes:', error);
        return sendError(res, error, 'SALES_TAXES_EXPORT_ERROR', 'Unable to export sales taxes.');
    }
}
