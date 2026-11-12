// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashMoviments.transfers.js — Transferência entre contas              ║
// ║ CONSART ERP | Caixa                                                  ║
// ║ - SAIDA na origem + ENTRADA no destino, ligadas (TRF-n)              ║
// ║ - Não entram em receitas/despesas; mexem no saldo de cada conta      ║
// ║ - Tarifa opcional: SAIDA comum (despesa) na conta de origem          ║
// ║ - Abrir com transferId edita/exclui as duas pontas juntas            ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API } from './cashMoviments.config.js';
import { LE, fmtBRL, toInputDateTimeLocal } from './cashMoviments.utils.js';
import { recarregarLista } from './cashMoviments.list.js';
import { fetchBankAccounts } from './cashMoviments.bankAccounts.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js?v=2';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js?v=7';

const MODAL_ID = 'cashTransferModal';
const API_TRF = `${API}/transferencias`;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

// "1.234,56" | "1234,56" | "1234.56" → 1234.56
const parseMoney = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const moneyInput = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
  }
  return body;
}

function ensureStyles() {
  if (document.getElementById('trf-styles')) return;
  const style = document.createElement('style');
  style.id = 'trf-styles';
  style.textContent = `
    #${MODAL_ID} { --modal-z-index: 1100; }
    #${MODAL_ID} [hidden] { display: none !important; }
    #${MODAL_ID} .trf-sec { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
    #${MODAL_ID} .trf-sec h4 { margin: 0 0 8px; color: #64748b; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    #${MODAL_ID} .trf-grid { display: grid; grid-template-columns: minmax(0, 1fr) 46px minmax(0, 1fr); gap: 10px; align-items: start; }
    #${MODAL_ID} .trf-row { display: grid; grid-template-columns: 200px 160px minmax(0, 1fr); gap: 10px; margin-top: 10px; }
    #${MODAL_ID} .trf-fee { display: grid; grid-template-columns: auto 140px minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    #${MODAL_ID} .f { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    #${MODAL_ID} .f label { font-size: 11px; color: #475569; }
    #${MODAL_ID} .f input, #${MODAL_ID} .f select { box-sizing: border-box; width: 100%; min-width: 0; height: 30px; font-size: 13px; }
    #${MODAL_ID} .f .money { text-align: right; font-weight: 600; }
    #${MODAL_ID} .trf-swap { margin-top: 17px; height: 30px; border: 1px solid #c7d2fe; background: #eef2ff; color: #3730a3; border-radius: 6px; font-size: 16px; cursor: pointer; }
    #${MODAL_ID} .trf-saldo { font-size: 11px; color: #64748b; margin-top: 2px; min-height: 14px; }
    #${MODAL_ID} .trf-check { display: flex; gap: 6px; align-items: center; font-size: 12px; height: 30px; white-space: nowrap; }
    #${MODAL_ID} .trf-prev { width: 100%; border-collapse: collapse; font-size: 12px; }
    #${MODAL_ID} .trf-prev th { color: #64748b; font-size: 11px; font-weight: 600; text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
    #${MODAL_ID} .trf-prev td { padding: 6px; border-bottom: 1px solid #f1f5f9; }
    #${MODAL_ID} .trf-prev .v { text-align: right; white-space: nowrap; }
    #${MODAL_ID} .trf-note { font-size: 12px; color: #3730a3; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 8px 10px; margin-top: 8px; }
    #${MODAL_ID} .trf-footer-left { margin-right: auto; }
    @media (max-width: 900px) {
      #${MODAL_ID} .trf-grid, #${MODAL_ID} .trf-row, #${MODAL_ID} .trf-fee { grid-template-columns: minmax(0, 1fr); }
      #${MODAL_ID} .trf-swap { margin-top: 0; }
    }
  `;
  document.head.appendChild(style);
}

function buildModal({ editing }) {
  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'modal is-open';
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-6" role="dialog" aria-modal="true" aria-labelledby="trfTitle">
        <header class="modal__header modal-header-color-3">
          <h3 id="trfTitle" class="modal__title">⇄ Transferência entre contas</h3>
          <button class="modal__close" type="button" data-close aria-label="Fechar" title="Fechar">&times;</button>
        </header>

        <div class="modal__body">
          <form id="trfForm" novalidate>
            <div class="trf-sec">
              <h4>De onde sai e para onde vai</h4>
              <div class="trf-grid">
                <div class="f">
                  <label for="trfFrom">Conta de origem (sai)</label>
                  <select id="trfFrom" required></select>
                  <div class="trf-saldo" id="trfFromSaldo"></div>
                </div>
                <button type="button" class="trf-swap" id="trfSwap" title="Inverter contas" aria-label="Inverter contas">⇄</button>
                <div class="f">
                  <label for="trfTo">Conta de destino (entra)</label>
                  <select id="trfTo" required></select>
                  <div class="trf-saldo" id="trfToSaldo"></div>
                </div>
              </div>
              <div class="trf-row">
                <div class="f">
                  <label for="trfDate">Data/Hora</label>
                  <input type="datetime-local" id="trfDate" required />
                </div>
                <div class="f">
                  <label for="trfAmount">Valor</label>
                  <input type="text" id="trfAmount" class="money" inputmode="decimal" placeholder="0,00" required />
                </div>
                <div class="f">
                  <label for="trfNotes">Observação (vai nas duas)</label>
                  <input type="text" id="trfNotes" maxlength="500" />
                </div>
              </div>
            </div>

            <div class="trf-sec">
              <h4>Tarifa do banco (opcional)</h4>
              <div class="trf-fee">
                <label class="trf-check"><input type="checkbox" id="trfHasFee" /> Teve tarifa</label>
                <div class="f">
                  <label for="trfFeeAmount">Valor da tarifa</label>
                  <input type="text" id="trfFeeAmount" class="money" inputmode="decimal" placeholder="0,00" disabled />
                </div>
                <div class="f">
                  <label for="trfFeeChart">Plano de contas da tarifa (é despesa)</label>
                  <select id="trfFeeChart" disabled><option value="">Carregando...</option></select>
                </div>
                <label class="trf-check" title="Dedutível no IRPJ/CSLL"><input type="checkbox" id="trfFeeDeductible" checked disabled /> Dedutível</label>
              </div>
            </div>

            <div class="trf-sec">
              <h4>Vai gerar</h4>
              <table class="trf-prev">
                <thead><tr><th>Tipo</th><th>Conta</th><th>Nome</th><th class="v">Valor</th><th>Conta como</th></tr></thead>
                <tbody id="trfPreview"></tbody>
              </table>
              <div class="trf-note">
                As duas pontas ficam ligadas: editar data, valor ou contas muda as duas, e excluir uma exclui as duas.
                Transferências mexem no saldo de cada conta, mas não entram em receitas, despesas nem na apuração de impostos.
              </div>
            </div>
          </form>
        </div>

        <footer class="modal__footer modal-footer-color-3">
          ${editing ? '<button class="btn btn-danger btn-sm trf-footer-left" type="button" id="trfDelete">🗑️ Excluir transferência</button>' : ''}
          <button class="btn btn-cancel btn-sm" type="button" data-close>Cancelar</button>
          <button class="btn btn-save btn-sm" type="submit" form="trfForm" id="trfSubmit">⇄ Transferir</button>
        </footer>
      </section>
    </div>
  `;
  return root;
}

let chartAccountsCache = null;

async function loadChartAccounts() {
  if (chartAccountsCache) return chartAccountsCache;
  const body = await fetchJson(`${API}/chart-accounts`);
  chartAccountsCache = Array.isArray(body) ? body : (body?.data || body?.rows || []);
  return chartAccountsCache;
}

async function loadSaldo(accountId, isoDate) {
  if (!accountId) return null;
  try {
    const url = `/api/bank-accounts-balance/calculate?bank_account_id=${encodeURIComponent(accountId)}&date=${encodeURIComponent(isoDate)}`;
    const body = await fetchJson(url);
    return body?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Abre o modal. Sem transferId = nova transferência;
 * com transferId = editar/excluir a transferência (as duas pontas).
 */
export async function openTransferModal(dom, { transferId = null } = {}) {
  ensureStyles();
  document.getElementById(MODAL_ID)?.remove();

  const editing = !!transferId;
  let current = null;

  try {
    if (editing) current = await fetchJson(`${API_TRF}/${transferId}`);
  } catch (err) {
    LE('[TRANSFERÊNCIA] carregar', err);
    showCenterModal({ variant: 'error', title: 'Transferência', message: escapeHtml(err?.message || 'Não foi possível carregar a transferência.') });
    return;
  }

  const root = buildModal({ editing });
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const el = {
    title: $('#trfTitle'),
    from: $('#trfFrom'),
    to: $('#trfTo'),
    fromSaldo: $('#trfFromSaldo'),
    toSaldo: $('#trfToSaldo'),
    swap: $('#trfSwap'),
    date: $('#trfDate'),
    amount: $('#trfAmount'),
    notes: $('#trfNotes'),
    hasFee: $('#trfHasFee'),
    feeAmount: $('#trfFeeAmount'),
    feeChart: $('#trfFeeChart'),
    feeDeductible: $('#trfFeeDeductible'),
    preview: $('#trfPreview'),
    submit: $('#trfSubmit'),
    del: $('#trfDelete'),
  };

  let saving = false;
  const close = () => { if (!saving) root.remove(); };
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  if (editing) el.title.textContent = `⇄ Transferência ${current.document_number || ''}`.trim();

  // Contas
  const accounts = (await fetchBankAccounts().catch(() => [])).filter((a) => a.id && (a.is_active || editing));
  const options = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  el.from.innerHTML = `<option value="">Selecione...</option>${options}`;
  el.to.innerHTML = `<option value="">Selecione...</option>${options}`;

  if (editing) {
    el.from.value = String(current.from_bank_account_id ?? '');
    el.to.value = String(current.to_bank_account_id ?? '');
  } else {
    // Origem: conta escolhida no formulário Registrar (ou a padrão)
    const formAccount = dom?.elConta?.value ? accounts.find((a) => String(a.id) === String(dom.elConta.value)) : null;
    const origin = formAccount || accounts.find((a) => a.is_default) || null;
    if (origin) el.from.value = String(origin.id);
  }

  enhanceBrDateTime(el.date);
  el.date.value = editing
    ? toInputDateTimeLocal(new Date(current.transfer_date))
    : (dom?.elDataHora?.value || toInputDateTimeLocal(new Date()));
  el.date.dispatchEvent(new Event('input', { bubbles: true }));
  el.date.dispatchEvent(new Event('change', { bubbles: true }));

  if (editing) {
    el.amount.value = moneyInput(current.amount);
    el.notes.value = current.notes || '';
  }

  // Plano de contas da tarifa
  const setFeeEnabled = () => {
    const on = el.hasFee.checked;
    el.feeAmount.disabled = !on;
    el.feeChart.disabled = !on;
    el.feeDeductible.disabled = !on;
  };

  loadChartAccounts()
    .then((rows) => {
      el.feeChart.innerHTML = '<option value="">— Sem plano de contas —</option>'
        + rows.map((r) => `<option value="${r.id}">${escapeHtml(`${r.code} - ${r.description}`)}</option>`).join('');
      if (editing && current.fee_chart_account_id) {
        el.feeChart.value = String(current.fee_chart_account_id);
      } else {
        const tarifa = rows.find((r) => /tarifa/i.test(r.description || ''));
        if (tarifa) el.feeChart.value = String(tarifa.id);
      }
      refresh();
    })
    .catch((err) => {
      LE('[TRANSFERÊNCIA] plano de contas', err);
      el.feeChart.innerHTML = '<option value="">— Sem plano de contas —</option>';
    });

  if (editing && current.fee_amount != null) {
    el.hasFee.checked = true;
    el.feeAmount.value = moneyInput(current.fee_amount);
    el.feeDeductible.checked = current.fee_is_deductible !== false;
  }
  setFeeEnabled();

  const accountName = (sel) => (sel.value ? sel.selectedOptions[0]?.textContent.trim() : '');

  // Saldo calculado de cada conta (precisa de uma conferência em Saldos Bancários)
  let saldoSeq = 0;
  const refreshSaldos = async () => {
    const seq = ++saldoSeq;
    const day = String(el.date.value || '').slice(0, 10) || toInputDateTimeLocal(new Date()).slice(0, 10);
    const [a, b] = await Promise.all([loadSaldo(el.from.value, day), loadSaldo(el.to.value, day)]);
    if (seq !== saldoSeq) return;
    const fmt = (s) => {
      if (!s) return '';
      return s.balance === null || s.balance === undefined
        ? 'Saldo calculado: sem conferência'
        : `Saldo calculado em ${day.split('-').reverse().join('/')}: ${fmtBRL(s.balance)}`;
    };
    el.fromSaldo.textContent = fmt(a);
    el.toSaldo.textContent = fmt(b);
  };

  function refresh() {
    const from = accountName(el.from) || 'origem';
    const to = accountName(el.to) || 'destino';
    const amount = parseMoney(el.amount.value);
    const fee = el.hasFee.checked ? parseMoney(el.feeAmount.value) : 0;
    const chart = el.feeChart.value ? el.feeChart.selectedOptions[0]?.textContent.split(' - ')[0] : '';

    el.preview.innerHTML = `
      <tr><td><span class="cx-trf-tipo is-out">⇄ TRANSF. SAÍDA</span></td><td>${escapeHtml(from)}</td>
        <td>Transferência → ${escapeHtml(to)}</td><td class="v">${fmtBRL(amount)}</td><td>Transferência</td></tr>
      <tr><td><span class="cx-trf-tipo is-in">⇄ TRANSF. ENTRADA</span></td><td>${escapeHtml(to)}</td>
        <td>Transferência ← ${escapeHtml(from)}</td><td class="v">${fmtBRL(amount)}</td><td>Transferência</td></tr>
      ${fee > 0 ? `<tr><td>SAIDA</td><td>${escapeHtml(from)}</td><td>Tarifa de transferência ${escapeHtml(from)}</td>
        <td class="v">${fmtBRL(fee)}</td><td>Despesa${chart ? ` (${escapeHtml(chart)})` : ''}</td></tr>` : ''}
    `;
    el.submit.textContent = `${editing ? '💾 Salvar' : '⇄ Transferir'} ${amount > 0 ? fmtBRL(amount) : ''}`.trim();
  }

  el.swap.addEventListener('click', () => {
    const a = el.from.value;
    el.from.value = el.to.value;
    el.to.value = a;
    refresh();
    refreshSaldos();
  });
  [el.from, el.to].forEach((s) => s.addEventListener('change', () => { refresh(); refreshSaldos(); }));
  el.date.addEventListener('change', refreshSaldos);
  [el.amount, el.feeAmount, el.feeChart].forEach((i) => i.addEventListener('input', refresh));
  el.feeChart.addEventListener('change', refresh);
  el.hasFee.addEventListener('change', () => {
    setFeeEnabled();
    if (el.hasFee.checked) el.feeAmount.focus();
    refresh();
  });
  [el.amount, el.feeAmount].forEach((i) => i.addEventListener('blur', () => {
    if (i.value.trim()) i.value = moneyInput(parseMoney(i.value));
  }));

  refresh();
  refreshSaldos();

  const warn = (message) => showCenterModal({ variant: 'warning', title: 'Transferência', message });

  $('#trfForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;

    const amount = parseMoney(el.amount.value);
    const fee = el.hasFee.checked ? parseMoney(el.feeAmount.value) : 0;

    if (!el.from.value || !el.to.value) return warn('Escolha a conta de origem e a de destino.');
    if (el.from.value === el.to.value) return warn('A conta de origem e a de destino precisam ser diferentes.');
    if (!el.date.value) return warn('Informe a data da transferência.');
    if (!(amount > 0)) return warn('Informe o valor da transferência.');
    if (el.hasFee.checked && !(fee > 0)) return warn('Informe o valor da tarifa ou desmarque “Teve tarifa”.');

    const payload = {
      from_bank_account_id: Number(el.from.value),
      to_bank_account_id: Number(el.to.value),
      transfer_date: el.date.value,
      amount,
      notes: el.notes.value.trim() || null,
      fee_amount: fee > 0 ? fee : null,
      fee_chart_account_id: fee > 0 && el.feeChart.value ? Number(el.feeChart.value) : null,
      fee_is_deductible: el.feeDeductible.checked,
    };

    saving = true;
    el.submit.disabled = true;
    const label = el.submit.textContent;
    el.submit.textContent = '⏳ Salvando...';

    try {
      const saved = await fetchJson(editing ? `${API_TRF}/${transferId}` : API_TRF, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      saving = false;
      root.remove();
      await recarregarLista(dom).catch(LE);

      showCenterModal({
        variant: 'success',
        title: editing ? 'Transferência atualizada' : 'Transferência registrada',
        message: `${escapeHtml(saved.document_number || '')}: ${fmtBRL(amount)} de <b>${escapeHtml(saved.from_account)}</b> para <b>${escapeHtml(saved.to_account)}</b>${fee > 0 ? ` + tarifa de ${fmtBRL(fee)}` : ''}.`,
      });
    } catch (err) {
      LE('[TRANSFERÊNCIA] salvar', err);
      saving = false;
      el.submit.disabled = false;
      el.submit.textContent = label;
      showCenterModal({ variant: 'error', title: 'Erro ao salvar a transferência', message: escapeHtml(err?.message || 'Falha ao comunicar com a API.') });
    }
  });

  el.del?.addEventListener('click', async () => {
    const ok = await confirmDeleteTransfer(current);
    if (!ok) return;
    root.remove();
    await deleteTransferAndReload(dom, transferId);
  });

  (editing ? el.amount : (el.from.value ? el.to : el.from)).focus();
}

export function confirmDeleteTransfer(transfer) {
  const doc = transfer?.document_number || 'esta transferência';
  return showCenterModal({
    variant: 'warning',
    title: `Excluir ${escapeHtml(doc)}?`,
    message: 'Esta movimentação é uma ponta de uma transferência entre contas. '
      + 'Serão excluídas as duas pontas (saída e entrada) e a tarifa, se houver.',
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  }).then((answer) => answer === true);
}

export async function deleteTransferAndReload(dom, transferId) {
  try {
    await fetchJson(`${API_TRF}/${transferId}`, { method: 'DELETE' });
    await recarregarLista(dom);
  } catch (err) {
    LE('[TRANSFERÊNCIA] excluir', err);
    showCenterModal({ variant: 'error', title: 'Erro ao excluir a transferência', message: escapeHtml(err?.message || 'Falha ao comunicar com a API.') });
  }
}
