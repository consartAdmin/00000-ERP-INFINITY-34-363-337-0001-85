'use strict';

// Baixa (pagamento) em lote dos títulos selecionados.
// Cada título em aberto é pago pelo saldo: título de Compromisso vai para a
// parcela (/pay-debt); os demais geram a SAÍDA no caixa + baixa (/pay).

import * as api from './accountsPayable.api.js';
import { populateBankAccountSelect } from './accountsPayable.modal.js';
import { state } from './accountsPayable.state.js';
import { formatDate, formatMoney, qs, toInt } from './accountsPayable.utils.js';

const MODAL_ID = 'apBatchPayModal';
const CLOSED_STATUS = new Set(['PAID', 'CANCELLED']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function balanceOf(record) {
  const total = Number(record.total_value || 0);
  const paid = Number(record.amount_paid || 0);
  return Math.max(0, Math.round((record.balance != null ? Number(record.balance) : total - paid) * 100) / 100);
}

async function loadRecords(ids) {
  const byId = new Map(state.items.map((item) => [Number(item.id), item]));
  const records = [];
  for (const id of ids) {
    records.push(byId.get(id) || await api.getAccount(id));
  }
  return records.filter(Boolean);
}

function buildModal(open, skipped) {
  const total = open.reduce((sum, record) => sum + balanceOf(record), 0);
  const rows = open.map((record) => `
    <tr>
      <td>${Number(record.id)}</td>
      <td>${escapeHtml(record.supplier_name || '')}</td>
      <td>${escapeHtml(record.invoice_number || '')}${record.debt_id ? ' 🔗' : ''}</td>
      <td>${formatDate(record.due_date)}</td>
      <td>${formatMoney(balanceOf(record))}</td>
    </tr>`).join('');

  return `
    <div class="modal__backdrop" data-batch-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal__panel--lg ap-batch-pay" role="document">
        <header class="modal__header">
          <h3 class="modal__title" id="apBatchPayTitle">💸 Baixar títulos selecionados</h3>
          <button type="button" class="modal__close" data-batch-close aria-label="Fechar" title="Fechar">&times;</button>
        </header>
        <form id="apBatchPayForm" autocomplete="off" style="display:flex; flex:1 1 auto; min-height:0; flex-direction:column;">
          <div class="modal__body modal-section">
            <div class="ap-modal-section-title">Pagamento</div>
            <div class="fields-inline fields-gap-3">
              <div class="fields fields-h-6 fields-w-12 fields-font-3">
                <label for="apBatchPayDate">Data do Pagamento</label>
                <input type="date" id="apBatchPayDate" required />
              </div>
              <div class="fields fields-h-6 fields-w-15 fields-font-3">
                <label for="apBatchPayBank">Conta Bancária</label>
                <select id="apBatchPayBank" required><option value="">Selecione...</option></select>
              </div>
              <div class="fields fields-h-6 fields-w-12 fields-font-3">
                <label for="apBatchPayDocType">Tipo de Doc.</label>
                <select id="apBatchPayDocType"><option value="">Selecione...</option></select>
              </div>
              <div class="fields fields-h-6 fields-w-12 fields-font-3">
                <label for="apBatchPayCategory">Categoria</label>
                <select id="apBatchPayCategory"><option value="">(a de cada título)</option></select>
              </div>
              <div class="fields fields-h-6 fields-w-12 fields-font-3">
                <label for="apBatchPaySubcategory">Subcategoria</label>
                <select id="apBatchPaySubcategory"><option value="">(a de cada título)</option></select>
              </div>
            </div>
            <div class="fields-inline fields-gap-3">
              <div class="fields fields-h-6 fields-w-40 fields-font-3">
                <label for="apBatchPayNotes">Observação</label>
                <input type="text" id="apBatchPayNotes" maxlength="500" placeholder="Opcional" />
              </div>
            </div>

            <div class="ap-modal-section-title">
              ${open.length} título(s) — total ${formatMoney(total)}
              ${skipped ? `<small class="ap-batch-pay__skipped">(${skipped} já pago(s) ou cancelado(s) ficam de fora)</small>` : ''}
            </div>
            <div class="ap-batch-pay__list">
              <table class="table table-zebra">
                <thead><tr><th>ID</th><th>Fornecedor</th><th>Nº Fatura</th><th>Vencimento</th><th>Saldo</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <div id="apBatchPayProgress" class="ap-batch-pay__progress" aria-live="polite"></div>
          </div>
          <footer class="modal__footer">
            <button type="button" class="btn btn-cancel btn-sm" data-batch-close>Cancelar</button>
            <button type="submit" class="btn btn-save btn-sm" id="apBatchPaySubmit">Baixar ${open.length} título(s)</button>
          </footer>
        </form>
      </section>
    </div>`;
}

async function fillLookups(root) {
  const bank = qs('#apBatchPayBank', root);
  const docType = qs('#apBatchPayDocType', root);
  const category = qs('#apBatchPayCategory', root);
  const subcategory = qs('#apBatchPaySubcategory', root);

  await populateBankAccountSelect(bank).catch(() => {});

  try {
    (await api.listDocumentTypes())
      .filter((item) => item.is_active !== false)
      .forEach((item) => docType.add(new Option(item.name || '', String(item.id))));
  } catch (error) { console.error('[accountsPayable] tipos de documento:', error); }

  try {
    const rows = state.cashCategories.length ? state.cashCategories : await api.listCashCategories();
    rows.filter((item) => item.is_active !== false)
      .forEach((item) => category.add(new Option(item.nome, String(item.id))));
  } catch (error) { console.error('[accountsPayable] categorias:', error); }

  category.addEventListener('change', async () => {
    subcategory.replaceChildren(new Option('(a de cada título)', ''));
    if (!category.value) return;
    try {
      (await api.listCashSubcategories(category.value))
        .filter((item) => item.is_active !== false)
        .forEach((item) => subcategory.add(new Option(item.nome, String(item.id))));
    } catch (error) { console.error('[accountsPayable] subcategorias:', error); }
  });
}

async function payOne(record, choice) {
  const amount = balanceOf(record);
  const categoryId = choice.categoryId ?? toInt(record.category_id);
  const subcategoryId = choice.categoryId ? choice.subcategoryId : toInt(record.subcategory_id);
  const documentType = choice.documentType || record.document_type || 'DUPLICATA';

  if (record.debt_id) {
    return api.registerDebtPayment(record.id, {
      payment_date: choice.date,
      paid_increment: amount,
      observacao: choice.notes,
      bank_account_id: choice.bankAccountId,
      document_type: documentType,
      document_number: record.invoice_number || null,
      chart_account_id: toInt(record.chart_account_id),
      category_id: categoryId,
      subcategory_id: subcategoryId,
    });
  }

  await api.createCashMovement({
    data_hora: `${choice.date}T12:00`,
    tipo_movimentacao: 'SAÍDA',
    conta_caixa: choice.cashAccount,
    bank_account_id: choice.bankAccountId,
    valor: amount,
    tipo_documento: documentType,
    document_type_id: choice.documentTypeId,
    numero_documento: record.invoice_number || record.document_number || String(record.id),
    fornecedor: record.supplier_name || '',
    observacao: choice.notes,
    multa: 0,
    juros: 0,
    encargos: 0,
    chart_account_id: toInt(record.chart_account_id),
    categoria: categoryId != null ? String(categoryId) : null,
    subcategoria: subcategoryId != null ? String(subcategoryId) : null,
    is_active: true,
  });
  return api.registerPayment(record.id, {
    payment_date: choice.date,
    paid_increment: amount,
    multa: 0,
    juros: 0,
    encargos: 0,
    chart_account_id: toInt(record.chart_account_id),
    observacao: choice.notes,
  });
}

/**
 * Abre o modal de baixa em lote.
 * @param {number[]} ids  títulos selecionados
 * @param {() => Promise<void>} onDone  recarrega a lista
 */
export async function openBatchPayModal(ids, onDone) {
  if (!ids.length) return;
  let records;
  try {
    records = await loadRecords(ids);
  } catch (error) {
    console.error('[accountsPayable] batch pay load:', error);
    alert('Erro ao carregar os títulos selecionados.');
    return;
  }

  const open = records.filter((record) =>
    !CLOSED_STATUS.has(String(record.status || 'PENDING').toUpperCase()) && balanceOf(record) > 0);
  if (!open.length) {
    alert('Os títulos selecionados já estão pagos ou cancelados.');
    return;
  }

  document.getElementById(MODAL_ID)?.remove();
  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'modal is-open';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'apBatchPayTitle');
  root.style.display = 'flex';
  root.innerHTML = buildModal(open, records.length - open.length);
  document.body.appendChild(root);
  document.body.classList.add('modal-open');

  let busy = false;
  const close = () => {
    if (busy) return;
    root.remove();
    document.body.classList.remove('modal-open');
  };
  root.querySelectorAll('[data-batch-close]').forEach((el) => el.addEventListener('click', close));

  qs('#apBatchPayDate', root).value = new Date().toISOString().slice(0, 10);
  await fillLookups(root);

  qs('#apBatchPayForm', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    const bank = qs('#apBatchPayBank', root);
    const docType = qs('#apBatchPayDocType', root);
    const date = qs('#apBatchPayDate', root).value;
    if (!date) return alert('Informe a data do pagamento.');
    if (!bank.value) return alert('Informe a Conta Bancária (obrigatória).');

    const option = bank.options[bank.selectedIndex];
    const choice = {
      date,
      bankAccountId: toInt(bank.value),
      cashAccount: option.dataset.accountName || option.text.trim(),
      documentTypeId: toInt(docType.value),
      documentType: docType.value ? docType.options[docType.selectedIndex].text.trim() : '',
      categoryId: toInt(qs('#apBatchPayCategory', root).value),
      subcategoryId: toInt(qs('#apBatchPaySubcategory', root).value),
      notes: qs('#apBatchPayNotes', root).value.trim(),
    };

    const total = open.reduce((sum, record) => sum + balanceOf(record), 0);
    if (!confirm(`Confirmar a baixa de ${open.length} título(s), total ${formatMoney(total)}?`)) return;

    busy = true;
    const submit = qs('#apBatchPaySubmit', root);
    const progress = qs('#apBatchPayProgress', root);
    submit.disabled = true;
    const failures = [];
    let done = 0;

    for (const record of open) {
      progress.textContent = `Baixando ${done + failures.length + 1} de ${open.length}...`;
      try {
        await payOne(record, choice);
        done += 1;
      } catch (error) {
        console.error(`[accountsPayable] batch pay #${record.id}:`, error);
        failures.push(`#${record.id}: ${error?.message || 'erro'}`);
      }
    }

    busy = false;
    close();
    await onDone(done);
    alert(
      `${done} título(s) baixado(s).` +
      (failures.length ? `\n\nNão foi possível baixar ${failures.length}:\n${failures.slice(0, 10).join('\n')}` : '')
    );
  });
}
