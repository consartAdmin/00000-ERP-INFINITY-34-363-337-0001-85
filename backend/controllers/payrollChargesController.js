// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: payrollChargesController.js                                    ║
// ║ MODULE: Encargos e Rescisões (CONSART ERP)                           ║
// ║ BASE: /api/payroll-charges                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import ExcelJS from 'exceljs';
import * as repo from '../repositories/payrollCharges/payrollCharges.repository.js';
import * as payables from '../repositories/payrollCharges/payrollCharges.payables.js';
import * as chartAccounts from '../repositories/payrollCharges/payrollCharges.chartAccounts.js';
import { REGIMES } from '../repositories/payrollCharges/payrollCharges.calc.js';
import { generatePayrollMonthPdf, generateTerminationPdf } from '../generationPdf/generatePayrollChargesPdf.js';

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[payrollChargesController] ${tag} error:`, error);
  return res.status(status).json({ ok: false, error: error?.message || 'Erro inesperado.' });
}

export async function options(req, res) {
  try {
    const [settings, tables] = await Promise.all([repo.getSettings(), repo.listTaxTables()]);
    return res.json({ ok: true, data: { ...repo.options(), settings, tables } });
  } catch (error) {
    return fail(res, 'options', error);
  }
}

export async function saveSettings(req, res) {
  try {
    return res.json({ ok: true, data: await repo.saveSettings(req.body) });
  } catch (error) {
    return fail(res, 'saveSettings', error);
  }
}

export async function saveTaxTable(req, res) {
  try {
    return res.json({ ok: true, data: await repo.saveTaxTable(req.params.year, req.body) });
  } catch (error) {
    return fail(res, 'saveTaxTable', error);
  }
}

// ── Encargos do mês ─────────────────────────────────────────────────

export async function month(req, res) {
  try {
    return res.json({ ok: true, data: await repo.monthReport(req.query) });
  } catch (error) {
    return fail(res, 'month', error);
  }
}

export async function monthPdf(req, res) {
  try {
    const report = await repo.monthReport(req.query);
    const pdf = await generatePayrollMonthPdf({ ...report, regime_label: REGIMES[report.settings.regime] });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="encargos-${report.competence}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return fail(res, 'monthPdf', error);
  }
}

const EXCEL_COLUMNS = [
  { header: 'Colaborador', key: 'full_name', width: 34 },
  { header: 'Cargo', key: 'position', width: 24 },
  { header: 'Departamento', key: 'department', width: 18 },
  { header: 'Dias', key: 'days', width: 7 },
  { header: 'Salário', key: 'gross', width: 13 },
  { header: 'Dependentes', key: 'dependents', width: 12 },
  { header: 'INSS (desc.)', key: 'inss', width: 13 },
  { header: 'IRRF (desc.)', key: 'irrf', width: 13 },
  { header: 'Líquido', key: 'net', width: 13 },
  { header: 'FGTS', key: 'fgts', width: 12 },
  { header: 'INSS patronal', key: 'patronal', width: 14 },
  { header: 'RAT + Terceiros', key: 'rat_third', width: 15 },
  { header: 'Prov. 13º', key: 'prov_13', width: 12 },
  { header: 'Prov. Férias + 1/3', key: 'prov_vacation', width: 17 },
  { header: 'Encargos s/ provisões', key: 'prov_charges', width: 19 },
  { header: 'Benefícios', key: 'benefits', width: 12 },
  { header: 'Custo total', key: 'total_cost', width: 14 },
];

export async function monthExcel(req, res) {
  try {
    const report = await repo.monthReport(req.query);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Encargos ${report.competence}`);
    sheet.columns = EXCEL_COLUMNS;
    sheet.getRow(1).font = { bold: true };

    report.rows.forEach((row) => sheet.addRow(row));
    const totalRow = sheet.addRow({ ...report.totals, full_name: 'TOTAL', days: null });
    totalRow.font = { bold: true };

    EXCEL_COLUMNS.slice(4).forEach((col) => {
      if (col.key !== 'dependents') sheet.getColumn(col.key).numFmt = '#,##0.00';
    });

    sheet.addRow({});
    [
      ['Guia INSS (DCTFWeb)', report.guides.inss],
      ['Guia FGTS Digital', report.guides.fgts],
      ['DARF IRRF (0561)', report.guides.irrf],
      ['Folha líquida a pagar', report.guides.net_payroll],
      ['Custo total da folha', report.guides.total_cost],
    ].forEach(([label, value]) => {
      const row = sheet.addRow({ full_name: label, gross: value });
      row.getCell('gross').numFmt = '#,##0.00';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="encargos-${report.competence}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return fail(res, 'monthExcel', error);
  }
}

// ── Contas a Pagar ──────────────────────────────────────────────────

export async function payablesPreview(req, res) {
  try {
    const [data, catalog] = await Promise.all([
      payables.preview(req.query),
      payables.listCashCategories(),
    ]);
    return res.json({ ok: true, data: { ...data, ...catalog } });
  } catch (error) {
    return fail(res, 'payablesPreview', error);
  }
}

export async function payablesGenerate(req, res) {
  try {
    return res.status(201).json({ ok: true, data: await payables.generate(req.body, req.user) });
  } catch (error) {
    return fail(res, 'payablesGenerate', error);
  }
}

// ── Encargos × Plano de Contas ──────────────────────────────────────

export async function chartAccountsList(req, res) {
  try {
    return res.json({ ok: true, data: await chartAccounts.list() });
  } catch (error) {
    return fail(res, 'chartAccountsList', error);
  }
}

export async function chartAccountsSave(req, res) {
  try {
    return res.json({ ok: true, data: await chartAccounts.save(req.body) });
  } catch (error) {
    return fail(res, 'chartAccountsSave', error);
  }
}

// ── Rescisão ────────────────────────────────────────────────────────

export async function employees(req, res) {
  try {
    return res.json({ ok: true, data: await repo.listEmployees() });
  } catch (error) {
    return fail(res, 'employees', error);
  }
}

export async function simulate(req, res) {
  try {
    return res.json({ ok: true, data: await repo.simulateTermination(req.body) });
  } catch (error) {
    return fail(res, 'simulate', error);
  }
}

export async function simulatePdf(req, res) {
  try {
    const result = await repo.simulateTermination(req.body);
    const pdf = await generateTerminationPdf(result);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="rescisao-simulacao.pdf"');
    return res.send(pdf);
  } catch (error) {
    return fail(res, 'simulatePdf', error);
  }
}

export async function listTerminations(req, res) {
  try {
    return res.json({ ok: true, data: await repo.listTerminations(req.query) });
  } catch (error) {
    return fail(res, 'listTerminations', error);
  }
}

export async function getTermination(req, res) {
  try {
    return res.json({ ok: true, data: await repo.getTermination(req.params.id) });
  } catch (error) {
    return fail(res, 'getTermination', error);
  }
}

export async function saveTermination(req, res) {
  try {
    return res.status(201).json({ ok: true, data: await repo.saveTermination(req.body, req.user) });
  } catch (error) {
    return fail(res, 'saveTermination', error);
  }
}

export async function confirmTermination(req, res) {
  try {
    return res.json({ ok: true, data: await repo.confirmTermination(req.params.id) });
  } catch (error) {
    return fail(res, 'confirmTermination', error);
  }
}

export async function removeTermination(req, res) {
  try {
    return res.json({ ok: true, data: await repo.removeTermination(req.params.id) });
  } catch (error) {
    return fail(res, 'removeTermination', error);
  }
}

export async function terminationPdf(req, res) {
  try {
    const termination = await repo.getTermination(req.params.id);
    const pdf = await generateTerminationPdf(termination.result, termination);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rescisao-${termination.id}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return fail(res, 'terminationPdf', error);
  }
}
