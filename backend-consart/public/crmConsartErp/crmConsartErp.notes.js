// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmConsartErp.notes.js — CRM Consart ERP                             ║
// ║ ✅ Ícone "Observações e alertas" em cada card, ao lado dos ícones    ║
// ║    WhatsApp / Ligação / E-mail                                       ║
// ║ ✅ Cinza = nada; roxo = observações; âmbar = alerta pendente;        ║
// ║    vermelho = alerta vencido (e o card fica oscilando de cor)        ║
// ║ ✅ Clique abre o modal: nova observação ou alerta (com data/hora),   ║
// ║    lista do card, concluir/reabrir alerta e excluir                  ║
// ║    (tabela crmDealNotes)                                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconSvg } from '/public/includes/js/actionIcons.js';
import { state } from '/crmDeals/js/state.js';
import { fetchJSON } from '/crmDeals/js/fetchJSON.js';
import { apiUrl } from '/crmDeals/js/config.js';

const MODAL_ID = 'crm-modal-notes';

const ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

const TYPES = Object.freeze({
  OBSERVACAO: { code: 'OBSERVACAO', label: 'Observação', css: 'crm-contact-btn--notes', svg: ICON_NOTE },
  ALERTA: { code: 'ALERTA', label: 'Alerta', css: 'crm-contact-btn--alert', svg: ICON_BELL },
});

const $ = (id) => document.getElementById(id);

// deal_id → { total, pending_alerts, overdue_alerts, next_alert_at }
const summaryByDeal = new Map();

let currentDealId = null;
let selectedType = 'OBSERVACAO';
let saving = false;

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Padrão do alerta: amanhã às 09:00
function defaultAlertAt() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

function findDeal(dealId) {
  return (state.deals || []).find((d) => String(d.id) === String(dealId)) || null;
}

function errorMessage(json) {
  return json?.error || json?.message || 'Não foi possível concluir.';
}

function isOverdue(row) {
  return row.note_type === 'ALERTA' && !row.done_at && new Date(row.alert_at) <= new Date();
}

/* --------------------------------------------------------------------- */
/* Totais por card                                                       */
/* --------------------------------------------------------------------- */

async function loadSummary() {
  const json = await fetchJSON(apiUrl('/crm/deal-notes/summary'), { noCache: true });
  if (!json?.ok) return;

  summaryByDeal.clear();
  (json.data || []).forEach((r) => summaryByDeal.set(String(r.deal_id), r));
  refreshAllCards();
}

function setDealSummary(dealId, rows) {
  const pending = rows.filter((r) => r.note_type === 'ALERTA' && !r.done_at);
  const next = pending.map((r) => r.alert_at).sort((a, b) => new Date(a) - new Date(b))[0] || null;
  summaryByDeal.set(String(dealId), {
    total: rows.length,
    pending_alerts: pending.length,
    overdue_alerts: pending.filter(isOverdue).length,
    next_alert_at: next,
  });
  refreshAllCards();
}

/* --------------------------------------------------------------------- */
/* Ícone no card                                                         */
/* --------------------------------------------------------------------- */

function paintButton(btn, info) {
  const total = info?.total || 0;
  const pending = info?.pending_alerts || 0;
  const overdue = info?.overdue_alerts || 0;

  btn.classList.toggle('is-done', total > 0);
  btn.classList.toggle('crm-contact-btn--alert', pending > 0 && !overdue);
  btn.classList.toggle('crm-contact-btn--overdue', overdue > 0);
  btn.classList.toggle('crm-contact-btn--notes', !pending);
  btn.querySelector('.crm-notes-btn__icon').innerHTML = pending > 0 ? ICON_BELL : ICON_NOTE;
  btn.querySelector('.crm-contact-btn__count').textContent = total > 0 ? String(total) : '';

  let title = 'Observações e alertas: nenhum registro';
  if (overdue > 0) title = `Observações e alertas: ${overdue} alerta(s) vencido(s)`;
  else if (pending > 0) title = `Observações e alertas: próximo alerta em ${formatDateTime(info.next_alert_at)}`;
  else if (total > 0) title = `Observações e alertas: ${total} registro(s)`;
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

function paintCard(card) {
  const info = summaryByDeal.get(String(card.dataset.id));
  // alerta vencido: o card fica oscilando de cor até o alerta ser concluído
  card.classList.toggle('crm-card--alert-overdue', (info?.overdue_alerts || 0) > 0);
  const btn = card.querySelector('.crm-notes-btn');
  if (btn) paintButton(btn, info);
}

function decorateCard(card) {
  if (!card.dataset.id || card.querySelector('.crm-notes-btn')) return;
  // a linha de ícones é criada pelo crmConsartErp.contacts.js
  const box = card.querySelector('.crm-card__contacts');
  if (!box) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'crm-contact-btn crm-contact-btn--notes crm-notes-btn';
  btn.draggable = false;
  btn.innerHTML = `<span class="crm-notes-btn__icon">${ICON_NOTE}</span><span class="crm-contact-btn__count"></span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openNotes(card.dataset.id);
  });
  box.appendChild(btn);
  paintCard(card);
}

function decorateAllCards() {
  document.querySelectorAll('#crm-kanban-stages .crm-card').forEach(decorateCard);
}

function refreshAllCards() {
  document.querySelectorAll('#crm-kanban-stages .crm-card').forEach(paintCard);
}

function watchCards() {
  const root = $('crm-kanban-stages');
  if (!root) return;

  decorateAllCards();
  new MutationObserver(decorateAllCards).observe(root, { childList: true, subtree: true });
}

/* --------------------------------------------------------------------- */
/* Modal                                                                 */
/* --------------------------------------------------------------------- */

function selectType(code) {
  selectedType = TYPES[code] ? code : 'OBSERVACAO';
  document.querySelectorAll('#crm-nt-types .crm-ct-type').forEach((b) => {
    const on = b.dataset.type === selectedType;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const isAlert = selectedType === 'ALERTA';
  $('crm-nt-alert-field').style.display = isAlert ? '' : 'none';
  $('crm-nt-note-field').classList.toggle('modal-field--span-3', isAlert);
  $('crm-nt-note-field').classList.toggle('modal-field--span-full', !isAlert);
  $('crm-nt-save').textContent = isAlert ? 'Criar alerta' : 'Salvar observação';
  $('crm-nt-note').placeholder = isAlert
    ? 'Ex.: ligar para confirmar a proposta'
    : 'Ex.: cliente prefere contato à tarde, decisor é o sócio';
}

function statusPill(r) {
  if (r.note_type !== 'ALERTA') return '';
  if (r.done_at) return '<span class="summary-pill summary-pill--success summary-height-1">Concluído</span>';
  if (isOverdue(r)) return '<span class="summary-pill summary-pill--danger summary-height-1">Vencido</span>';
  return '<span class="summary-pill summary-pill--warning summary-height-1">Pendente</span>';
}

function renderList(rows) {
  const list = $('crm-nt-list');
  $('crm-nt-count').textContent = rows.length ? `(${rows.length})` : '';

  if (!rows.length) {
    list.innerHTML = '<li class="crm-ct-history__empty">Nenhuma observação ou alerta neste card.</li>';
    return;
  }

  list.innerHTML = rows.map((r) => {
    const type = TYPES[r.note_type] || TYPES.OBSERVACAO;
    const iconCss = isOverdue(r) ? 'crm-contact-btn--overdue' : type.css;
    const by = r.created_by_name ? ` · por ${escapeHtml(r.created_by_name)}` : '';
    const when = r.note_type === 'ALERTA'
      ? `para ${formatDateTime(r.alert_at)}`
      : formatDateTime(r.created_at);
    const done = r.done_at
      ? `<div class="crm-ct-history__note">Concluído em ${formatDateTime(r.done_at)}${r.done_by_name ? ` por ${escapeHtml(r.done_by_name)}` : ''}</div>`
      : '';
    const toggle = r.note_type === 'ALERTA'
      ? (r.done_at
        ? `<button type="button" class="action-icon action-icon--cancel" data-note-reopen="${r.id}"
             title="Reabrir alerta" aria-label="Reabrir alerta">${actionIconSvg('cancel')}</button>`
        : `<button type="button" class="action-icon action-icon--confirm" data-note-done="${r.id}"
             title="Concluir alerta" aria-label="Concluir alerta">${actionIconSvg('confirm')}</button>`)
      : '';
    return `
      <li class="crm-ct-history__item">
        <span class="crm-ct-history__icon ${iconCss} is-done">${type.svg}</span>
        <div class="crm-ct-history__text">
          <div class="crm-ct-history__head"><strong>${escapeHtml(type.label)}</strong> · ${when}${by} ${statusPill(r)}</div>
          <div class="crm-ct-history__note">${escapeHtml(r.note)}</div>
          ${done}
        </div>
        ${toggle}
        <button type="button" class="action-icon action-icon--delete" data-note-delete="${r.id}"
          title="Excluir" aria-label="Excluir">${actionIconSvg('delete')}</button>
      </li>`;
  }).join('');
}

async function loadList() {
  const json = await fetchJSON(apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/notes`), { noCache: true });
  if (!json?.ok) throw new Error(errorMessage(json));
  const rows = json.data || [];
  renderList(rows);
  setDealSummary(currentDealId, rows);
}

async function openNotes(dealId) {
  currentDealId = dealId;
  const deal = findDeal(dealId);
  $('crmNotesTitle').textContent = `Observações e alertas — ${deal?.customer_name || 'Cliente'}`;

  selectType('OBSERVACAO');
  $('crm-nt-alert-at').value = defaultAlertAt();
  $('crm-nt-note').value = '';
  $('crm-nt-list').innerHTML = '<li class="crm-ct-history__empty">Carregando...</li>';

  Modal.setup();
  Modal.open(MODAL_ID, { focusSelector: '#crm-nt-note' });

  try {
    await loadList();
  } catch (err) {
    $('crm-nt-list').innerHTML = `<li class="crm-ct-history__empty">${escapeHtml(err.message)}</li>`;
  }
}

async function saveNote(e) {
  e?.preventDefault();
  if (saving || !currentDealId) return;

  const note = $('crm-nt-note').value.trim();
  if (!note) {
    showCenterModal({ variant: 'warning', title: 'Observações e alertas', message: 'Escreva o texto antes de salvar.' });
    return;
  }

  const payload = { note_type: selectedType, note };
  if (selectedType === 'ALERTA') {
    const v = $('crm-nt-alert-at').value;
    if (!v) {
      showCenterModal({ variant: 'warning', title: 'Observações e alertas', message: 'Informe a data e hora do alerta.' });
      return;
    }
    payload.alert_at = new Date(v).toISOString();
  }

  saving = true;
  $('crm-nt-save').disabled = true;
  try {
    const json = await fetchJSON(apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/notes`), {
      method: 'POST',
      body: payload,
    });
    if (!json?.ok) throw new Error(errorMessage(json));

    $('crm-nt-note').value = '';
    $('crm-nt-alert-at').value = defaultAlertAt();
    await loadList();
  } catch (err) {
    showCenterModal({ variant: 'error', title: 'Observações e alertas', message: err.message });
  } finally {
    saving = false;
    $('crm-nt-save').disabled = false;
  }
}

async function setDone(noteId, done) {
  const json = await fetchJSON(
    apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/notes/${encodeURIComponent(noteId)}/done`),
    { method: 'PATCH', body: { done } }
  );
  if (!json?.ok) {
    showCenterModal({ variant: 'error', title: 'Alerta', message: errorMessage(json) });
    return;
  }
  await loadList();
}

async function deleteNote(noteId) {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Confirmar exclusão',
    message: 'Excluir este registro do card?',
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;
  const json = await fetchJSON(
    apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/notes/${encodeURIComponent(noteId)}`),
    { method: 'DELETE' }
  );
  if (!json?.ok) {
    showCenterModal({ variant: 'error', title: 'Observações e alertas', message: errorMessage(json) });
    return;
  }
  await loadList();
}

/* --------------------------------------------------------------------- */
/* Init                                                                  */
/* --------------------------------------------------------------------- */

function init() {
  document.querySelectorAll('#crm-nt-types .crm-ct-type').forEach((b) => {
    b.insertAdjacentHTML('afterbegin', TYPES[b.dataset.type]?.svg || '');
  });
  $('crm-nt-types')?.addEventListener('click', (e) => {
    const b = e.target.closest('.crm-ct-type');
    if (b) selectType(b.dataset.type);
  });
  $('crm-notes-form')?.addEventListener('submit', saveNote);
  $('crm-nt-list')?.addEventListener('click', (e) => {
    const done = e.target.closest('[data-note-done]');
    if (done) return setDone(done.dataset.noteDone, true);
    const reopen = e.target.closest('[data-note-reopen]');
    if (reopen) return setDone(reopen.dataset.noteReopen, false);
    const del = e.target.closest('[data-note-delete]');
    if (del) deleteNote(del.dataset.noteDelete);
  });

  watchCards();
  loadSummary();
  // alertas que vencem com a tela aberta mudam de cor sem recarregar
  setInterval(loadSummary, 5 * 60 * 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
