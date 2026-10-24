// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ employees.view.js — Modal do colaborador + abas internas (CONSART ERP | ESM) ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { qsa } from './employees.utils.js';
import { el } from './employees.dom.js';
import { state } from './employees.state.js';

export const EMPLOYEE_MODAL_ID = 'employeeModal';

function currentEmployeeId() {
  return Number(el.employee_id?.value || state.selectedId || 0) || null;
}

export function setModalTab(tab /* 'dados' | 'mais' | 'docs' */) {
  // documentos só existem para colaborador já salvo
  const t = (tab === 'docs' && !currentEmployeeId()) ? 'dados' : tab;

  qsa('.emp-modal-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.empTab === t));
  qsa('.emp-pane').forEach((p) => p.classList.toggle('is-active', p.dataset.empPane === t));
}

// título + aba Documentos conforme o colaborador carregado no form
export function refreshModalHeader() {
  const id = currentEmployeeId();

  el.employeeModalTitle.textContent = id ? `Colaborador #${id}` : 'Novo colaborador';
  el.tabEmployeeDocs.disabled = !id;
  el.tabEmployeeDocs.title = id ? '' : 'Salve o colaborador para anexar documentos';

  if (!id && el.tabEmployeeDocs.classList.contains('is-active')) setModalTab('dados');
}

export function openEmployeeModal(tab = 'dados') {
  refreshModalHeader();
  setModalTab(tab);
  Modal.open(EMPLOYEE_MODAL_ID, { focusSelector: tab === 'docs' ? '#document_type' : '#full_name' });
}

export function closeEmployeeModal() {
  Modal.close(EMPLOYEE_MODAL_ID);
}
