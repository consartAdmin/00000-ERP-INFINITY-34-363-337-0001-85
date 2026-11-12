// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ employees.reports.js — Modal de relatórios (PDF / Excel) | CONSART ERP | ESM ║
// ║ GET /api/employees/reports?type=list|payroll|trial&format=pdf|xlsx           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { el } from './employees.dom.js';
import { fetchJSON, API_EMP } from './employees.api.js';

const REPORTS_MODAL_ID = 'reportsModal';

async function loadDepartments() {
  const data = await fetchJSON(`${API_EMP}/departments`, { headers: authHeaders() });
  const current = el.report_department.value;

  el.report_department.innerHTML = '<option value="">Todos</option>';
  (data?.departments || []).forEach((name) => el.report_department.add(new Option(name, name)));
  el.report_department.value = current;
}

function authHeaders() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function openReportsModal() {
  Modal.open(REPORTS_MODAL_ID);
  await loadDepartments();
}

export async function generateReport() {
  const params = new URLSearchParams({
    type: el.reportsForm.querySelector('input[name="report_type"]:checked')?.value || 'list',
    format: el.report_format.value,
    active: el.report_status.value,
    department: el.report_department.value,
  });

  const button = el.btnGenerateReport;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Gerando...';

  try {
    const res = await fetch(`${API_EMP}/reports?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: authHeaders(),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `HTTP ${res.status}`);
    }

    const disposition = res.headers.get('Content-Disposition') || '';
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `colaboradores.${params.get('format')}`;
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    Modal.close(REPORTS_MODAL_ID);
  } catch (error) {
    console.error('[employees] generateReport', error);
    showCenterModal({ variant: 'error', title: 'Erro', message: `Não foi possível gerar o relatório. ${error.message}` });
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
