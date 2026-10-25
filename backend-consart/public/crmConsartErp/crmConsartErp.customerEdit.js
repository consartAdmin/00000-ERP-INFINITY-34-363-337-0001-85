// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmConsartErp.customerEdit.js — CRM Consart ERP                      ║
// ║ ✅ Ícone ✎ em cada card abre o modal "Editar Cliente"                ║
// ║ ✅ Lê/grava o cliente em /api/customers/:id (tabela customersConsart ║
// ║    via X-ERP-Company = CONSART, posto pelo erpCompany.js)            ║
// ║ ✅ Ao trocar o nome fantasia, atualiza o nome nos cards do cliente   ║
// ║ ✅ Só carregado pelo crmConsartErp.html: o CRM da BH3 fica igual     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconSvg } from '/public/includes/js/actionIcons.js';
import { state } from '/crmDeals/js/state.js';
import { fetchJSON } from '/crmDeals/js/fetchJSON.js';
import { apiUrl } from '/crmDeals/js/config.js';
import { apiUpdateDeal } from '/crmDeals/js/api.js';
import { renderDeals } from '/crmDeals/js/render.deals.js';

const MODAL_ID = 'crm-modal-customer-edit';
const FULL_EDIT_URL = '/public/customersEditConsart/customersEditConsart.html';

const $ = (id) => document.getElementById(id);
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
const trimOrNull = (v) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};

let segmentsLoaded = false;
let saving = false;

/* --------------------------------------------------------------------- */
/* Ícone no card                                                         */
/* --------------------------------------------------------------------- */

function findDeal(dealId) {
  return (state.deals || []).find((d) => String(d.id) === String(dealId)) || null;
}

function decorateCard(card) {
  if (card.querySelector('.crm-card__customer-edit')) return;

  const deal = findDeal(card.dataset.id);
  if (!deal?.customer_id) return;

  const footer = card.querySelector('.crm-card__footer');
  if (!footer) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'action-icon action-icon--edit crm-card__customer-edit';
  btn.title = 'Editar cliente';
  btn.setAttribute('aria-label', 'Editar cliente');
  btn.draggable = false;
  btn.innerHTML = actionIconSvg('edit');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCustomerEdit(deal.customer_id);
  });

  footer.classList.add('crm-card__footer--actions');
  footer.appendChild(btn);
}

function decorateAllCards() {
  document.querySelectorAll('#crm-kanban-stages .crm-card').forEach(decorateCard);
}

function watchCards() {
  const root = $('crm-kanban-stages');
  if (!root) return;

  decorateAllCards();
  new MutationObserver(decorateAllCards).observe(root, { childList: true, subtree: true });
}

/* --------------------------------------------------------------------- */
/* Campos                                                                */
/* --------------------------------------------------------------------- */

const FIELD_MAP = Object.freeze({
  'crm-ce-trade-name': 'trade_name',
  'crm-ce-legal-name': 'legal_name',
  'crm-ce-state-registration': 'state_registration',
  'crm-ce-municipal-registration': 'municipal_registration',
  'crm-ce-contact-name': 'contact_name',
  'crm-ce-email': 'email',
  'crm-ce-phone': 'phone_number',
  'crm-ce-mobile': 'mobile_number',
  'crm-ce-street-type': 'street_type',
  'crm-ce-street-name': 'street_name',
  'crm-ce-street-number': 'street_number',
  'crm-ce-complement': 'address_complement',
  'crm-ce-neighborhood': 'neighborhood',
  'crm-ce-city': 'city',
});

const isPF = () => $('crm-ce-person-type').value === 'F';

function formatTaxId(raw, pf) {
  const d = onlyDigits(raw).slice(0, pf ? 11 : 14);
  if (pf) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatCep(raw) {
  const d = onlyDigits(raw).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function applyPersonType() {
  const pf = isPF();
  $('crm-ce-tax-id-label').firstChild.textContent = pf ? 'CPF * ' : 'CNPJ * ';
  $('crm-ce-tax-id').placeholder = pf ? '000.000.000-00' : '12.345.678/0001-00';
  $('crm-ce-trade-name-label').textContent = pf ? 'Nome *' : 'Nome fantasia *';
  $('crm-ce-cnpj-lookup').hidden = pf;
  $('crm-ce-legal-name-field').hidden = pf;
  document
    .querySelectorAll(`#${MODAL_ID} .crm-ce-pj-only`)
    .forEach((el) => { el.hidden = pf; });
  $('crm-ce-tax-id').value = formatTaxId($('crm-ce-tax-id').value, pf);
}

function fillForm(c) {
  $('crm-ce-id').value = c.customer_id ?? '';
  $('crm-ce-person-type').value = String(c.customer_type || 'J').toUpperCase() === 'F' ? 'F' : 'J';

  Object.entries(FIELD_MAP).forEach(([id, key]) => {
    $(id).value = c[key] ?? '';
  });

  $('crm-ce-tax-id').value = c.tax_id ?? '';
  $('crm-ce-postal-code').value = formatCep(c.postal_code);
  $('crm-ce-state').value = String(c.state || '').toUpperCase();
  $('crm-ce-segment').value = c.segment_id != null ? String(c.segment_id) : '';
  $('crm-ce-active').value = c.is_active === false ? 'false' : 'true';

  applyPersonType();

  const name = c.trade_name || c.legal_name || 'Cliente';
  $('crmCustomerEditTitle').textContent = `Editar Cliente — ${name}`;
  $('crm-ce-open-full').href = `${FULL_EDIT_URL}?id=${encodeURIComponent(c.customer_id)}`;
}

function readPayload() {
  const pf = isPF();
  const payload = { customer_type: pf ? 'F' : 'J' };

  Object.entries(FIELD_MAP).forEach(([id, key]) => {
    payload[key] = trimOrNull($(id).value);
  });

  payload.tax_id = onlyDigits($('crm-ce-tax-id').value).slice(0, pf ? 11 : 14);
  payload.postal_code = onlyDigits($('crm-ce-postal-code').value).slice(0, 8) || null;
  payload.state = trimOrNull($('crm-ce-state').value);
  payload.is_active = $('crm-ce-active').value === 'true';

  const segOpt = $('crm-ce-segment').selectedOptions[0];
  payload.segment_id = segOpt?.value ? Number(segOpt.value) : null;
  payload.business_segment = segOpt?.value ? (segOpt.dataset.code || null) : null;

  if (pf) {
    payload.legal_name = payload.trade_name;
    payload.state_registration = null;
    payload.municipal_registration = null;
  }

  return payload;
}

function validate(p) {
  const pf = p.customer_type === 'F';
  if (!p.trade_name) return pf ? 'Informe o Nome.' : 'Informe o Nome fantasia.';
  if (!pf && !p.legal_name) return 'Informe a Razão social.';
  if (pf && p.tax_id.length !== 11) return 'Informe um CPF com 11 dígitos.';
  if (!pf && p.tax_id.length !== 14) return 'Informe um CNPJ com 14 dígitos.';
  return null;
}

/* --------------------------------------------------------------------- */
/* Segmentos (customerSegmentsConsart)                                   */
/* --------------------------------------------------------------------- */

async function loadSegments() {
  if (segmentsLoaded) return;

  const sel = $('crm-ce-segment');
  const json = await fetchJSON(apiUrl('/customer-segments?limit=500'));
  const root = json?.data ?? json;
  const rows = Array.isArray(root) ? root
    : Array.isArray(root?.data) ? root.data
      : Array.isArray(root?.rows) ? root.rows
        : Array.isArray(root?.items) ? root.items
          : [];

  sel.innerHTML = '<option value="">Sem segmento</option>';
  rows.forEach((s) => {
    const id = s.segment_id ?? s.id;
    if (id == null) return;
    const opt = document.createElement('option');
    opt.value = String(id);
    opt.dataset.code = s.segment_code ?? '';
    opt.textContent = s.segment_name ?? s.name ?? String(id);
    sel.appendChild(opt);
  });

  segmentsLoaded = json?.ok !== false;
}

/* --------------------------------------------------------------------- */
/* Abrir / salvar                                                        */
/* --------------------------------------------------------------------- */

async function openCustomerEdit(customerId) {
  const [, res] = await Promise.all([
    loadSegments().catch((err) => console.warn('[CRM] segmentos:', err)),
    fetchJSON(apiUrl(`/customers/${encodeURIComponent(customerId)}`), { noCache: true }),
  ]);

  const customer = res?.data?.data ?? res?.data ?? null;
  if (!res?.ok || !customer?.customer_id) {
    showCenterModal({
      variant: 'error',
      title: 'Cliente',
      message: 'Não foi possível carregar o cliente deste card.',
    });
    return;
  }

  fillForm(customer);
  Modal.setup();
  Modal.open(MODAL_ID, { focusSelector: '#crm-ce-trade-name' });
}

async function syncCardNames(customerId, newName) {
  const deals = (state.deals || []).filter(
    (d) => String(d.customer_id) === String(customerId) && d.customer_name !== newName
  );
  if (!deals.length) return;

  await Promise.all(deals.map((d) => apiUpdateDeal(d.id, { customer_name: newName })));
  deals.forEach((d) => { d.customer_name = newName; });
  renderDeals();
}

async function saveCustomer(e) {
  e?.preventDefault();
  if (saving) return;

  const id = $('crm-ce-id').value;
  const payload = readPayload();
  const error = validate(payload);
  if (error) {
    showCenterModal({ variant: 'warning', title: 'Validação', message: error });
    return;
  }

  const btn = $('crm-ce-save');
  saving = true;
  btn.disabled = true;

  try {
    const res = await fetchJSON(apiUrl(`/customers/${encodeURIComponent(id)}`), {
      method: 'PUT',
      body: payload,
    });
    if (!res?.ok) throw new Error(res?.error || res?.message || 'Falha ao salvar');

    await syncCardNames(id, payload.trade_name);

    Modal.close(MODAL_ID);
    showCenterModal({
      variant: 'success',
      title: 'Salvo',
      message: 'Cliente atualizado com sucesso!',
      timeoutMs: 2000,
    });
  } catch (err) {
    console.error('[CRM] salvar cliente:', err);
    showCenterModal({
      variant: 'error',
      title: 'Falha',
      message: `Não foi possível salvar o cliente. (${err?.message || err})`,
    });
  } finally {
    saving = false;
    btn.disabled = false;
  }
}

/* --------------------------------------------------------------------- */
/* Buscar CNPJ (dados públicos)                                          */
/* --------------------------------------------------------------------- */

async function lookupCnpj() {
  const cnpj = onlyDigits($('crm-ce-tax-id').value);
  if (cnpj.length !== 14) {
    showCenterModal({ variant: 'warning', title: 'CNPJ', message: 'Informe um CNPJ com 14 dígitos.' });
    return;
  }

  const btn = $('crm-ce-cnpj-lookup');
  btn.disabled = true;
  btn.textContent = 'Buscando…';

  try {
    const res = await fetchJSON(apiUrl(`/public-cnpj/${cnpj}`));
    if (!res?.ok) throw new Error(res?.error || 'CNPJ não encontrado');

    const d = res.dados || res.data?.dados || res.data?.data || res.data || {};
    const est = d.estabelecimento || {};
    const setIf = (id, v) => { if (v) $(id).value = v; };

    setIf('crm-ce-legal-name', d.razao_social || est.razao_social);
    setIf('crm-ce-trade-name', est.nome_fantasia || d.nome_fantasia || d.razao_social);
    setIf('crm-ce-postal-code', formatCep(est.cep));
    setIf('crm-ce-street-type', est.tipo_logradouro);
    setIf('crm-ce-street-name', est.logradouro);
    setIf('crm-ce-street-number', est.numero);
    setIf('crm-ce-complement', est.complemento);
    setIf('crm-ce-neighborhood', est.bairro);
    setIf('crm-ce-city', est.cidade?.nome);
    setIf('crm-ce-state', est.estado?.sigla);
    setIf('crm-ce-email', est.email);
    if (est.telefone1) {
      setIf('crm-ce-phone', est.ddd1 ? `(${est.ddd1}) ${est.telefone1}` : est.telefone1);
    }
    const ie = Array.isArray(est.inscricoes_estaduais) ? est.inscricoes_estaduais[0] : null;
    setIf('crm-ce-state-registration', ie?.inscricao_estadual);
  } catch (err) {
    showCenterModal({ variant: 'warning', title: 'CNPJ', message: `Consulta falhou. (${err?.message || err})` });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar CNPJ';
  }
}

/* --------------------------------------------------------------------- */
/* Init                                                                  */
/* --------------------------------------------------------------------- */

function init() {
  if (!$(MODAL_ID)) return;

  $('crm-customer-edit-form').addEventListener('submit', saveCustomer);
  $('crm-ce-person-type').addEventListener('change', applyPersonType);
  $('crm-ce-cnpj-lookup').addEventListener('click', lookupCnpj);
  $('crm-ce-tax-id').addEventListener('input', (e) => {
    e.target.value = formatTaxId(e.target.value, isPF());
  });
  $('crm-ce-postal-code').addEventListener('input', (e) => {
    e.target.value = formatCep(e.target.value);
  });

  watchCards();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
