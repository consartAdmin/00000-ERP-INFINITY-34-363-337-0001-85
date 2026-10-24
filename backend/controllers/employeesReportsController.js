// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesReportsController.js — Relatórios de colaboradores (PDF/XLSX)║
// ║ GET /api/employees/reports?type=list|payroll|trial&format=pdf|xlsx  ║
// ║     &active=true|false|(vazio=todos)&department=...                 ║
// ║ GET /api/employees/departments                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import ExcelJS from 'exceljs';

import { loadEmployeesReport, listDepartments } from '../repositories/employees/employeesReports.repository.js';
import { generateEmployeesReportPdf, formatCell } from '../generationPdf/generateEmployeesReportPdf.js';

function readActive(value) {
  if (value === undefined || value === null || value === '') return null;
  return ['true', '1', 't', 'yes', 'y', 'sim'].includes(String(value).toLowerCase());
}

function fileName(report, extension) {
  const today = new Date().toISOString().slice(0, 10);
  return `${report.file}-${today}.${extension}`;
}

async function buildXlsx(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CONSART ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  sheet.columns = report.columns.map((col) => ({
    header: col.label,
    key: col.key,
    width: Math.max(10, Math.round(col.width / 5)),
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  report.rows.forEach((row) => {
    // dinheiro e inteiros ficam numéricos no Excel; datas/textos como texto formatado
    sheet.addRow(Object.fromEntries(report.columns.map((col) => [
      col.key,
      col.type === 'money' || col.type === 'int' ? Number(row[col.key] || 0) : formatCell(col, row[col.key]),
    ])));
  });

  report.columns.forEach((col) => {
    if (col.type === 'money') sheet.getColumn(col.key).numFmt = '#,##0.00';
  });

  if (report.totals && report.rows.length) {
    const first = report.columns[0].key;
    const totalRow = sheet.addRow({ ...report.totals, [first]: 'Total' });
    totalRow.font = { bold: true };
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook.xlsx.writeBuffer();
}

const FORMATS = Object.freeze({
  pdf: {
    build: generateEmployeesReportPdf,
    contentType: 'application/pdf',
  },
  xlsx: {
    build: buildXlsx,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
});

export async function exportEmployeesReport(req, res) {
  const formatKey = String(req.query.format || 'pdf').toLowerCase();
  const format = FORMATS[formatKey];

  if (!format) {
    return res.status(400).json({ ok: false, error: 'INVALID_FORMAT', message: 'Formato inválido. Use pdf ou xlsx.' });
  }

  try {
    const report = await loadEmployeesReport({
      type: String(req.query.type || 'list'),
      active: readActive(req.query.active),
      department: String(req.query.department || '').trim(),
    });

    const buffer = await format.build(report);

    res.setHeader('Content-Type', format.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(report, formatKey)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('[employeesReportsController] exportEmployeesReport', error);
    return res.status(Number(error?.status) || 500).json({
      ok: false,
      error: 'EMPLOYEES_REPORT_ERROR',
      message: error?.status ? error.message : 'Não foi possível gerar o relatório.',
    });
  }
}

export async function listEmployeeDepartments(req, res) {
  try {
    return res.json({ ok: true, departments: await listDepartments() });
  } catch (error) {
    console.error('[employeesReportsController] listEmployeeDepartments', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL', message: error.message });
  }
}
