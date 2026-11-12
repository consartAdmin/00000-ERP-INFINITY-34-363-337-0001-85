// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashMoviments.fiscalDocuments.js — Vincular pagamentos a uma nota    ║
// ║ CONSART ERP | Caixa                                                  ║
// ║ - Uma NF-e/NFS-e cobre vários pagamentos (ex.: 3 pagamentos no mês,  ║
// ║   1 NFS-e). O PDF/XML fica na nota e aparece em todos os pagamentos. ║
// ║ - "Vincular nota (N)": nova nota ou nota já cadastrada               ║
// ║ - Chip "NFS-e 123 · 1/3" na lista: abre a nota para editar           ║
// ║ - API: /api/caixa/notas-fiscais                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API } from './cashMoviments.config.js';
import { LE, fmtBRL } from './cashMoviments.utils.js';
import { fetchCashDocumentTypes } from './cashMoviments.documentTypes.js';
import {
  getSelectedMovementIds,
  clearMovementSelection,
  recarregarLista,
} from './cashMoviments.list.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const MODAL_ID = 'cashFiscalDocumentModal';
const API_NOTAS = `${API}/notas-fiscais`;
const ACCEPT = '.pdf,.xml,.png,.jpg,.jpeg,.webp';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const toCents = (v) => Math.round(Number(v || 0) * 100);

function fmtDate(value) {
  if (!value) return '';
  const text = String(value);
  const ymd = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && text.length <= 10) {
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
}

function toInputDate(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text.slice(0, 10)) && text.length <= 10) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function notaLabel(tipo, numero) {
  return [tipo || 'Nota', numero].filter(Boolean).join(' ');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
  }
  return body;
}

function ensureStyles() {
  if (document.getElementById('fdm-styles')) return;
  const style = document.createElement('style');
  style.id = 'fdm-styles';
  style.textContent = `
    #${MODAL_ID} { --modal-z-index: 1200; }
    #${MODAL_ID} [hidden] { display: none !important; }
    #${MODAL_ID} .fdm-section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
    #${MODAL_ID} .fdm-section h4 { margin: 0 0 8px; color: #64748b; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    #${MODAL_ID} .fdm-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 10px; }
    #${MODAL_ID} .fdm-grid--2 { grid-template-columns: 3fr 1fr; margin-top: 8px; }
    #${MODAL_ID} .fdm-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    #${MODAL_ID} .fdm-field label { font-size: 11px; color: #475569; }
    #${MODAL_ID} .fdm-field input, #${MODAL_ID} .fdm-field select, #${MODAL_ID} .fdm-field textarea { box-sizing: border-box; width: 100%; min-width: 0; }
    #${MODAL_ID} .fdm-seg { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
    #${MODAL_ID} .fdm-seg button { border: 0; background: #fff; padding: 5px 12px; font-size: 12px; cursor: pointer; }
    #${MODAL_ID} .fdm-seg button.is-on { background: #6d28d9; color: #fff; }
    #${MODAL_ID} .fdm-files { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
    #${MODAL_ID} .fdm-file { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #ddd6fe; background: #faf5ff; color: #5b21b6; border-radius: 6px; padding: 3px 8px; font-size: 12px; }
    #${MODAL_ID} .fdm-file a { color: inherit; }
    #${MODAL_ID} .fdm-file button { border: 0; background: none; color: #b91c1c; cursor: pointer; font-size: 13px; padding: 0 2px; }
    #${MODAL_ID} .fdm-drop { border: 2px dashed #c4b5fd; border-radius: 8px; padding: 8px; text-align: center; color: #6d28d9; background: #faf5ff; cursor: pointer; font-size: 12px; margin-top: 8px; }
    #${MODAL_ID} .fdm-drop.is-over { background: #ede9fe; }
    #${MODAL_ID} .fdm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #${MODAL_ID} .fdm-table td, #${MODAL_ID} .fdm-table th { padding: 5px 6px; border-bottom: 1px solid #eef2f7; text-align: left; }
    #${MODAL_ID} .fdm-table th { color: #64748b; font-weight: 600; font-size: 11px; }
    #${MODAL_ID} .fdm-table .r { text-align: right; white-space: nowrap; }
    #${MODAL_ID} .fdm-table tr.is-new td { background: #f5f3ff; }
    #${MODAL_ID} .fdm-unlink { border: 0; background: none; color: #b91c1c; cursor: pointer; font-size: 12px; }
    #${MODAL_ID} .fdm-check { margin-top: 8px; border-radius: 6px; padding: 7px 10px; font-weight: 600; font-size: 12px; }
    #${MODAL_ID} .fdm-check--ok { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
    #${MODAL_ID} .fdm-check--warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
    #${MODAL_ID} .fdm-check--err { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
    #${MODAL_ID} .fdm-note { margin: 6px 0 0; color: #92400e; font-size: 12px; }
    #${MODAL_ID} .fdm-results { max-height: 180px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; margin-top: 6px; }
    #${MODAL_ID} .fdm-result { display: grid; grid-template-columns: 20px 1.2fr 2fr 1fr; gap: 8px; align-items: center; padding: 6px 8px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 12px; }
    #${MODAL_ID} .fdm-result:hover, #${MODAL_ID} .fdm-result.is-on { background: #f5f3ff; }
    #${MODAL_ID} .fdm-empty { padding: 10px; color: #94a3b8; font-size: 12px; text-align: center; }
    #${MODAL_ID} .fdm-footer-left { margin-right: auto; }
    @media (max-width: 760px) {
      #${MODAL_ID} .fdm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      #${MODAL_ID} .fdm-grid--2 { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function buildModal(title) {
  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'modal is-open';
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-7" role="dialog" aria-modal="true" aria-labelledby="fdmTitle">
        <header class="modal__header modal-header-color-3">
          <h3 id="fdmTitle" class="modal__title">${escapeHtml(title)}</h3>
          <button class="modal__close" type="button" data-close aria-label="Fechar" title="Fechar">&times;</button>
        </header>

        <div class="modal__body">
          <form id="fdmForm" novalidate>
            <div class="fdm-section">
              <h4>Nota fiscal</h4>
              <div class="fdm-seg" id="fdmModeSeg" hidden>
                <button type="button" data-mode="new" class="is-on">Nova nota</button>
                <button type="button" data-mode="existing">Nota já cadastrada</button>
              </div>

              <div id="fdmExisting" hidden>
                <div class="fdm-field">
                  <label for="fdmSearch">Buscar nota (número, emitente ou CNPJ)</label>
                  <input type="search" id="fdmSearch" placeholder="Ex.: 123 ou BRENDON" autocomplete="off" />
                </div>
                <div class="fdm-results" id="fdmResults"><div class="fdm-empty">Carregando...</div></div>
              </div>

              <div id="fdmFields">
                <div class="fdm-grid">
                  <div class="fdm-field">
                    <label for="fdmTipo">Tipo</label>
                    <select id="fdmTipo"></select>
                  </div>
                  <div class="fdm-field">
                    <label for="fdmNumero">Número</label>
                    <input type="text" id="fdmNumero" maxlength="60" required />
                  </div>
                  <div class="fdm-field">
                    <label for="fdmEmissao">Emissão</label>
                    <input type="date" id="fdmEmissao" />
                  </div>
                  <div class="fdm-field">
                    <label for="fdmValor">Valor da nota (R$)</label>
                    <input type="number" id="fdmValor" step="0.01" min="0" />
                  </div>
                </div>
                <div class="fdm-grid fdm-grid--2">
                  <div class="fdm-field">
                    <label for="fdmEmitente">Emitente</label>
                    <input type="text" id="fdmEmitente" maxlength="255" />
                  </div>
                  <div class="fdm-field">
                    <label for="fdmCnpj">CNPJ/CPF</label>
                    <input type="text" id="fdmCnpj" maxlength="18" inputmode="numeric" />
                  </div>
                </div>

                <div class="fdm-files" id="fdmFiles"></div>
                <div class="fdm-drop" id="fdmDrop" tabindex="0" role="button">
                  📎 Anexar PDF/XML da nota (clique ou arraste). Fica uma vez só na nota e aparece em todos os pagamentos.
                </div>
                <input type="file" id="fdmFileInput" accept="${ACCEPT}" multiple hidden />
              </div>
            </div>

            <div class="fdm-section">
              <h4>Pagamentos desta nota</h4>
              <table class="fdm-table">
                <thead><tr><th>Data</th><th>Fornecedor/Cliente</th><th>Observação</th><th class="r">Valor</th><th></th></tr></thead>
                <tbody id="fdmPayments"></tbody>
              </table>
              <div id="fdmMoved"></div>
              <div id="fdmCheck"></div>
            </div>
          </form>
        </div>

        <footer class="modal__footer modal-footer-color-3">
          <button class="btn btn-danger btn-sm fdm-footer-left" type="button" id="fdmDelete" style="display:none">🗑️ Excluir nota</button>
          <button class="btn btn-cancel btn-sm" type="button" data-close>Cancelar</button>
          <button class="btn btn-save btn-sm" type="submit" form="fdmForm" id="fdmSubmit">Vincular</button>
        </footer>
      </section>
    </div>
  `;
  return root;
}

/**
 * Abre o modal.
 * - { ids }    → pagamentos selecionados na lista (nova nota ou já cadastrada)
 * - { notaId } → nota já vinculada (clique no chip da lista)
 */
export async function openFiscalDocumentModal(dom, { ids = null, notaId = null } = {}) {
  const selectedIds = ids ?? (notaId ? [] : getSelectedMovementIds());
  if (!notaId && !selectedIds.length) return;

  ensureStyles();
  document.getElementById(MODAL_ID)?.remove();

  // Estado do modal
  const st = {
    mode: notaId ? 'edit' : 'new',  // new | existing | edit
    nota: null,                      // nota carregada (existing/edit)
    selected: [],                    // pagamentos selecionados na lista
    unlink: new Set(),               // pagamentos da nota a desvincular
    pendingFiles: [],                // arquivos a enviar depois de salvar
    removeAnexos: new Set(),         // anexos da nota a excluir
  };

  const root = buildModal(notaId
    ? 'Nota fiscal vinculada'
    : `Vincular ${selectedIds.length} pagamento(s) a uma nota fiscal`);
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const el = {
    seg: $('#fdmModeSeg'),
    existing: $('#fdmExisting'),
    search: $('#fdmSearch'),
    results: $('#fdmResults'),
    fields: $('#fdmFields'),
    tipo: $('#fdmTipo'),
    numero: $('#fdmNumero'),
    emissao: $('#fdmEmissao'),
    valor: $('#fdmValor'),
    emitente: $('#fdmEmitente'),
    cnpj: $('#fdmCnpj'),
    files: $('#fdmFiles'),
    drop: $('#fdmDrop'),
    fileInput: $('#fdmFileInput'),
    payments: $('#fdmPayments'),
    moved: $('#fdmMoved'),
    check: $('#fdmCheck'),
    submit: $('#fdmSubmit'),
    del: $('#fdmDelete'),
  };

  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    root.remove();
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.center-modal-overlay, .cm-overlay')) return;
    event.preventDefault();
    close();
  }

  root.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
  document.addEventListener('keydown', onKeydown, true);

  /* ---------- Render ---------- */

  function paymentsInView() {
    const fromNota = (st.nota?.pagamentos || [])
      .filter((p) => !st.unlink.has(Number(p.id)))
      .map((p) => ({ ...p, isNew: false }));
    const known = new Set(fromNota.map((p) => Number(p.id)));
    const added = st.selected
      .filter((p) => !known.has(Number(p.id)))
      .map((p) => ({ ...p, isNew: st.mode !== 'new' }));
    return [...fromNota, ...added]
      .sort((a, b) => String(a.data_hora).localeCompare(String(b.data_hora)) || a.id - b.id);
  }

  function renderPayments() {
    const rows = paymentsInView();
    const canUnlink = st.mode === 'edit';

    el.payments.innerHTML = rows.length
      ? rows.map((p) => `
          <tr class="${p.isNew ? 'is-new' : ''}">
            <td>${escapeHtml(fmtDate(p.data_hora))}</td>
            <td>${escapeHtml(p.fornecedor || '')}</td>
            <td>${escapeHtml(p.observacao || '')}${p.isNew ? ' <em>(novo)</em>' : ''}</td>
            <td class="r">${fmtBRL(p.valor)}</td>
            <td class="r">${canUnlink && !p.isNew
              ? `<button type="button" class="fdm-unlink" data-unlink="${p.id}" title="Tirar este pagamento da nota">Desvincular</button>`
              : ''}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="fdm-empty">Nenhum pagamento.</td></tr>';

    // Pagamentos que estão em outra nota e vão mudar para esta
    const targetId = st.nota?.id ?? null;
    const moved = st.selected.filter((p) => p.fiscal_document_id && Number(p.fiscal_document_id) !== Number(targetId));
    el.moved.innerHTML = moved.length
      ? `<p class="fdm-note">⚠️ ${moved.length === 1 ? '1 pagamento já está' : `${moved.length} pagamentos já estão`} em outra nota (${
        [...new Set(moved.map((p) => escapeHtml(notaLabel(p.nota_tipo, p.nota_numero))))].join(', ')
      }) e ${moved.length === 1 ? 'será movido' : 'serão movidos'} para esta.</p>`
      : '';

    const soma = rows.reduce((acc, p) => acc + toCents(p.valor), 0);
    const valorNota = el.valor.value === '' ? null : toCents(el.valor.value);

    if (valorNota === null) {
      el.check.innerHTML = `<div class="fdm-check fdm-check--warn">Soma dos pagamentos ${fmtBRL(soma / 100)}. Informe o valor da nota para conferir.</div>`;
    } else if (soma === valorNota) {
      el.check.innerHTML = `<div class="fdm-check fdm-check--ok">✓ Soma dos pagamentos ${fmtBRL(soma / 100)} = valor da nota ${fmtBRL(valorNota / 100)}</div>`;
    } else if (soma < valorNota) {
      el.check.innerHTML = `<div class="fdm-check fdm-check--warn">Soma dos pagamentos ${fmtBRL(soma / 100)} · faltam ${fmtBRL((valorNota - soma) / 100)} para o valor da nota ${fmtBRL(valorNota / 100)}</div>`;
    } else {
      el.check.innerHTML = `<div class="fdm-check fdm-check--err">Soma dos pagamentos ${fmtBRL(soma / 100)} passa ${fmtBRL((soma - valorNota) / 100)} do valor da nota ${fmtBRL(valorNota / 100)}</div>`;
    }
  }

  function renderFiles() {
    const saved = (st.nota?.anexos || [])
      .filter((a) => !st.removeAnexos.has(Number(a.id)))
      .map((a) => `
        <span class="fdm-file">📎 <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.file_name || a.filename)}</a>
          ${st.mode === 'edit' ? `<button type="button" data-del-anexo="${a.id}" title="Excluir anexo" aria-label="Excluir anexo">✕</button>` : ''}
        </span>`);
    const pending = st.pendingFiles.map((f, i) => `
        <span class="fdm-file">⬆️ ${escapeHtml(f.name)}
          <button type="button" data-del-pending="${i}" title="Remover" aria-label="Remover">✕</button>
        </span>`);
    el.files.innerHTML = [...saved, ...pending].join('');
    el.drop.hidden = st.mode === 'existing';
  }

  function fillFields(nota) {
    if (nota.document_type && ![...el.tipo.options].some((o) => o.value === nota.document_type)) {
      el.tipo.add(new Option(nota.document_type, nota.document_type));
    }
    el.tipo.value = nota.document_type || el.tipo.value;
    el.numero.value = nota.document_number || '';
    el.emissao.value = toInputDate(nota.issue_date);
    el.valor.value = nota.total_amount ?? '';
    el.emitente.value = nota.issuer_name || '';
    el.cnpj.value = nota.issuer_tax_id || '';
  }

  function setFieldsReadOnly(readOnly) {
    [el.tipo, el.numero, el.emissao, el.valor, el.emitente, el.cnpj].forEach((input) => {
      input.disabled = readOnly;
    });
  }

  function defaultsFromSelection() {
    const soma = st.selected.reduce((acc, p) => acc + toCents(p.valor), 0);
    const lastDate = st.selected.map((p) => toInputDate(p.data_hora)).filter(Boolean).sort().pop() || '';
    el.numero.value = '';
    el.emissao.value = lastDate;
    el.valor.value = soma ? (soma / 100).toFixed(2) : '';
    el.emitente.value = st.selected.find((p) => p.fornecedor)?.fornecedor || '';
    el.cnpj.value = '';
  }

  function setMode(mode) {
    st.mode = mode;
    el.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
    el.existing.hidden = mode !== 'existing';

    if (mode === 'new') {
      st.nota = null;
      setFieldsReadOnly(false);
      defaultsFromSelection();
    } else if (mode === 'existing') {
      st.nota = null;
      setFieldsReadOnly(true);
      [el.numero, el.emissao, el.valor, el.emitente, el.cnpj].forEach((i) => { i.value = ''; });
      searchNotas();
    }

    el.submit.textContent = mode === 'edit' ? 'Salvar' : 'Vincular';
    el.del.style.display = mode === 'edit' ? '' : 'none';
    renderFiles();
    renderPayments();
  }

  /* ---------- Busca de nota já cadastrada ---------- */

  let searchTimer = null;
  let searchSeq = 0;

  async function searchNotas() {
    const seq = ++searchSeq;
    el.results.innerHTML = '<div class="fdm-empty">Carregando...</div>';
    try {
      const term = el.search.value.trim();
      const body = await fetchJson(`${API_NOTAS}?search=${encodeURIComponent(term)}&limit=30`);
      if (seq !== searchSeq) return;
      const rows = body.rows || [];
      el.results.innerHTML = rows.length
        ? rows.map((n) => `
            <div class="fdm-result ${Number(st.nota?.id) === Number(n.id) ? 'is-on' : ''}" data-nota="${n.id}">
              <input type="radio" name="fdmNota" ${Number(st.nota?.id) === Number(n.id) ? 'checked' : ''} aria-label="Escolher nota" />
              <strong>${escapeHtml(notaLabel(n.document_type, n.document_number))}</strong>
              <span>${escapeHtml(n.issuer_name || '')} ${n.issue_date ? `· ${escapeHtml(fmtDate(n.issue_date))}` : ''}</span>
              <span class="r">${n.total_amount != null ? fmtBRL(n.total_amount) : '—'} · ${n.pagamentos_count} pag.</span>
            </div>`).join('')
        : '<div class="fdm-empty">Nenhuma nota encontrada.</div>';
    } catch (err) {
      LE('[NOTA] busca', err);
      el.results.innerHTML = '<div class="fdm-empty">Erro ao buscar notas.</div>';
    }
  }

  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchNotas, 300);
  });

  el.results.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-nota]');
    if (!item) return;
    try {
      const body = await fetchJson(`${API_NOTAS}/${item.dataset.nota}`);
      st.nota = body.nota;
      fillFields(st.nota);
      el.results.querySelectorAll('.fdm-result').forEach((r) => {
        const on = r === item;
        r.classList.toggle('is-on', on);
        r.querySelector('input').checked = on;
      });
      renderFiles();
      renderPayments();
    } catch (err) {
      LE('[NOTA] abrir', err);
      showCenterModal({ variant: 'error', title: 'Erro', message: escapeHtml(err.message) });
    }
  });

  el.seg.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-mode]');
    if (btn && btn.dataset.mode !== st.mode) setMode(btn.dataset.mode);
  });

  /* ---------- Anexos ---------- */

  function addFiles(list) {
    const allowed = /\.(pdf|xml|png|jpe?g|webp)$/i;
    [...(list || [])].forEach((file) => {
      if (allowed.test(file.name)) st.pendingFiles.push(file);
    });
    renderFiles();
  }

  el.drop.addEventListener('click', () => el.fileInput.click());
  el.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); } });
  el.drop.addEventListener('dragover', (e) => { e.preventDefault(); el.drop.classList.add('is-over'); });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('is-over'));
  el.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    el.drop.classList.remove('is-over');
    addFiles(e.dataTransfer?.files);
  });
  el.fileInput.addEventListener('change', () => {
    addFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  el.files.addEventListener('click', (event) => {
    const pending = event.target.closest('[data-del-pending]');
    if (pending) {
      st.pendingFiles.splice(Number(pending.dataset.delPending), 1);
      renderFiles();
      return;
    }
    const saved = event.target.closest('[data-del-anexo]');
    if (saved) {
      st.removeAnexos.add(Number(saved.dataset.delAnexo));
      renderFiles();
    }
  });

  el.payments.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-unlink]');
    if (!btn) return;
    st.unlink.add(Number(btn.dataset.unlink));
    renderPayments();
  });

  el.valor.addEventListener('input', renderPayments);

  /* ---------- Salvar ---------- */

  async function uploadPendingFiles(docId) {
    const failed = [];
    for (const file of st.pendingFiles) {
      const form = new FormData();
      form.append('arquivo', file, file.name);
      try {
        await fetchJson(`${API_NOTAS}/${docId}/anexos`, { method: 'POST', body: form });
      } catch (err) {
        LE('[NOTA] upload', err);
        failed.push(file.name);
      }
    }
    return failed;
  }

  function payload() {
    return {
      document_type: el.tipo.value,
      document_number: el.numero.value.trim(),
      issue_date: el.emissao.value || null,
      total_amount: el.valor.value === '' ? null : Number(el.valor.value),
      issuer_name: el.emitente.value.trim(),
      issuer_tax_id: el.cnpj.value.trim(),
    };
  }

  async function finish(message, failed = []) {
    close();
    clearMovementSelection(dom);
    await recarregarLista(dom);
    showCenterModal({
      variant: failed.length ? 'warning' : 'success',
      title: failed.length ? 'Nota salva, mas alguns anexos falharam' : 'Nota fiscal vinculada',
      message: failed.length
        ? `${message}<br>Não foi possível enviar: ${failed.map(escapeHtml).join(', ')}`
        : message,
    });
  }

  $('#fdmForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const selectedPaymentIds = st.selected.map((p) => Number(p.id));

    if (st.mode === 'existing' && !st.nota) {
      showCenterModal({ variant: 'warning', title: 'Escolha a nota', message: 'Selecione uma nota da lista.' });
      return;
    }
    if (st.mode !== 'existing' && !el.numero.value.trim()) {
      showCenterModal({ variant: 'warning', title: 'Número da nota', message: 'Informe o número da nota.' });
      el.numero.focus();
      return;
    }

    const original = el.submit.textContent;
    el.submit.disabled = true;
    el.submit.textContent = '⏳ Salvando...';

    try {
      let nota;
      if (st.mode === 'new') {
        const body = await fetchJson(API_NOTAS, {
          method: 'POST',
          body: JSON.stringify({ ...payload(), movement_ids: selectedPaymentIds }),
        });
        nota = body.nota;
      } else if (st.mode === 'existing') {
        const body = await fetchJson(`${API_NOTAS}/${st.nota.id}/vincular`, {
          method: 'POST',
          body: JSON.stringify({ ids: selectedPaymentIds }),
        });
        nota = body.nota;
      } else {
        const body = await fetchJson(`${API_NOTAS}/${st.nota.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload()),
        });
        nota = body.nota;
        if (st.unlink.size) {
          await fetchJson(`${API_NOTAS}/desvincular`, {
            method: 'POST',
            body: JSON.stringify({ ids: [...st.unlink] }),
          });
        }
        for (const anexoId of st.removeAnexos) {
          await fetchJson(`${API_NOTAS}/${nota.id}/anexos/${anexoId}`, { method: 'DELETE' });
        }
      }

      const failed = await uploadPendingFiles(nota.id);
      const label = escapeHtml(notaLabel(nota.document_type, nota.document_number));
      const count = st.mode === 'edit'
        ? Number(nota.pagamentos_count || 0) - st.unlink.size
        : Number(nota.pagamentos_count || 0);
      await finish(`<b>${label}</b> com ${count} pagamento(s).`, failed);
    } catch (err) {
      LE('[NOTA] salvar', err);
      showCenterModal({
        variant: 'error',
        title: 'Erro ao salvar a nota',
        message: escapeHtml(err?.message || 'Falha ao comunicar com a API.'),
      });
    } finally {
      el.submit.disabled = false;
      el.submit.textContent = original;
    }
  });

  el.del.addEventListener('click', async () => {
    if (!st.nota) return;
    const ok = await showCenterModal({
      variant: 'warning',
      title: 'Excluir nota fiscal?',
      message: `A <b>${escapeHtml(notaLabel(st.nota.document_type, st.nota.document_number))}</b> e os anexos dela serão excluídos. Os pagamentos continuam no caixa, só sem nota.`,
      okText: 'Sim, excluir',
      closeText: 'Cancelar',
    });
    if (ok !== true) return;
    try {
      await fetchJson(`${API_NOTAS}/${st.nota.id}`, { method: 'DELETE' });
      close();
      await recarregarLista(dom);
      showCenterModal({ variant: 'success', title: 'Nota excluída', message: 'Os pagamentos ficaram sem nota.' });
    } catch (err) {
      LE('[NOTA] excluir', err);
      showCenterModal({ variant: 'error', title: 'Erro ao excluir', message: escapeHtml(err.message) });
    }
  });

  /* ---------- Carga inicial ---------- */

  try {
    const [types] = await Promise.all([
      fetchCashDocumentTypes().catch(() => []),
    ]);
    const names = types.map((t) => String(t.name || '').trim()).filter(Boolean);
    ['NFS-e', 'NF-e'].forEach((n) => { if (!names.includes(n)) names.push(n); });
    names.forEach((n) => el.tipo.add(new Option(n, n)));
    el.tipo.value = 'NFS-e';

    if (notaId) {
      const body = await fetchJson(`${API_NOTAS}/${notaId}`);
      st.nota = body.nota;
      fillFields(st.nota);
      setMode('edit');
      return;
    }

    const body = await fetchJson(`${API_NOTAS}/pagamentos?ids=${selectedIds.join(',')}`);
    st.selected = body.rows || [];

    // Todos já na mesma nota: abre direto a nota
    const notaIds = [...new Set(st.selected.map((p) => p.fiscal_document_id).filter(Boolean))];
    if (notaIds.length === 1 && st.selected.every((p) => p.fiscal_document_id)) {
      const nota = await fetchJson(`${API_NOTAS}/${notaIds[0]}`);
      st.nota = nota.nota;
      st.selected = [];
      fillFields(st.nota);
      setMode('edit');
      return;
    }

    el.seg.hidden = false;
    setMode('new');
    el.numero.focus();
  } catch (err) {
    LE('[NOTA] carregar', err);
    close();
    showCenterModal({
      variant: 'error',
      title: 'Erro ao abrir a nota fiscal',
      message: escapeHtml(err?.message || 'Falha ao comunicar com a API.'),
    });
  }
}
