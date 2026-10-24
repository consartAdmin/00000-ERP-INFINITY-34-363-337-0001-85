// ╔══════════════════════════════════════════════════════════════════════╗
// ║ debts.types.js — Tipos de dívida (cadastro em public."debtsTypes")  ║
// ║ CONSART ERP | ESM                                                   ║
// ║ - Preenche o filtro "Tipo" e o "Tipo" do modal Nova/Editar Dívida  ║
// ║ - Ícone ＋ no rótulo do Tipo → #debtTypeQuickModal (cadastro rápido)║
// ║ - A dívida guarda o código (ex.: ALUGUEL); a tabela mostra o nome   ║
// ║ API: GET/POST /api/debts-types                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { API_BASE, fetchJSON } from './debts.api.js';
import { escapeHtml } from './debts.utils.js';

const QUICK_MODAL_ID = 'debtTypeQuickModal';
let types = [];

function authHeaders() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

/** Nome do tipo para exibir (ex.: EMPRESTIMO → Empréstimo). */
export function getDebtTypeName(code) {
  if (!code) return '';
  return types.find((t) => t.code === code)?.name || code;
}

/** Garante a option no select (tipo inativo ou antigo de uma dívida em edição). */
export function setDebtTypeValue(select, code) {
  if (!select) return;
  if (code && ![...select.options].some((o) => o.value === code)) {
    select.add(new Option(getDebtTypeName(code), code));
  }
  select.value = code ?? '';
}

function fillSelect(select, firstLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${firstLabel}</option>` +
    types.filter((t) => t.active)
      .map((t) => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)}</option>`)
      .join('');
  setDebtTypeValue(select, current);
}

export async function loadDebtTypes() {
  const { data } = await fetchJSON(`${API_BASE}/debts-types`, { headers: authHeaders() });
  types = Array.isArray(data) ? data : [];

  fillSelect(document.getElementById('debt_type'), 'Todos');
  fillSelect(document.getElementById('debt_type_form'), 'Selecione');
}

// ─────────────────────────────────────────────────────────────
// Cadastro rápido (＋)
// ─────────────────────────────────────────────────────────────
function injectQuickModal() {
  if (document.getElementById(QUICK_MODAL_ID)) return;

  document.body.insertAdjacentHTML('beforeend', `
<div id="${QUICK_MODAL_ID}" class="modal debt-modal" aria-hidden="true">
  <div class="modal__backdrop" data-modal-close></div>

  <div class="modal__dialog">
    <section class="modal__panel modal-width-2" role="dialog" aria-modal="true" aria-labelledby="debtTypeQuickTitle">

      <div class="modal__header modal-header-color-3">
        <h2 id="debtTypeQuickTitle" class="modal__title">Novo tipo</h2>
        <button class="modal__close" type="button" data-modal-close aria-label="Fechar" title="Fechar">&times;</button>
      </div>

      <div class="modal__body">
        <form id="debtTypeQuickForm" class="debt-section" autocomplete="off" novalidate>
          <div class="fields fields-h-6 fields-font-3">
            <label for="debtTypeQuickName">Nome *</label>
            <input type="text" id="debtTypeQuickName" maxlength="100" placeholder="Ex.: Manutenção" required />
          </div>
        </form>
      </div>

      <div class="modal__footer">
        <button class="btn btn-sm" type="button" data-modal-close>Cancelar</button>
        <button class="btn btn-sm btn-new" type="submit" form="debtTypeQuickForm">💾 Salvar</button>
      </div>

    </section>
  </div>
</div>
`);
}

function openQuick() {
  document.getElementById('debtTypeQuickName').value = '';
  Modal.open(QUICK_MODAL_ID, { focusSelector: '#debtTypeQuickName' });
}

async function saveQuick(event) {
  event.preventDefault();
  const name = document.getElementById('debtTypeQuickName').value.trim();

  if (!name) {
    showCenterModal({ variant: 'warning', title: 'Atenção', message: 'Informe o nome do tipo.' });
    return;
  }

  try {
    const { data } = await fetchJSON(`${API_BASE}/debts-types`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });

    await loadDebtTypes();
    setDebtTypeValue(document.getElementById('debt_type_form'), data?.code);
    Modal.close(QUICK_MODAL_ID);
  } catch (error) {
    showCenterModal({ variant: 'error', title: 'Erro', message: error?.message || String(error) });
  }
}

export async function initDebtTypes() {
  injectQuickModal();

  const slot = document.querySelector('[data-debt-type-actions]');
  if (slot) {
    slot.innerHTML = actionIconsHtml([
      { action: 'add', title: 'Cadastrar tipo', attrs: { 'data-debt-type-add': '' } },
    ]);
  }

  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-debt-type-add]')) openQuick();
  });
  document.getElementById('debtTypeQuickForm').addEventListener('submit', saveQuick);

  await loadDebtTypes();
}
