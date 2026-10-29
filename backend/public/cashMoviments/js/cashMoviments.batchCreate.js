// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashMoviments.batchCreate.js — Lançar várias movimentações de uma vez ║
// ║ CONSART ERP | Caixa                                                  ║
// ║ - Mesmo fornecedor/cliente, tipo, conta, categoria e plano de contas ║
// ║   (vêm do formulário Registrar); cada linha tem data e valor próprios ║
// ║ - "Gerar parcelas": N linhas mensais/quinzenais/semanais, valor       ║
// ║   repetido ou total dividido                                          ║
// ║ - Opcional: ao salvar, vincula todas a uma NF-e/NFS-e                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API, PATH_MOV } from './cashMoviments.config.js';
import { LE, fmtBRL, toInputDateTimeLocal } from './cashMoviments.utils.js';
import { coletarCreate, limparFormularioCadastro } from './cashMoviments.create.js?v=9';
import { recarregarLista } from './cashMoviments.list.js';
import { openFiscalDocumentModal } from './cashMoviments.fiscalDocuments.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js?v=2';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js?v=7';

const MODAL_ID = 'cashBatchCreateModal';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const toCents = (v) => Math.round(Number(String(v ?? '').replace(',', '.')) * 100) || 0;

const selectedText = (sel) => {
  const opt = sel?.selectedOptions?.[0];
  return opt && opt.value ? opt.textContent.trim() : '';
};

// Soma meses mantendo o dia (31/01 + 1 mês = 28/02)
function addInterval(iso, step, i) {
  const [date, time = '00:00'] = String(iso).split('T');
  const [y, m, d] = date.split('-').map(Number);
  let dt;
  if (step === 'mensal') {
    const last = new Date(y, m - 1 + i + 1, 0).getDate();
    dt = new Date(y, m - 1 + i, Math.min(d, last));
  } else {
    const days = { quinzenal: 15, semanal: 7, diario: 1 }[step] ?? 30;
    dt = new Date(y, m - 1, d + days * i);
  }
  const [hh, mi] = time.split(':').map(Number);
  dt.setHours(hh || 0, mi || 0, 0, 0);
  return toInputDateTimeLocal(dt);
}

function ensureStyles() {
  if (document.getElementById('bcm-styles')) return;
  const style = document.createElement('style');
  style.id = 'bcm-styles';
  style.textContent = `
    #${MODAL_ID} { --modal-z-index: 1100; }
    #${MODAL_ID} [hidden] { display: none !important; }
    #${MODAL_ID} .bcm-section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
    #${MODAL_ID} .bcm-section h4 { margin: 0 0 8px; color: #64748b; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    #${MODAL_ID} .bcm-common { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 14px; font-size: 12px; }
    #${MODAL_ID} .bcm-common div { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${MODAL_ID} .bcm-common span { color: #64748b; }
    #${MODAL_ID} .bcm-common b.is-missing { color: #b91c1c; font-weight: 600; }
    #${MODAL_ID} .bcm-gen { display: grid; grid-template-columns: 90px 170px 130px 130px 170px auto; gap: 8px 10px; align-items: end; }
    #${MODAL_ID} .bcm-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    #${MODAL_ID} .bcm-field label { font-size: 11px; color: #475569; }
    #${MODAL_ID} .bcm-field input, #${MODAL_ID} .bcm-field select { box-sizing: border-box; width: 100%; min-width: 0; height: 28px; font-size: 13px; }
    #${MODAL_ID} .bcm-gen .btn { height: 28px; }
    #${MODAL_ID} .bcm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #${MODAL_ID} .bcm-table th { color: #64748b; font-weight: 600; font-size: 11px; text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
    #${MODAL_ID} .bcm-table td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    #${MODAL_ID} .bcm-table input { box-sizing: border-box; width: 100%; min-width: 0; height: 26px; }
    #${MODAL_ID} .bcm-table .n { width: 28px; color: #94a3b8; text-align: center; }
    #${MODAL_ID} .bcm-table .dt { width: 175px; }
    #${MODAL_ID} .bcm-table .v { width: 120px; }
    #${MODAL_ID} .bcm-table .doc { width: 150px; }
    #${MODAL_ID} .bcm-table .x { width: 28px; text-align: center; }
    #${MODAL_ID} .bcm-table tr.is-ok td { background: #f0fdf4; }
    #${MODAL_ID} .bcm-table tr.is-err td { background: #fef2f2; }
    #${MODAL_ID} .bcm-del { border: 0; background: none; color: #b91c1c; cursor: pointer; font-size: 14px; padding: 0 4px; }
    #${MODAL_ID} .bcm-rows-wrap { max-height: 300px; overflow: auto; }
    #${MODAL_ID} .bcm-bar { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; }
    #${MODAL_ID} .bcm-total { margin-left: auto; font-weight: 600; color: #0f172a; }
    #${MODAL_ID} .bcm-link { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 8px 10px; border: 1px solid #ddd6fe; background: #faf5ff; color: #5b21b6; border-radius: 6px; cursor: pointer; }
    #${MODAL_ID} .bcm-note { margin: 6px 0 0; color: #92400e; font-size: 12px; }
    @media (max-width: 900px) {
      #${MODAL_ID} .bcm-common { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      #${MODAL_ID} .bcm-gen { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
  document.head.appendChild(style);
}

function buildModal(common, hasFile) {
  const item = (label, value, required = false) => `
    <div title="${escapeHtml(value)}"><span>${label}:</span>
      <b class="${!value && required ? 'is-missing' : ''}">${escapeHtml(value || (required ? 'não informado' : '—'))}</b></div>`;

  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'modal is-open';
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-7" role="dialog" aria-modal="true" aria-labelledby="bcmTitle">
        <header class="modal__header modal-header-color-3">
          <h3 id="bcmTitle" class="modal__title">Lançar movimentações em lote</h3>
          <button class="modal__close" type="button" data-close aria-label="Fechar" title="Fechar">&times;</button>
        </header>

        <div class="modal__body">
          <form id="bcmForm" novalidate>
            <div class="bcm-section">
              <h4>Iguais para todas (do formulário Registrar)</h4>
              <div class="bcm-common">
                ${item('Fornecedor/Cliente', common.fornecedor)}
                ${item('Tipo', common.tipo, true)}
                ${item('Conta Caixa', common.conta, true)}
                ${item('Categoria', [common.categoria, common.subcategoria].filter(Boolean).join(' › '))}
                ${item('Conta Contábil', common.contaContabil)}
                ${item('Tipo de Documento', common.tipoDoc)}
              </div>
              ${hasFile ? '<p class="bcm-note">O anexo escolhido no formulário não é usado no lote. Anexe o PDF/XML na nota fiscal (abaixo) ou em cada movimentação depois.</p>' : ''}
            </div>

            <div class="bcm-section">
              <h4>Gerar parcelas</h4>
              <div class="bcm-gen">
                <div class="bcm-field">
                  <label for="bcmQtd">Quantidade</label>
                  <input type="number" id="bcmQtd" min="1" max="120" step="1" value="3" />
                </div>
                <div class="bcm-field">
                  <label for="bcmPrimeira">1ª data</label>
                  <input type="datetime-local" id="bcmPrimeira" />
                </div>
                <div class="bcm-field">
                  <label for="bcmIntervalo">Repetir</label>
                  <select id="bcmIntervalo">
                    <option value="mensal">Todo mês</option>
                    <option value="quinzenal">A cada 15 dias</option>
                    <option value="semanal">Toda semana</option>
                    <option value="diario">Todo dia</option>
                  </select>
                </div>
                <div class="bcm-field">
                  <label for="bcmValor">Valor (R$)</label>
                  <input type="number" id="bcmValor" min="0" step="0.01" />
                </div>
                <div class="bcm-field">
                  <label for="bcmModoValor">O valor é</label>
                  <select id="bcmModoValor">
                    <option value="cada">de cada parcela</option>
                    <option value="total">o total (dividir)</option>
                  </select>
                </div>
                <button type="button" class="btn btn-flat btn-sm" id="bcmGerar">⚡ Gerar linhas</button>
              </div>
            </div>

            <div class="bcm-section">
              <h4>Movimentações</h4>
              <div class="bcm-rows-wrap">
                <table class="bcm-table">
                  <thead><tr>
                    <th class="n">#</th><th class="dt">Data/Hora</th><th class="v">Valor (R$)</th>
                    <th class="doc">Nº do Documento</th><th>Observação</th><th class="x"></th>
                  </tr></thead>
                  <tbody id="bcmRows"></tbody>
                </table>
              </div>
              <div class="bcm-bar">
                <button type="button" class="btn btn-flat btn-sm" id="bcmAdd">➕ Adicionar linha</button>
                <span class="bcm-total" id="bcmTotal"></span>
              </div>
            </div>

            <label class="bcm-link">
              <input type="checkbox" id="bcmVincularNota" />
              🧾 Depois de lançar, vincular todas a uma nota fiscal (NF-e/NFS-e)
            </label>
          </form>
        </div>

        <footer class="modal__footer modal-footer-color-3">
          <button class="btn btn-cancel btn-sm" type="button" data-close>Cancelar</button>
          <button class="btn btn-save btn-sm" type="submit" form="bcmForm" id="bcmSubmit">Lançar</button>
        </footer>
      </section>
    </div>
  `;
  return root;
}

/**
 * Abre o modal de lançamento em lote usando os campos do formulário
 * Registrar como dados comuns.
 */
export function openBatchCreateModal(dom) {
  ensureStyles();
  document.getElementById(MODAL_ID)?.remove();

  const base = coletarCreate(dom);
  const common = {
    fornecedor: base.fornecedor || '',
    tipo: base.tipo_movimentacao || '',
    conta: selectedText(dom.elConta),
    categoria: base.categoria || '',
    subcategoria: base.subcategoria || '',
    contaContabil: dom.elChartAccountLabel?.value || '',
    tipoDoc: selectedText(dom.elTipoDoc),
  };
  const hasFile = document.getElementById('anexoFile')?.files?.length > 0;

  const root = buildModal(common, hasFile);
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const el = {
    qtd: $('#bcmQtd'),
    primeira: $('#bcmPrimeira'),
    intervalo: $('#bcmIntervalo'),
    valor: $('#bcmValor'),
    modoValor: $('#bcmModoValor'),
    rows: $('#bcmRows'),
    total: $('#bcmTotal'),
    submit: $('#bcmSubmit'),
    vincular: $('#bcmVincularNota'),
  };

  let seq = 0;
  let saving = false;

  const close = () => { if (!saving) root.remove(); };
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  enhanceBrDateTime(el.primeira);
  el.primeira.value = base.data_hora || toInputDateTimeLocal(new Date());
  if (base.valor > 0) el.valor.value = base.valor.toFixed(2);

  const rowEls = () => [...el.rows.querySelectorAll('tr')];

  function refresh() {
    const rows = rowEls();
    rows.forEach((tr, i) => { tr.querySelector('.n').textContent = i + 1; });
    const cents = rows.reduce((s, tr) => s + toCents(tr.querySelector('[data-f="valor"]').value), 0);
    el.total.textContent = `${rows.length} movimentação(ões) · Total ${fmtBRL(cents / 100)}`;
    el.submit.textContent = rows.length ? `Lançar ${rows.length} movimentação(ões)` : 'Lançar';
    el.submit.disabled = !rows.length;
  }

  function addRow({ data = '', valor = '', doc = base.numero_documento || '', obs = base.observacao || '' } = {}) {
    const id = `bcmData${++seq}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="n"></td>
      <td class="dt"><input type="datetime-local" id="${id}" data-f="data" /></td>
      <td class="v"><input type="number" min="0.01" step="0.01" data-f="valor" /></td>
      <td class="doc"><input type="text" maxlength="60" data-f="doc" /></td>
      <td><input type="text" maxlength="500" data-f="obs" /></td>
      <td class="x"><button type="button" class="bcm-del" title="Remover linha" aria-label="Remover linha">🗑️</button></td>
    `;
    el.rows.appendChild(tr);
    const dt = tr.querySelector('[data-f="data"]');
    enhanceBrDateTime(dt);
    dt.value = data;
    tr.querySelector('[data-f="valor"]').value = valor;
    tr.querySelector('[data-f="doc"]').value = doc;
    tr.querySelector('[data-f="obs"]').value = obs;
    tr.querySelector('[data-f="valor"]').addEventListener('input', refresh);
    tr.querySelector('.bcm-del').addEventListener('click', () => { tr.remove(); refresh(); });
    refresh();
    return tr;
  }

  function gerar() {
    const qtd = Math.min(120, Math.max(1, parseInt(el.qtd.value, 10) || 0));
    const first = el.primeira.value;
    if (!first) {
      showCenterModal({ variant: 'warning', title: '1ª data', message: 'Informe a data da primeira parcela.' });
      el.primeira.focus();
      return;
    }
    const cents = toCents(el.valor.value);
    const parcelas = Array(qtd).fill(cents);
    if (el.modoValor.value === 'total' && cents > 0) {
      const each = Math.floor(cents / qtd);
      parcelas.fill(each);
      parcelas[qtd - 1] = cents - each * (qtd - 1);
    }
    el.rows.innerHTML = '';
    parcelas.forEach((c, i) => addRow({
      data: addInterval(first, el.intervalo.value, i),
      valor: c > 0 ? (c / 100).toFixed(2) : '',
    }));
  }

  $('#bcmGerar').addEventListener('click', gerar);
  $('#bcmAdd').addEventListener('click', () => {
    const last = rowEls().at(-1);
    const lastDate = last?.querySelector('[data-f="data"]').value;
    const tr = addRow({
      data: lastDate ? addInterval(lastDate, el.intervalo.value, 1) : el.primeira.value,
      valor: last?.querySelector('[data-f="valor"]').value || '',
    });
    tr.querySelector('[data-f="valor"]').focus();
  });

  $('#bcmForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;

    if (!base.tipo_movimentacao || !base.conta_caixa) {
      showCenterModal({
        variant: 'warning',
        title: 'Faltam dados no formulário',
        message: 'Preencha <b>Tipo Moviment.</b> e <b>Conta Caixa</b> no formulário Registrar antes de lançar em lote.',
      });
      return;
    }

    // Só linhas ainda não lançadas (numa nova tentativa, as já salvas ficam de fora)
    const pending = rowEls().filter((tr) => !tr.classList.contains('is-ok'));
    const items = pending.map((tr) => ({
      tr,
      data: tr.querySelector('[data-f="data"]').value,
      cents: toCents(tr.querySelector('[data-f="valor"]').value),
      doc: tr.querySelector('[data-f="doc"]').value.trim(),
      obs: tr.querySelector('[data-f="obs"]').value.trim(),
    }));

    const invalid = items.findIndex((it) => !it.data || it.cents <= 0);
    if (invalid >= 0) {
      items[invalid].tr.classList.add('is-err');
      showCenterModal({
        variant: 'warning',
        title: 'Linha incompleta',
        message: `A linha ${rowEls().indexOf(items[invalid].tr) + 1} precisa de data e valor maior que zero.`,
      });
      return;
    }

    saving = true;
    el.submit.disabled = true;

    const created = [...root.querySelectorAll('tr.is-ok')].map((tr) => Number(tr.dataset.movId));
    const failed = [];

    for (const [i, it] of items.entries()) {
      el.submit.textContent = `⏳ Lançando ${i + 1}/${items.length}...`;
      it.tr.classList.remove('is-err');
      try {
        const response = await fetch(`${API}/${PATH_MOV}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...base,
            data_hora: it.data,
            valor: it.cents / 100,
            numero_documento: it.doc || null,
            observacao: it.obs || null,
            anexos: [],
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
        const movId = body?.id ?? body?.data?.id ?? body?.movimentacao?.id ?? body?.row?.id ?? null;
        it.tr.classList.add('is-ok');
        it.tr.dataset.movId = movId ?? '';
        it.tr.querySelectorAll('input, button').forEach((c) => { c.disabled = true; });
        if (movId) created.push(Number(movId));
      } catch (err) {
        LE('[LOTE] linha', i + 1, err);
        it.tr.classList.add('is-err');
        failed.push(err?.message || String(err));
      }
    }

    saving = false;
    el.submit.disabled = false;
    refresh();

    await recarregarLista(dom).catch(LE);

    if (failed.length) {
      el.submit.textContent = `Tentar de novo (${failed.length})`;
      showCenterModal({
        variant: 'error',
        title: 'Algumas linhas não foram lançadas',
        message: `${items.length - failed.length} de ${items.length} lançada(s). As linhas em vermelho falharam e continuam no lote para tentar de novo.<br><small>${escapeHtml(failed[0])}</small>`,
      });
      return;
    }

    root.remove();
    limparFormularioCadastro(dom, dom.elFormCreate);

    if (el.vincular.checked && created.length) {
      await openFiscalDocumentModal(dom, { ids: created });
      return;
    }

    await showCenterModal({
      variant: 'success',
      title: 'Movimentações lançadas',
      message: `${created.length} movimentação(ões) registrada(s) com sucesso.`,
      timeoutMs: null,
      closeOnEscape: true,
      buttons: [{ label: 'Entendi', variant: 'success' }],
    });
  });

  // Começa com as parcelas geradas a partir do formulário
  gerar();
  el.qtd.focus();
}
