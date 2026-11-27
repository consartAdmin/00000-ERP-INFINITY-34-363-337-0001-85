// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassificationQuickCreate.js                                ║
// ║ MODULE: Fiscal Classification — Cadastro rápido (sobre o modal de busca) ║
// ║ CONSART ERP                                                              ║
// ║                                                                          ║
// ║ Abre o mesmo formulário do cadastro de Classificação Fiscal              ║
// ║ (public/fiscalClassification) num modal empilhado, salva pela mesma API  ║
// ║ (/api/v2/fiscal-classifications) e devolve a classificação criada.       ║
// ║ Reaproveita validação, formatação, alíquotas 2026 e API do cadastro.     ║
// ║ Só classes do design system (style.css). Avisos: centerAlertModal.       ║
// ║                                                                          ║
// ║ EXPORTS:                                                                 ║
// ║ - openFiscalClassificationQuickCreate({ apiBase, initialTerm, onSaved }) ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import { RATES_2026, ROUTES } from '/public/fiscalClassification/js/fiscalClassification.config.js';
import { createFiscalClassification, getJson } from '/public/fiscalClassification/js/fiscalClassification.api.js';
import { validateFiscalClassification } from '/public/fiscalClassification/js/fiscalClassification.validation.js';
import {
  escapeHtml, formatCest, formatDecimal, formatNcm, normalizeRows, notify, onlyDigits, toNullableText, toNumber,
} from '/public/fiscalClassification/js/fiscalClassification.utils.js';

export const QUICK_CREATE_MODAL_ID = 'fiscalClassificationQuickCreateModal';

const P = 'fcq-'; // prefixo dos IDs (evita conflito com campos da tela que abriu o modal)

const TEXT_FIELDS = [
  'classification_name', 'description', 'ncm_code', 'ex_tipi', 'ncm_description',
  'cest_code', 'cest_description', 'ibscbs_cst', 'ibscbs_classification',
  'is_cst', 'is_classification',
];
const RATE_FIELDS = ['ibs_uf_rate', 'ibs_municipal_rate', 'cbs_rate', 'is_rate', 'is_specific_rate'];

const pct = (value) => formatDecimal(value, 4);

/* ========================================================================
   MARKUP (mesmos campos/seções do modal de public/fiscalClassification)
======================================================================== */

function field({ id, label, span = '', attrs = '', value = '' }) {
  return `
    <div class="fields fields-h-6 fields-w-full fields-font-3 ${span}">
      <label for="${P}${id}">${label}</label>
      <input id="${P}${id}" type="text" ${attrs} value="${escapeHtml(value)}">
    </div>`;
}

function createMarkup() {
  return /* html */ `
    <div id="${QUICK_CREATE_MODAL_ID}" class="modal modal-width-10 modal-header-color-3 modal-footer-color-3 is-open"
      role="dialog" aria-modal="true" aria-labelledby="${P}title" aria-hidden="false">
      <div class="modal__backdrop" data-fcq-close></div>
      <div class="modal__dialog">
        <section class="modal__panel" role="document">
          <header class="modal__header">
            <h3 class="modal__title" id="${P}title">＋ Nova classificação fiscal</h3>
            <button type="button" class="modal__close" data-fcq-close aria-label="Fechar">✕</button>
          </header>

          <form id="${P}form" class="modal__body modal-section" autocomplete="off" novalidate>
            <div class="modal-form-grid modal-form-grid--6 fields-value-bold">

              <div class="summary summary--between summary-gap-8 modal-field--span-full">
                <h4>Identificação</h4>
                <small>Depois de salvar, a classificação já é selecionada</small>
              </div>

              ${field({ id: 'classification_name', label: 'Nome da classificação *', span: 'modal-field--span-3', attrs: 'maxlength="150" required placeholder="Ex.: Caneta esferográfica – revenda"' })}

              <div class="fields fields-h-6 fields-w-full fields-font-3 modal-field--span-3">
                <label for="${P}fiscal_profile_id">Perfil fiscal padrão</label>
                <select id="${P}fiscal_profile_id">
                  <option value="">Carregando perfis...</option>
                </select>
              </div>

              ${field({ id: 'description', label: 'Descrição interna', span: 'modal-field--span-full', attrs: 'placeholder="Observação interna sobre o vínculo fiscal..."' })}

              <div class="modal-divider modal-divider--soft modal-field--span-full"></div>

              <div class="summary summary--between summary-gap-8 modal-field--span-full">
                <h4>NCM / CEST</h4>
              </div>

              ${field({ id: 'ncm_code', label: 'NCM', attrs: 'maxlength="10" inputmode="numeric" placeholder="Ex.: 9608.10.00"' })}
              ${field({ id: 'ex_tipi', label: 'EX TIPI', attrs: 'maxlength="3" inputmode="numeric"' })}
              ${field({ id: 'ncm_description', label: 'Descrição NCM', span: 'modal-field--span-4', attrs: 'placeholder="Descrição oficial do NCM (opcional)"' })}
              ${field({ id: 'cest_code', label: 'CEST', attrs: 'maxlength="10" inputmode="numeric" placeholder="Ex.: 10.005.00"' })}
              ${field({ id: 'cest_description', label: 'Descrição CEST', span: 'modal-field--span-5', attrs: 'placeholder="Descrição oficial do CEST (opcional)"' })}

              <div class="modal-divider modal-divider--soft modal-field--span-full"></div>

              <div class="summary summary--between summary-gap-8 modal-field--span-full">
                <h4>Reforma Tributária — IBS / CBS</h4>
                <div class="summary summary--inline summary-gap-8">
                  <div class="summary-pill summary-pill--info">Ano-teste 2026: IBS UF ${pct(RATES_2026.ibs_uf_rate)}% · CBS ${pct(RATES_2026.cbs_rate)}%</div>
                  <button id="${P}rates2026" type="button" class="btn btn-toolbar btn-sm">Aplicar alíquotas 2026</button>
                </div>
              </div>

              ${field({ id: 'ibscbs_cst', label: 'CST IBS/CBS', attrs: 'inputmode="numeric" maxlength="3" placeholder="000"' })}
              ${field({ id: 'ibscbs_classification', label: 'Classificação (cClassTrib)', attrs: 'inputmode="numeric" maxlength="6" placeholder="000000"' })}
              ${field({ id: 'ibs_uf_rate', label: 'Alíquota IBS UF (%)', attrs: 'inputmode="decimal" data-decimals="4"', value: '0,0000' })}
              ${field({ id: 'ibs_municipal_rate', label: 'Alíquota IBS Municipal (%)', attrs: 'inputmode="decimal" data-decimals="4"', value: '0,0000' })}
              ${field({ id: 'cbs_rate', label: 'Alíquota CBS (%)', attrs: 'inputmode="decimal" data-decimals="4"', value: '0,0000' })}

              <div class="fields fields-h-6 fields-w-full fields-font-3">
                <label for="${P}donation_indicator">Doação</label>
                <select id="${P}donation_indicator">
                  <option value="1" selected>Não</option>
                  <option value="0">Sim</option>
                </select>
              </div>

              <div class="modal-divider modal-divider--soft modal-field--span-full"></div>

              <div class="summary summary--between summary-gap-8 modal-field--span-full">
                <h4>Imposto Seletivo</h4>
                <small>Preencha só para produtos sujeitos ao IS</small>
              </div>

              ${field({ id: 'is_cst', label: 'CST IS', attrs: 'maxlength="3" inputmode="numeric"' })}
              ${field({ id: 'is_classification', label: 'Classificação IS', attrs: 'maxlength="10"' })}
              ${field({ id: 'is_rate', label: 'Alíquota IS (%)', attrs: 'inputmode="decimal" data-decimals="4"', value: '0,0000' })}
              ${field({ id: 'is_specific_rate', label: 'Alíquota específica', attrs: 'inputmode="decimal" data-decimals="6"', value: '0,000000' })}
              ${field({ id: 'is_unit', label: 'Unidade', attrs: 'maxlength="6"', value: 'UN' })}
            </div>
          </form>

          <footer class="modal__footer">
            <button type="button" class="btn btn-toolbar btn-sm" data-fcq-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg><span>Cancelar</span></button>
            <button id="${P}save" type="submit" form="${P}form" class="btn btn-new btn-sm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><path d="M8 21v-7h8v7"/></svg><span>Salvar e selecionar</span></button>
          </footer>
        </section>
      </div>
    </div>`;
}

/* ========================================================================
   OPEN
======================================================================== */

/**
 * Abre o cadastro rápido. O termo digitado na busca vira NCM (8 dígitos),
 * CEST (7 dígitos) ou o nome da classificação.
 * onSaved(row) recebe a classificação criada (com perfil, via GET /:id).
 */
export function openFiscalClassificationQuickCreate({ apiBase = '', initialTerm = '', onSaved } = {}) {
  const base = String(apiBase ?? '').replace(/\/+$/, '');
  document.getElementById(QUICK_CREATE_MODAL_ID)?.remove();

  const host = document.createElement('div');
  host.innerHTML = createMarkup().trim();
  const modal = host.firstElementChild;
  document.body.appendChild(modal);

  const $f = (id) => modal.querySelector(`#${P}${id}`);
  const form = $f('form');
  const saveBtn = $f('save');
  const profileSelect = $f('fiscal_profile_id');
  let saving = false;

  // Termo da busca → campo certo.
  const term = String(initialTerm ?? '').trim();
  const digits = onlyDigits(term);
  if (term && digits.length === 8 && digits.length >= term.replace(/[.\s-]/g, '').length) {
    $f('ncm_code').value = formatNcm(digits);
  } else if (term && digits.length === 7 && digits.length >= term.replace(/[.\s-]/g, '').length) {
    $f('cest_code').value = formatCest(digits);
  } else if (term) {
    $f('classification_name').value = term.toUpperCase();
  }

  /* ---------- fechar ---------- */
  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    modal.remove();
  }
  // Captura: o ESC fecha só este modal, não o de busca que está embaixo.
  function onKeydown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKeydown, true);
  modal.querySelectorAll('[data-fcq-close]').forEach((el) => el.addEventListener('click', close));

  /* ---------- formatação (igual ao cadastro) ---------- */
  modal.querySelectorAll('input[data-decimals]').forEach((input) => {
    const decimals = Number(input.dataset.decimals) || 4;
    input.addEventListener('blur', () => { input.value = formatDecimal(input.value, decimals); });
    input.addEventListener('focus', () => input.select());
  });
  $f('ncm_code').addEventListener('blur', (e) => { e.target.value = formatNcm(e.target.value); });
  $f('cest_code').addEventListener('blur', (e) => { e.target.value = formatCest(e.target.value); });
  $f('rates2026').addEventListener('click', () => {
    Object.entries(RATES_2026).forEach(([id, value]) => {
      const input = $f(id);
      if (input) input.value = formatDecimal(value, Number(input.dataset.decimals) || 4);
    });
  });

  /* ---------- perfis fiscais ---------- */
  (async () => {
    try {
      const payload = await getJson(`${base}${ROUTES.fiscalProfiles}?limit=500&offset=0`);
      profileSelect.innerHTML = '';
      profileSelect.add(new Option('— Sem perfil vinculado —', ''));
      normalizeRows(payload).forEach((p) => {
        if (p.fiscal_profile_id == null) return;
        profileSelect.add(new Option(p.profile_name || `Perfil #${p.fiscal_profile_id}`, String(p.fiscal_profile_id)));
      });
    } catch (error) {
      console.error('[fiscalClassificationQuickCreate] perfis:', error);
      profileSelect.innerHTML = '<option value="">— Sem perfil vinculado —</option>';
    }
  })();

  /* ---------- salvar ---------- */
  function readPayload() {
    const v = (id) => $f(id)?.value;
    const payload = {};
    TEXT_FIELDS.forEach((id) => { payload[id] = toNullableText(v(id)); });
    payload.classification_name = String(v('classification_name') || '').trim();
    RATE_FIELDS.forEach((id) => { payload[id] = toNumber(v(id)); });
    payload.fiscal_profile_id = v('fiscal_profile_id') ? Number(v('fiscal_profile_id')) : null;
    payload.is_unit = toNullableText(v('is_unit')) || 'UN';
    payload.donation_indicator = Number(v('donation_indicator') ?? 1);
    payload.is_active = true;
    return payload;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;

    const payload = readPayload();
    const { isValid, errors } = validateFiscalClassification(payload);
    if (!isValid) {
      notify(errors.map((e) => e.message).join('\n'), 'warning');
      $f(errors[0].field)?.focus();
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    try {
      const created = await createFiscalClassification(payload);
      let row = created?.data ?? created;
      const id = row?.fiscal_classification_id;
      if (!id) throw new Error('A API não devolveu o ID da classificação criada.');

      // Busca de novo para vir com o nome do perfil fiscal.
      try {
        const full = await getJson(`${base}${ROUTES.fiscalClassificationById(id)}`);
        row = { ...row, ...(full?.data ?? full) };
      } catch { /* usa o retorno do POST */ }

      close();
      notify(`Classificação #${id} cadastrada e selecionada.`, 'success');
      if (typeof onSaved === 'function') onSaved(row);
    } catch (error) {
      console.error('[fiscalClassificationQuickCreate] salvar:', error);
      notify(error?.message || 'Erro ao salvar a classificação.', 'error');
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  });

  requestAnimationFrame(() => {
    const first = $f('classification_name').value ? $f('fiscal_profile_id') : $f('classification_name');
    first?.focus();
  });

  return { modal, close };
}
