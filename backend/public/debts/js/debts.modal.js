// ╔══════════════════════════════════════════════════════════════════════╗
// ║ debts.modal.js — Modais do Controle de Dívidas                     ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { openSuppliersModalSearch } from '/public/modalsSearch/suppliersModalSearch.js';
import { Modal } from '/public/includes/js/modal.js';

const DEBT_MODAL_ID = 'debtModal';
const PAYMENT_MODAL_ID = 'paymentModal';
let eventsBound = false;

function setModalVisibility(id, visible) {
  const modal = document.getElementById(id);
  if (!modal) return;

  if (visible) {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    document.body.classList.add('modal-open');
    return;
  }

  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');

  const hasOpenModal = document.querySelector('.modal.is-open:not([hidden])');
  if (!hasOpenModal) document.body.classList.remove('modal-open');
}

function syncDueDayMode() {
  const mode = document.getElementById('due_day_mode');
  const box = document.getElementById('due_day_manual_box');
  const input = document.getElementById('due_day');
  if (!mode || !box || !input) return;

  const manual = mode.value === 'MANUAL';
  box.hidden = !manual;
  input.required = manual;

  if (manual && input.value === '31') input.value = '';
  if (!manual) input.value = '31';
}

function injectCreateDebtModal() {
  if (document.getElementById(DEBT_MODAL_ID)) return;

  document.body.insertAdjacentHTML('beforeend', `
<div id="debtModal" class="modal debt-modal" aria-hidden="true">
  <div class="modal__backdrop" data-modal-close></div>

  <div class="modal__dialog">
    <section class="modal__panel modal-width-10" role="dialog" aria-modal="true" aria-labelledby="debtModalTitle">

      <!-- div (e não <header>): a barra de título global (topGradientBar) se ancora no 1º <header> da página -->
      <div class="modal__header modal-header-color-3">
        <div>
          <h2 id="debtModalTitle" class="modal__title">Nova Dívida</h2>
          <p class="debt-modal__subtitle">Cadastre ou edite uma dívida.</p>
        </div>
        <button class="modal__close" type="button" data-modal-close aria-label="Fechar" title="Fechar">&times;</button>
      </div>

      <div class="modal__body">
        <form id="debtForm" class="debt-form" autocomplete="off">
          <input type="hidden" id="debt_id" name="debt_id">

          <div class="debt-grid">

            <!-- Dívida -->
            <div class="debt-section">
              <div class="debt-section__title">📄 Dívida</div>
              <div class="debt-section__grid debt-section__grid--3">
                <div class="fields fields-h-6 fields-font-3">
                  <label for="code">Código</label>
                  <input id="code" name="code" maxlength="30">
                </div>

                <div class="fields fields-h-6 fields-font-3 debt-span-2">
                  <label for="debt_type_form">Tipo</label>
                  <select id="debt_type_form" name="debt_type" required>
                    <option value="">Selecione</option>
                    <option value="FORNECEDOR">Fornecedor</option>
                    <option value="IMPOSTO">Imposto</option>
                    <option value="ALUGUEL">Aluguel</option>
                    <option value="EMPRESTIMO">Empréstimo</option>
                    <option value="CARTAO">Cartão</option>
                    <option value="FOLHA">Folha</option>
                    <option value="SERVICOS">Serviços</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>

                <div class="fields fields-h-6 fields-font-3 debt-span-full">
                  <label for="description">Descrição *</label>
                  <input id="description" name="description" required maxlength="255">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="document_number">Documento</label>
                  <input id="document_number" name="document_number" maxlength="50">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="reference_number">Referência</label>
                  <input id="reference_number" name="reference_number" maxlength="50">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="issue_date">Emissão</label>
                  <input id="issue_date" name="issue_date" type="date">
                </div>
              </div>
            </div>

            <!-- Credor -->
            <div class="debt-section">
              <div class="debt-section__title">🏢 Credor</div>
              <div class="debt-section__grid">
                <div class="fields fields-h-6 fields-font-3 debt-span-full">
                  <label for="creditor_name_form">Credor / Fornecedor</label>
                  <input id="creditor_name_form" name="creditor_name" maxlength="200"
                    placeholder="Clique para pesquisar fornecedor..." readonly>
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="creditor_document">CPF/CNPJ</label>
                  <input id="creditor_document" name="creditor_document" maxlength="20">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="company_name">Empresa</label>
                  <input id="company_name" name="company_name" maxlength="150">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="category">Categoria</label>
                  <input id="category" name="category" maxlength="100">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="cost_center">Centro de Custo</label>
                  <input id="cost_center" name="cost_center" maxlength="100">
                </div>
              </div>
            </div>

            <!-- Valores -->
            <div class="debt-section">
              <div class="debt-section__title">💰 Valores</div>
              <div class="debt-section__grid">
                <div class="fields fields-h-6 fields-font-3">
                  <label for="original_amount">Valor Original *</label>
                  <input id="original_amount" name="original_amount" inputmode="decimal" required placeholder="0,00">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="interest_amount">Juros</label>
                  <input id="interest_amount" name="interest_amount" inputmode="decimal" placeholder="0,00">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="fine_amount">Multa</label>
                  <input id="fine_amount" name="fine_amount" inputmode="decimal" placeholder="0,00">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="discount_amount">Desconto</label>
                  <input id="discount_amount" name="discount_amount" inputmode="decimal" placeholder="0,00">
                </div>

                <div class="fields fields-h-6 fields-font-3 debt-span-full">
                  <label for="updated_amount_preview">Valor Atualizado</label>
                  <input id="updated_amount_preview" class="debt-total" readonly>
                </div>
              </div>
            </div>

            <!-- Parcelamento -->
            <div class="debt-section">
              <div class="debt-section__title">📅 Parcelamento</div>
              <div class="debt-section__grid">
                <div class="fields fields-h-6 fields-font-3">
                  <label for="agreement_closed_at">Fechamento do Acordo</label>
                  <input id="agreement_closed_at" name="agreement_closed_at" type="date">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="first_installment_due_at">Venc. 1ª Parcela</label>
                  <input id="first_installment_due_at" name="first_installment_due_at" type="date">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="installment_total">Qtde. Parcelas *</label>
                  <input id="installment_total" name="installment_total" type="number" min="1" max="360" value="1" required>
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="due_day_mode">Tipo de Vencimento *</label>
                  <select id="due_day_mode" name="due_day_mode">
                    <option value="LAST_DAY">Último dia do mês</option>
                    <option value="MANUAL">Preencher manualmente</option>
                  </select>
                </div>

                <div class="fields fields-h-6 fields-font-3" id="due_day_manual_box" hidden>
                  <label for="due_day">Dia de Vencimento *</label>
                  <input id="due_day" name="due_day" type="number" min="1" max="31" placeholder="Ex: 15">
                </div>
              </div>
            </div>

            <!-- Faixas de Parcelas -->
            <div class="debt-section debt-section--wide">
              <div class="debt-section__title">📊 Faixas de Parcelas</div>
              <div class="debt-plan-inputs">
                <div class="fields fields-h-6 fields-font-3">
                  <label for="plan_start_installment">Parcela Inicial</label>
                  <input id="plan_start_installment" type="number" min="1" placeholder="Ex: 1">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="plan_end_installment">Parcela Final</label>
                  <input id="plan_end_installment" type="number" min="1" placeholder="Ex: 12">
                </div>

                <div class="fields fields-h-6 fields-font-3">
                  <label for="plan_installment_amount">Valor da Parcela</label>
                  <input id="plan_installment_amount" inputmode="decimal" placeholder="0,00">
                </div>

                <button id="btnAddInstallmentPlan" class="btn btn-new btn-sm" type="button">+ Adicionar Faixa</button>
              </div>

              <div class="table-scroll table-scroll--rounded debt-plan-table">
                <table class="table table-zebra table-zebra-hover table-sticky-head">
                  <thead>
                    <tr>
                      <th>Inicial</th>
                      <th>Final</th>
                      <th>Valor</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody id="installmentPlansTableBody">
                    <tr>
                      <td colspan="4" class="empty-row">Nenhuma faixa adicionada.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Observações -->
            <div class="debt-section debt-section--full">
              <div class="debt-section__title">📝 Observações</div>
              <div class="fields fields-font-3 debt-section__fill">
                <label for="notes" class="sr-only">Observações</label>
                <textarea id="notes" name="notes" rows="2" maxlength="5000"
                  placeholder="Anotações sobre a dívida, acordo, contato..."></textarea>
              </div>
            </div>

          </div>
        </form>
      </div>

      <div class="modal__footer">
        <button class="btn btn-cancel btn-sm" type="button" data-modal-close>Cancelar</button>
        <button class="btn btn-save btn-sm" type="submit" form="debtForm">💾 Salvar Dívida</button>
      </div>
    </section>
  </div>
</div>
`);
}

function injectPaymentModal() {
  if (document.getElementById(PAYMENT_MODAL_ID)) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="paymentModal" class="modal modal-width-9 modal-height-8" hidden aria-hidden="true">
      <div class="modal__backdrop" data-close-modal="paymentModal"></div>

      <div class="modal__dialog">
      <section class="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formTitle">

        <header class="modal__header modal-header-color-3">
          <div>
            <h2 id="paymentModalTitle" class="modal__title">
             Pagamentos
            </h2>
            <p id="paymentModalSubtitle" class="modal__subtitle">
              Histórico e parcelas da dívida.
            </p>
          </div>

          <div class="btn-inline">
            <button
              type="button"
              class="btn btn-clean btn-sm"
              data-close-modal="paymentModal"
              aria-label="Fechar">
              ×
            </button>
          </div>
        </header>

        <form
        id="paymentForm"
        class="modal__body payment-modal__form">
        
          <input type="hidden" id="payment_debt_id" name="payment_debt_id">

          <div class="fields-inline fields-gap-3">
            <div class="fields fields-h-5 fields-w-20 fields-font-3">
             <label for="payment_installment">Parcela *</label>
             <select id="payment_installment" name="payment_installment" required><option value="">Selecione a parcela</option></select>
           </div>

            <div class="fields fields-h-5 fields-w-10 fields-font-3">
              <label for="payment_date">Data *</label>
              <input id="payment_date" name="payment_date" type="date" required>
            </div>

            <div class="fields fields-h-5 fields-w-10 fields-font-3">
              <label for="payment_amount">Valor Pago *</label><input id="payment_amount" name="payment_amount" inputmode="decimal" required placeholder="0,00">
            </div>
            
            <div class="fields fields-h-5 fields-w-10 fields-font-3">
              <label for="payment_interest">Juros</label><input id="payment_interest" name="payment_interest" inputmode="decimal" placeholder="0,00">
             </div>
            
            <div class="fields fields-h-5 fields-w-10 fields-font-3">
              <label for="payment_fine">Multa</label><input id="payment_fine" name="payment_fine" inputmode="decimal" placeholder="0,00">
            </div>
          </div>

          <div class="fields-inline fields-gap-3">
            <div class="fields fields-h-5 fields-w-10 fields-font-3">
            <label for="payment_discount">Desconto</label><input id="payment_discount" name="payment_discount" inputmode="decimal" placeholder="0,00">
            </div>

            <div class="fields fields-h-5 fields-w-10 fields-font-3">
            <label for="payment_method">
            Forma de Pagamento
            </label>
            <input id="payment_method" name="payment_method" maxlength="80">
            </div>

            <div class="fields fields-h-5 fields-w-10 fields-font-3">
            <label for="receipt_number">
            Nº do Comprovante
            </label><input id="receipt_number" name="receipt_number" maxlength="100" placeholder="Número ou identificação">
            </div>

            <div class="fields fields-h-5 fields-w-10 fields-font-3">
            <label for="payment_notes">Observações</label><input id="payment_notes" name="payment_notes" maxlength="500">
            </div>

          </div>

          <!-- Saída no caixa (Movimentações): criada junto com o pagamento -->
          <div class="fields-inline fields-gap-3 payment-cash-row">
            <div class="fields fields-h-5 fields-w-12 fields-font-3">
              <label for="payment_cash_account">Conta (caixa)</label>
              <select id="payment_cash_account" name="payment_cash_account"><option value="">Selecione...</option></select>
            </div>

            <div class="fields fields-h-5 fields-w-12 fields-font-3">
              <label for="payment_cash_category">Categoria</label>
              <select id="payment_cash_category" name="payment_cash_category"><option value="">Selecione...</option></select>
            </div>

            <div class="fields fields-h-5 fields-w-12 fields-font-3">
              <label for="payment_cash_subcategory">Subcategoria</label>
              <select id="payment_cash_subcategory" name="payment_cash_subcategory"><option value="">Selecione...</option></select>
            </div>

            <div class="fields fields-h-5 fields-w-15 fields-font-3">
              <label for="payment_cash_chart_label">Conta Contábil</label>
              <input id="payment_cash_chart_label" readonly placeholder="Selecione a conta contábil">
              <input type="hidden" id="payment_cash_chart_id" name="payment_cash_chart_id">
            </div>

            <div class="cx-field-search" style="display:flex;align-items:center;align-self:flex-end;height:25px;">
              <button type="button" id="payment_cash_chart_search" class="action-icon action-icon--search"
                title="Buscar conta contábil" aria-label="Buscar conta contábil"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></button>
            </div>

            <div class="fields fields-h-5 fields-w-20 fields-font-3">
              <label for="payment_cash_files_btn">Anexos (vão para a movimentação)</label>
              <div id="payment_cash_files_box" style="display:flex;align-items:center;gap:6px;height:25px;min-width:0;">
                <button type="button" id="payment_cash_files_btn" class="btn btn-flat btn-sm">Anexar</button>
                <span id="payment_cash_files_label" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#64748b;" title="Nenhum arquivo">Nenhum arquivo</span>
                <button type="button" id="payment_cash_files_clear" class="action-icon action-icon--cancel"
                  title="Remover anexos escolhidos" aria-label="Remover anexos escolhidos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                <input type="file" id="payment_cash_files" accept=".pdf,.xml,.png,.jpg,.jpeg,.webp" multiple hidden style="display:none !important;">
              </div>
            </div>
          </div>
        </form>
        
        <div class="modal__body">
          <div id="paymentSummaryBox" class="summary-card"></div>

      <section class="table-layout">
        <div class="table-scroll table-height-300 table-row-h-20 table-scroll--rounded">
          <table class="table table-zebra table-zebra-hover table-sticky-head">
          <thead>
          <tr>
          <th>Parcela</th>
          <th>Vencimento</th>
          <th>Pagamento</th>
          <th>Valor</th>
          <th>Juros</th>
          <th>Multa</th>
          <th>Desconto</th>
          <th>Efetivo</th>
          <th>Forma</th>
          <th>Comprovante</th>
          <th>Ações</th>
          </tr>
          </thead>
          <tbody id="paymentsTableBody">
          <tr>
          <td colspan="11" class="empty-row">Nenhum pagamento registrado.</td>
          </tr>
          </tbody></table>
         </div>
        </section>
       </div>

     <footer class="modal__footer modal-footer-color-3">
       <button class="btn btn-new btn-sm"type="button" data-close-modal="paymentModal">
         Cancelar
       </button>

       <button
        id="btnSavePayment"
        class="btn btn-save btn-sm"
        type="submit"
        form="paymentForm">
         Salvar Pagamento
       </button>
      </footer>
     </section>
     </div>
    </div>
  `);
}

async function chooseSupplier() {
  const supplier = await openSuppliersModalSearch();
  if (!supplier) return;

  const creditor = document.getElementById('creditor_name_form');
  const documentInput = document.getElementById('creditor_document');
  const company = document.getElementById('company_name');

  if (creditor) {
    creditor.value = supplier.name || supplier.trade_name || '';
    creditor.dataset.supplierId = supplier.supplier_id || supplier.id || '';
  }
  if (documentInput) documentInput.value = supplier.tax_id || supplier.cnpj || supplier.cpf_cnpj || '';
  if (company) company.value = supplier.name || supplier.trade_name || '';
}

function bindModalEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;

    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
      setModalVisibility(closeButton.dataset.closeModal, false);
      return;
    }
    if (event.target.closest('#creditor_name_form')) await chooseSupplier();
  });

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'due_day_mode') syncDueDayMode();
  });

  // ESC do modal de dívida fica com o modal.js (fecha só o de cima)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (Modal.isOpen(DEBT_MODAL_ID)) return;
    setModalVisibility(PAYMENT_MODAL_ID, false);
  });
}

export function initializeDebtModals() {
  injectCreateDebtModal();
  injectPaymentModal();

  syncDueDayMode();
  bindModalEvents();
  Modal.setup();
}

export function openCreateDebtsModal(title = 'Nova Dívida') {
  const titleElement = document.getElementById('debtModalTitle');
  if (titleElement) titleElement.textContent = title;
  syncDueDayMode();
  Modal.open(DEBT_MODAL_ID, { focusSelector: '#description' });
}

export function closeCreateDebtsModal() {
  Modal.close(DEBT_MODAL_ID);
}

export function openDebtPaymentsModal() {
  setModalVisibility(PAYMENT_MODAL_ID, true);
}

export function closeDebtPaymentsModal() {
  setModalVisibility(PAYMENT_MODAL_ID, false);
}
