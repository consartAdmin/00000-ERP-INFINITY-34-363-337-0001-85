// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmConsartErp.contacts.js — CRM Consart ERP                          ║
// ║ ✅ Ícones WhatsApp / Ligação / E-mail em cada card                   ║
// ║ ✅ Cinza = nenhum contato; colorido com o total = já feito           ║
// ║ ✅ Clique abre o modal: registrar contato (data + observação) e ver  ║
// ║    o histórico do card (tabela crmDealContacts)                      ║
// ║ ✅ Só carregado pelo crmConsartErp.html: o CRM da BH3 fica igual     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconSvg } from '/public/includes/js/actionIcons.js';
import { state } from '/crmDeals/js/state.js';
import { fetchJSON } from '/crmDeals/js/fetchJSON.js';
import { apiUrl } from '/crmDeals/js/config.js';

const MODAL_ID = 'crm-modal-contacts';

const TYPES = Object.freeze([
  {
    code: 'WHATSAPP',
    label: 'WhatsApp',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.65-3.8A9 9 0 1 1 7.6 20.3L3 21"/><path d="M9 8.5c.3 3 2.5 5.2 5.5 5.5l1-1.4 1.6.8-.3 1.4c-3.6.4-7.3-3.3-6.9-6.9l1.4-.3.8 1.6z"/></svg>',
  },
  {
    code: 'LIGACAO',
    label: 'Ligação',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  },
  {
    code: 'EMAIL',
    label: 'E-mail',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>',
  },
]);

const TYPE_BY_CODE = Object.fromEntries(TYPES.map((t) => [t.code, t]));

const $ = (id) => document.getElementById(id);

// deal_id → { WHATSAPP: { total, last_at }, ... }
const summaryByDeal = new Map();

let currentDealId = null;
let selectedType = 'WHATSAPP';
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

// valor para <input type="datetime-local"> na hora local
function toLocalInput(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function findDeal(dealId) {
  return (state.deals || []).find((d) => String(d.id) === String(dealId)) || null;
}

function errorMessage(json) {
  return json?.error || json?.message || 'Não foi possível concluir.';
}

/* --------------------------------------------------------------------- */
/* Totais por card                                                       */
/* --------------------------------------------------------------------- */

async function loadSummary() {
  const json = await fetchJSON(apiUrl('/crm/deal-contacts/summary'), { noCache: true });
  if (!json?.ok) return;

  summaryByDeal.clear();
  (json.data || []).forEach((r) => {
    const key = String(r.deal_id);
    if (!summaryByDeal.has(key)) summaryByDeal.set(key, {});
    summaryByDeal.get(key)[r.contact_type] = { total: r.total, last_at: r.last_at };
  });
  refreshAllCards();
}

function setDealSummary(dealId, rows) {
  const s = {};
  rows.forEach((r) => {
    const cur = s[r.contact_type] || { total: 0, last_at: null };
    cur.total += 1;
    if (!cur.last_at || new Date(r.contacted_at) > new Date(cur.last_at)) cur.last_at = r.contacted_at;
    s[r.contact_type] = cur;
  });
  summaryByDeal.set(String(dealId), s);
  refreshAllCards();
}

/* --------------------------------------------------------------------- */
/* Ícones no card                                                        */
/* --------------------------------------------------------------------- */

function paintButton(btn, info, type) {
  const total = info?.total || 0;
  btn.classList.toggle('is-done', total > 0);
  btn.querySelector('.crm-contact-btn__count').textContent = total > 0 ? String(total) : '';
  const title = total > 0
    ? `${type.label}: ${total} contato(s), último em ${formatDateTime(info.last_at)}`
    : `${type.label}: nenhum contato registrado`;
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

function paintCard(card) {
  const box = card.querySelector('.crm-card__contacts');
  if (!box) return;
  const s = summaryByDeal.get(String(card.dataset.id)) || {};
  box.querySelectorAll('.crm-contact-btn').forEach((btn) => {
    const type = TYPE_BY_CODE[btn.dataset.type];
    paintButton(btn, s[type.code], type);
  });
}

function decorateCard(card) {
  if (card.querySelector('.crm-card__contacts')) return;
  if (!card.dataset.id) return;

  const footer = card.querySelector('.crm-card__footer');
  if (!footer) return;

  const box = document.createElement('div');
  box.className = 'crm-card__contacts';
  box.dataset.ignoreCardClick = '';

  TYPES.forEach((type) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `crm-contact-btn crm-contact-btn--${type.code.toLowerCase()}`;
    btn.dataset.type = type.code;
    btn.draggable = false;
    btn.innerHTML = `${type.svg}<span class="crm-contact-btn__count"></span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openContacts(card.dataset.id, type.code);
    });
    box.appendChild(btn);
  });

  footer.parentNode.insertBefore(box, footer);
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
  selectedType = TYPE_BY_CODE[code] ? code : 'WHATSAPP';
  document.querySelectorAll('#crm-ct-types .crm-ct-type').forEach((b) => {
    const on = b.dataset.type === selectedType;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderHistory(rows) {
  const list = $('crm-ct-history');
  $('crm-ct-history-count').textContent = rows.length ? `(${rows.length})` : '';

  if (!rows.length) {
    list.innerHTML = '<li class="crm-ct-history__empty">Nenhum contato registrado neste card.</li>';
    return;
  }

  list.innerHTML = rows.map((r) => {
    const type = TYPE_BY_CODE[r.contact_type] || TYPES[0];
    const by = r.created_by_name ? ` · por ${escapeHtml(r.created_by_name)}` : '';
    return `
      <li class="crm-ct-history__item">
        <span class="crm-ct-history__icon crm-contact-btn--${type.code.toLowerCase()} is-done">${type.svg}</span>
        <div class="crm-ct-history__text">
          <div class="crm-ct-history__head"><strong>${escapeHtml(type.label)}</strong> · ${formatDateTime(r.contacted_at)}${by}</div>
          ${r.note ? `<div class="crm-ct-history__note">${escapeHtml(r.note)}</div>` : ''}
        </div>
        <button type="button" class="action-icon action-icon--delete" data-contact-id="${r.id}"
          title="Excluir este contato" aria-label="Excluir este contato">${actionIconSvg('delete')}</button>
      </li>`;
  }).join('');
}

async function loadHistory() {
  const json = await fetchJSON(apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/contacts`), { noCache: true });
  if (!json?.ok) throw new Error(errorMessage(json));
  const rows = json.data || [];
  renderHistory(rows);
  setDealSummary(currentDealId, rows);
}

async function openContacts(dealId, typeCode) {
  currentDealId = dealId;
  const deal = findDeal(dealId);
  $('crmContactsTitle').textContent = `Contatos — ${deal?.customer_name || 'Cliente'}`;

  selectType(typeCode);
  $('crm-ct-date').value = toLocalInput();
  $('crm-ct-note').value = '';
  $('crm-ct-history').innerHTML = '<li class="crm-ct-history__empty">Carregando...</li>';

  Modal.setup();
  Modal.open(MODAL_ID, { focusSelector: '#crm-ct-note' });

  try {
    await loadHistory();
  } catch (err) {
    $('crm-ct-history').innerHTML = `<li class="crm-ct-history__empty">${escapeHtml(err.message)}</li>`;
  }
}

async function saveContact(e) {
  e?.preventDefault();
  if (saving || !currentDealId) return;

  const dateVal = $('crm-ct-date').value;
  const payload = {
    contact_type: selectedType,
    contacted_at: dateVal ? new Date(dateVal).toISOString() : null,
    note: $('crm-ct-note').value.trim() || null,
  };

  saving = true;
  $('crm-ct-save').disabled = true;
  try {
    const json = await fetchJSON(apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/contacts`), {
      method: 'POST',
      body: payload,
    });
    if (!json?.ok) throw new Error(errorMessage(json));

    $('crm-ct-note').value = '';
    $('crm-ct-date').value = toLocalInput();
    await loadHistory();
    bumpLastActivity(currentDealId, json.data?.contacted_at);
  } catch (err) {
    showCenterModal({ variant: 'error', title: 'Contato', message: err.message });
  } finally {
    saving = false;
    $('crm-ct-save').disabled = false;
  }
}

// "Última atividade" do card sem recarregar o Kanban
function bumpLastActivity(dealId, when) {
  const deal = findDeal(dealId);
  if (!deal || !when) return;
  if (!deal.last_activity_date || new Date(when) > new Date(deal.last_activity_date)) {
    deal.last_activity_date = when;
    const card = document.querySelector(`#crm-kanban-stages .crm-card[data-id="${CSS.escape(String(dealId))}"]`);
    const footer = card?.querySelector('.crm-card__footer');
    const node = footer && [...footer.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.includes('Última atividade'));
    if (node) node.textContent = ` Última atividade: ${new Date(when).toLocaleDateString('pt-BR')} `;
  }
}

async function deleteContact(contactId) {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Confirmar exclusão',
    message: 'Excluir este contato do histórico?',
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;
  const json = await fetchJSON(
    apiUrl(`/crm/deals/${encodeURIComponent(currentDealId)}/contacts/${encodeURIComponent(contactId)}`),
    { method: 'DELETE' }
  );
  if (!json?.ok) {
    showCenterModal({ variant: 'error', title: 'Contato', message: errorMessage(json) });
    return;
  }
  await loadHistory();
}

/* --------------------------------------------------------------------- */
/* Init                                                                  */
/* --------------------------------------------------------------------- */

function init() {
  document.querySelectorAll('#crm-ct-types .crm-ct-type').forEach((b) => {
    b.insertAdjacentHTML('afterbegin', TYPE_BY_CODE[b.dataset.type]?.svg || '');
  });
  $('crm-ct-types')?.addEventListener('click', (e) => {
    const b = e.target.closest('.crm-ct-type');
    if (b) selectType(b.dataset.type);
  });
  $('crm-contacts-form')?.addEventListener('submit', saveContact);
  $('crm-ct-history')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-contact-id]');
    if (b) deleteContact(b.dataset.contactId);
  });

  watchCards();
  loadSummary();

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
