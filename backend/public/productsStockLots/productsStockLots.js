// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStockLots.js — Estoque por Lote (lotes e validades) | ESM    ║
// ║ API: /api/productsStockLots                                          ║
// ║   /panel, /panel/export, /alert-settings, /product-lookup            ║
// ║   /:id (CRUD), /:id/panel, /:id/kardex, /:id/extras,                 ║
// ║   /:id/block, /:id/unblock, /:id/move                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { openProductsModalSearch } from '/public/modalsSearch/productsModalSearch.js';


/* ───────────────────────── Config ───────────────────────── */
function apiBase() {
  try { if (typeof window.getApiBase === 'function') return window.getApiBase() || ''; } catch { /* noop */ }
  return window.API_BASE || window.apiBase || '';
}
const API = () => `${String(apiBase()).replace(/\/$/, '')}/api/productsStockLots`;

const ACTION_LABELS = { ALERT: 'Só alertar', CONFIRM: 'Alertar e pedir confirmação', BLOCK: 'Bloquear reserva/venda' };
const NEW_BAND_COLORS = ['#ea580c', '#d97706', '#ca8a04', '#0891b2', '#7c3aed', '#db2777', '#0d9488', '#4f46e5'];

const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  limit: 20,
  total: 0,
  rows: [],
  situations: [],
  settings: null,
  sort: 'expires',
  dir: 'asc',
  filters: { q: '', situation: '', balance: 'positive', blocked: '', expires_from: '', expires_to: '' },
  editing: null,
  product: null,
};

/* ───────────────────────── Helpers ───────────────────────── */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtQty(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function isoDate(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}
function fmtDate(v) {
  const iso = isoDate(v);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR');
}
function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${isoDate(iso)}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || `Erro HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function alertError(title, error) {
  console.error(`[productsStockLots] ${title}`, error);
  showCenterModal({ variant: 'error', title, message: error?.message || String(error) });
}
function alertOk(title, message) {
  showCenterModal({ variant: 'success', title, message });
}
async function confirmBox({ title, message, okLabel = 'Confirmar', variant = 'warning', okVariant = 'danger' }) {
  const result = await showCenterModal({
    variant,
    title,
    message,
    buttons: [
      { label: 'Cancelar', variant: 'cancel', action: () => false },
      { label: okLabel, variant: okVariant, action: () => true },
    ],
  });
  return result === true;
}

/* ───────────────────────── Situações ───────────────────────── */
function situationOf(key) {
  return state.situations.find((s) => s.key === key) || { key, label: key, color: '#64748b' };
}

/** Situação calculada no navegador (modal), com as mesmas faixas do backend. */
function situationForDays(days) {
  if (days === null) return situationOf('NONE');
  if (days < 0) return situationOf('EXPIRED');
  const bands = state.situations.filter((s) => /^B\d$/.test(s.key));
  const band = bands.find((b) => days <= b.days);
  return band || situationOf('OK');
}

function badge(sit, extra = '') {
  return `<span class="lot-badge" style="--c:${esc(sit.color)}">${esc(sit.label)}${extra}</span>`;
}

function daysHtml(days, sit) {
  if (days === null || days === undefined) return '<span class="lots-days">—</span>';
  const n = Number(days);
  const label = n < 0 ? `há ${-n}` : String(n);
  return `<span class="lots-days" style="color:${esc(sit.color)}" title="${n < 0 ? 'dias vencido' : 'dias para vencer'}">${label}</span>`;
}

/* ───────────────────────── Filtros ───────────────────────── */
function readMainFilters() {
  state.filters.q = $('fQ').value.trim();
  state.filters.situation = $('fSituation').value;
  state.filters.balance = $('fBalance').value;
}

function moreFiltersCount() {
  const n = ['blocked', 'expires_from', 'expires_to'].filter((k) => state.filters[k]).length;
  const el = $('moreFiltersCount');
  el.hidden = !n;
  el.textContent = String(n);
}

function queryString(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...state.filters, sort: state.sort, dir: state.dir, ...extra }).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined) params.set(k, v);
  });
  return params.toString();
}

function fillSituationSelect() {
  const select = $('fSituation');
  const current = state.filters.situation;
  select.innerHTML = '<option value="">Todas</option><option value="WITH_EXPIRY">Com data de vencimento</option>' + state.situations
    .map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`)
    .join('');
  select.value = current === 'WITH_EXPIRY' || state.situations.some((s) => s.key === current) ? current : '';
}

/* ───────────────────────── Lista ───────────────────────── */
async function load() {
  $('tbody').innerHTML = '<tr><td colspan="12" class="lots-empty">Carregando…</td></tr>';
  try {
    const data = await api(`/panel?${queryString({ page: state.page, limit: state.limit })}`);
    state.rows = data.rows || [];
    state.total = Number(data.total || 0);
    state.totals = data.totals || null;
    state.situations = data.situations || [];
    state.settings = data.settings || null;
    fillSituationSelect();
    renderKpis();
    renderRows();
    renderFooter();
  } catch (error) {
    $('tbody').innerHTML = `<tr><td colspan="12" class="lots-empty">Não foi possível carregar os lotes: ${esc(error.message)}</td></tr>`;
    console.error('[productsStockLots] load', error);
  }
}

function renderKpis() {
  $('kpis').innerHTML = state.situations.map((s) => {
    const isNone = s.key === 'NONE';
    const isOk = s.key === 'OK';
    const label = s.key === 'EXPIRED' ? s.label
      : isOk || isNone ? s.label
        : `${s.label} · até ${s.days} d`;
    const sub = isNone
      ? 'Cadastre a validade no lote'
      : `${fmtQty(s.qty)} un.${isOk ? '' : ` · ${fmtMoney(s.value)}`}`;
    const active = state.filters.situation === s.key ? ' is-active' : '';
    return `<button type="button" class="lots-kpi${active}" style="--k:${esc(s.color)}" data-situation="${esc(s.key)}" title="Filtrar: ${esc(s.label)}">
      <span class="lots-kpi__label"><i></i>${esc(label)}</span>
      <span class="lots-kpi__value">${s.lots} ${s.lots === 1 ? 'lote' : 'lotes'}</span>
      <span class="lots-kpi__sub">${sub}</span>
    </button>`;
  }).join('');
}

function renderRows() {
  if (!state.rows.length) {
    $('tbody').innerHTML = '<tr><td colspan="12" class="lots-empty">Nenhum lote encontrado com os filtros escolhidos.</td></tr>';
    return;
  }

  $('tbody').innerHTML = state.rows.map((r) => {
    const sit = situationOf(r.situation);
    const blocked = !!r.blocked_at;
    const fefo = r.fefo_rank ? `<span class="lots-fefo${Number(r.fefo_rank) === 1 ? ' is-next' : ''}" title="${Number(r.fefo_rank) === 1 ? 'Próximo a sair' : 'Ordem de saída'}">${r.fefo_rank}º</span>` : '—';
    const product = r.product_description
      ? `<b title="${esc(r.product_description)}">${esc(r.product_description)}</b><small>Cód. ${esc(r.product_code || '—')}</small>`
      : `<b>Estoque ${esc(r.product_stock_id)}</b><small>Produto não vinculado</small>`;
    const origin = r.invoice_number
      ? `<small title="Chave ${esc(r.nfe_key || '')}">NF-e ${esc(r.invoice_number)}${r.nfe_item_seq ? ` · item ${esc(r.nfe_item_seq)}` : ''}</small>`
      : r.nfe_key ? `<small title="${esc(r.nfe_key)}">NF-e …${esc(String(r.nfe_key).slice(-8))}</small>` : '<small>Manual</small>';
    const supplier = r.supplier_name ? `<small title="${esc(r.supplier_name)}">${esc(r.supplier_name)}</small>` : '';
    const blockTitle = blocked ? `Bloqueado${r.block_reason ? `: ${r.block_reason}` : ''}` : '';

    return `<tr class="${blocked ? 'is-blocked' : ''}" data-id="${r.lot_id}">
      <td>${fefo}</td>
      <td class="l lots-prod">${product}</td>
      <td>${esc(r.grade_name || 'Padrão')}</td>
      <td><b>${esc(r.lot_code)}</b></td>
      <td>${fmtDate(r.expires_at)}</td>
      <td>${daysHtml(r.days_left, sit)}</td>
      <td>${badge(sit)}${blocked ? `<span class="lot-badge lot-badge--blocked" title="${esc(blockTitle)}">🔒</span>` : ''}</td>
      <td class="num">${fmtQty(r.qty_on_hand)}</td>
      <td class="num">${fmtQty(r.qty_reserved)}</td>
      <td class="num"><b>${fmtQty(r.qty_available)}</b></td>
      <td class="l lots-origin">${origin}${supplier}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar / movimentar', attrs: { 'data-act': 'edit', 'data-id': r.lot_id } },
        { action: 'view', title: 'Histórico (Kardex)', attrs: { 'data-act': 'kardex', 'data-id': r.lot_id } },
        blocked
          ? { action: 'play', title: 'Liberar lote', attrs: { 'data-act': 'unblock', 'data-id': r.lot_id } }
          : { action: 'pause', title: 'Bloquear lote', attrs: { 'data-act': 'block', 'data-id': r.lot_id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': r.lot_id } },
      ])}</td>
    </tr>`;
  }).join('');
}

function renderFooter() {
  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  $('tableInfo').textContent = `${state.total} ${state.total === 1 ? 'lote encontrado' : 'lotes encontrados'}`;
  const t = state.totals || {};
  const qtyShort = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  $('tableCost').textContent = fmtMoney(t.cost_total);
  $('tableQty').textContent = `${qtyShort(t.qty_on_hand)} un.`;
  $('tableCostPill').title = 'Soma de todos os lotes filtrados (todas as páginas): qtd em mãos × custo do lote, ou custo do produto quando o lote não tem custo.'
    + (t.without_cost ? ` ${t.without_cost} lote(s) sem custo cadastrado.` : '');
  $('tableQtyPill').title = `Disponível: ${qtyShort(t.qty_available)} un. (em mãos menos reservado)`;
  $('pageInfo').textContent = `Página ${state.page} de ${pages}`;
  $('btnPrev').disabled = state.page <= 1;
  $('btnNext').disabled = state.page >= pages;
}

/* ───────────────────────── Ações da linha ───────────────────────── */
async function onRowAction(act, id) {
  const row = state.rows.find((r) => String(r.lot_id) === String(id));
  if (!row) return;

  if (act === 'edit') return openLotModal(row);
  if (act === 'kardex') return openKardex(row);

  if (act === 'block') {
    const ok = await confirmBox({
      title: `Bloquear o lote ${row.lot_code}?`,
      message: 'O lote bloqueado deixa de ser sugerido no FEFO e não pode ser reservado até ser liberado. O saldo continua no estoque.',
      okLabel: 'Bloquear',
    });
    if (!ok) return;
    try {
      const reason = row.situation === 'EXPIRED' ? 'Lote vencido' : 'Bloqueado manualmente';
      await api(`/${id}/block`, { method: 'POST', body: { reason } });
      await load();
    } catch (error) { alertError('Erro ao bloquear', error); }
    return;
  }

  if (act === 'unblock') {
    try {
      await api(`/${id}/unblock`, { method: 'POST' });
      await load();
    } catch (error) { alertError('Erro ao liberar', error); }
    return;
  }

  if (act === 'delete') {
    const ok = await confirmBox({
      title: `Excluir o lote ${row.lot_code}?`,
      message: 'Se o lote já tiver inventário vinculado, ele é inativado em vez de apagado.',
      okLabel: 'Excluir',
      variant: 'error',
    });
    if (!ok) return;
    try {
      const out = await api(`/${id}`, { method: 'DELETE' });
      alertOk('Lote excluído', out?.message || 'Lote removido.');
      await load();
    } catch (error) { alertError('Erro ao excluir', error); }
  }
}

/* ───────────────────────── Modal: lote ───────────────────────── */
function setProduct(product) {
  state.product = product;
  $('mProductStockId').value = product?.product_stock_id || '';
  $('mProduct').value = product ? `${product.product_code} · ${product.description || ''}` : '';
  $('mProductInfo').textContent = product ? `Estoque nº ${product.product_stock_id}` : '';

  const grades = product?.grades || [];
  $('mGrade').innerHTML = '<option value="">Padrão</option>' + grades
    .map((g) => `<option value="${esc(g.product_grade_id)}">${esc(g.grade_name)}</option>`).join('');
}

async function lookupProduct(code) {
  const sku = String(code || '').split('·')[0].trim();
  if (!sku) return;
  try {
    const data = await api(`/product-lookup?code=${encodeURIComponent(sku)}`);
    setProduct(data.product);
    $('mLotCode').focus();
  } catch (error) {
    setProduct(null);
    $('mProduct').value = sku;
    $('mProductInfo').textContent = error.message;
  }
}

function updateModalSituation() {
  const iso = $('mExpires').value;
  const days = daysUntil(iso);
  const sit = situationForDays(days);
  const text = days === null ? '' : days < 0 ? ` · vencido há ${-days} dia(s)` : ` · faltam ${days} dia(s)`;
  $('mSituation').innerHTML = badge(sit, esc(text));
}

function openLotModal(row = null) {
  state.editing = row;
  $('lotForm').reset();
  $('mLotId').value = row?.lot_id || '';
  $('moveSection').hidden = !row;
  $('mProduct').disabled = !!row;
  $('btnPickProduct').disabled = !!row;

  if (row) {
    $('lotTitle').textContent = `✏️ Editar lote ${row.lot_code}`;
    $('lotSub').textContent = row.product_description ? `${row.product_description} · Cód. ${row.product_code}` : `Estoque nº ${row.product_stock_id}`;
    setProduct({
      product_stock_id: row.product_stock_id,
      product_code: row.product_code || '',
      description: row.product_description || '',
      grades: row.product_grade_id ? [{ product_grade_id: row.product_grade_id, grade_name: row.grade_name }] : [],
    });
    $('mGrade').value = row.product_grade_id || '';
    $('mGrade').disabled = true;
    $('mLotCode').value = row.lot_code || '';
    $('mExpires').value = isoDate(row.expires_at);
    $('mManufactured').value = isoDate(row.manufactured_at);
    $('mCost').value = row.cost_unit ?? '';
    $('mQtyOnHand').value = Number(row.qty_on_hand || 0);
    $('mReserved').value = fmtQty(row.qty_reserved);
    $('mNfeKey').value = row.nfe_key || '';
    $('mNfeSeq').value = row.nfe_item_seq || '';
    $('mOrigin').textContent = row.invoice_number
      ? `NF-e nº ${row.invoice_number}${row.supplier_name ? ` · ${row.supplier_name}` : ''}${row.entry_date ? ` · entrada ${fmtDate(row.entry_date)}` : ''}`
      : 'Lançado manualmente';
    $('btnSaveLot').textContent = 'Salvar lote';
  } else {
    $('lotTitle').textContent = '＋ Novo lote';
    $('lotSub').textContent = 'Informe o produto, o lote e a validade.';
    setProduct(null);
    $('mGrade').disabled = false;
    $('mReserved').value = fmtQty(0);
    $('mOrigin').textContent = 'Lançado manualmente';
    $('btnSaveLot').textContent = 'Criar lote';
  }

  updateModalSituation();
  Modal.open('lotModal', { focusSelector: row ? '#mExpires' : '#mProduct' });
}

async function saveLot(event) {
  event.preventDefault();
  const id = $('mLotId').value;
  const lotCode = $('mLotCode').value.trim();
  const expires = $('mExpires').value || null;
  const productStockId = Number($('mProductStockId').value);

  if (!productStockId) return alertError('Produto obrigatório', new Error('Busque o produto pelo código ou pela lupa.'));
  if (!lotCode) return alertError('Lote obrigatório', new Error('Informe o código do lote.'));
  if (!expires) {
    const ok = await confirmBox({ title: 'Lote sem validade', message: 'O lote ficará na faixa "Sem validade" e fora do controle de vencimento. Salvar assim mesmo?', okLabel: 'Salvar sem validade', okVariant: 'primary' });
    if (!ok) return;
  }

  const payload = {
    lot_code: lotCode,
    expires_at: expires,
    cost_unit: $('mCost').value === '' ? null : Number($('mCost').value),
    nfe_key: $('mNfeKey').value.trim() || null,
    nfe_item_seq: $('mNfeSeq').value ? Number($('mNfeSeq').value) : null,
  };

  const button = $('btnSaveLot');
  button.disabled = true;
  try {
    let lotId = id;
    if (id) {
      const onHand = Number($('mQtyOnHand').value || 0);
      if (onHand !== Number(state.editing?.qty_on_hand || 0)) payload.qty_on_hand = onHand;
      await api(`/${id}`, { method: 'PUT', body: payload });
    } else {
      const out = await api('', {
        method: 'POST',
        body: {
          ...payload,
          product_stock_id: productStockId,
          product_grade_id: $('mGrade').value || null,
          qty_on_hand: Number($('mQtyOnHand').value || 0),
        },
      });
      lotId = out?.row?.lot_id;
    }
    if (lotId) {
      await api(`/${lotId}/extras`, { method: 'PUT', body: { manufactured_at: $('mManufactured').value || null } });
    }
    Modal.close('lotModal');
    alertOk('Lote salvo', `Lote ${lotCode} salvo com sucesso.`);
    await load();
  } catch (error) {
    alertError('Erro ao salvar o lote', error);
  } finally {
    button.disabled = false;
  }
}

async function moveLot(op) {
  const id = $('mLotId').value;
  const qty = Number($('opQty').value || 0);
  if (!id) return;
  if (!(qty > 0)) return alertError('Quantidade inválida', new Error('Informe uma quantidade maior que zero.'));

  const labels = { reserve: 'Reservar', unreserve: 'Desreservar', consume: 'Baixar' };
  if (op === 'consume') {
    const ok = await confirmBox({
      title: `Baixar ${fmtQty(qty)} do lote?`,
      message: `Motivo: ${$('opReason').value}. A baixa reduz o estoque e fica registrada no Kardex.`,
      okLabel: 'Baixar',
    });
    if (!ok) return;
  }

  const body = { op, qty, reason: $('opReason').value };
  try {
    let out;
    try {
      out = await api(`/${id}/move`, { method: 'POST', body });
    } catch (error) {
      if (error?.data?.needsConfirm) {
        const ok = await confirmBox({ title: 'Atenção à validade', message: error.message, okLabel: 'Reservar mesmo assim' });
        if (!ok) return;
        out = await api(`/${id}/move`, { method: 'POST', body: { ...body, confirm: true } });
      } else {
        throw error;
      }
    }
    const row = out?.row || {};
    $('mQtyOnHand').value = Number(row.qty_on_hand ?? $('mQtyOnHand').value);
    $('mReserved').value = fmtQty(row.qty_reserved ?? 0);
    if (state.editing) {
      state.editing.qty_on_hand = row.qty_on_hand ?? state.editing.qty_on_hand;
      state.editing.qty_reserved = row.qty_reserved ?? state.editing.qty_reserved;
    }
    alertOk(`${labels[op]} concluído`, `Em mãos ${fmtQty(row.qty_on_hand)} · reservado ${fmtQty(row.qty_reserved)}.`);
    load();
  } catch (error) {
    alertError(`Não foi possível ${labels[op].toLowerCase()}`, error);
  }
}

/* ───────────────────────── Modal: Kardex ───────────────────────── */
async function openKardex(row) {
  $('kardexTitle').textContent = `📜 Histórico do lote ${row.lot_code}`;
  $('kardexSub').textContent = row.product_description ? `${row.product_description} · Cód. ${row.product_code}` : '';
  $('kardexBody').innerHTML = '<tr><td colspan="5" class="lots-empty">Carregando…</td></tr>';
  Modal.open('kardexModal');
  try {
    const data = await api(`/${row.lot_id}/kardex`);
    const rows = data.rows || [];
    $('kardexBody').innerHTML = rows.length
      ? rows.map((m) => `<tr>
          <td>${fmtDateTime(m.created_at)}</td>
          <td><b>${esc(m.movement_type)}</b></td>
          <td class="num">${fmtQty(Math.abs(Number(m.quantity || 0)))}</td>
          <td>${esc(m.nfe_number || '—')}</td>
          <td class="l">${esc(m.notes || m.origin_module || '')}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="lots-empty">Nenhuma movimentação registrada para este lote.</td></tr>';
  } catch (error) {
    $('kardexBody').innerHTML = `<tr><td colspan="5" class="lots-empty">${esc(error.message)}</td></tr>`;
  }
}

/* ───────────────────────── Modal: parâmetros ───────────────────────── */
function actionOptions(selected) {
  return Object.entries(ACTION_LABELS)
    .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('');
}

function bandRowHtml(band) {
  return `<div class="band-row" data-band>
    <input type="color" class="band-color" data-f="color" value="${esc(band.color)}" title="Cor">
    <input type="text" data-f="name" maxlength="40" value="${esc(band.name)}" placeholder="Nome">
    <input type="number" data-f="days" min="0" max="3650" step="1" value="${esc(band.days)}">
    <span class="band-hint">${band.days >= 30 ? `≈ ${Math.round(band.days / 30)} mês(es)` : ''}</span>
    <select data-f="action">${actionOptions(band.action)}</select>
    <button type="button" class="band-remove" data-remove-band title="Remover faixa">×</button>
  </div>`;
}

function readBands() {
  return [...document.querySelectorAll('#bandsList [data-band]')].map((row) => ({
    name: row.querySelector('[data-f="name"]').value.trim(),
    days: Number(row.querySelector('[data-f="days"]').value),
    color: row.querySelector('[data-f="color"]').value,
    action: row.querySelector('[data-f="action"]').value,
  }));
}

function renderTimeline() {
  const bands = readBands().filter((b) => b.name && Number.isFinite(b.days)).sort((a, b) => a.days - b.days);
  const max = Math.max(60, ...bands.map((b) => b.days)) * 1.25;
  const expiredW = 8;
  let prev = 0;
  const segs = [`<span style="width:${expiredW}%;background:${esc($('expColor').value)}"></span>`];
  const legend = ['<span>vencido</span>'];
  bands.forEach((b) => {
    const w = ((b.days - prev) / max) * (100 - expiredW);
    segs.push(`<span style="width:${Math.max(w, 2)}%;background:${esc(b.color)}" title="${esc(b.name)}"></span>`);
    legend.push(`<span>${b.days} d</span>`);
    prev = b.days;
  });
  legend.push('<span>dentro da validade →</span>');
  $('bandsTimeline').innerHTML = segs.join('');
  $('bandsLegend').innerHTML = legend.join('');
}

async function openAlertSettings() {
  try {
    const data = await api('/alert-settings');
    const s = data.settings;
    $('expName').value = s.expired_name;
    $('expColor').value = s.expired_color;
    $('expAction').innerHTML = actionOptions(s.expired_action);
    $('bandsList').innerHTML = s.bands.map(bandRowHtml).join('');
    $('sNotifyDashboard').checked = s.notify_dashboard;
    $('sNotifySales').checked = s.notify_sales;
    $('sNotifyEmail').checked = s.notify_email;
    $('sEmails').value = s.emails || '';
    $('sSuggestFefo').checked = s.suggest_fefo;
    $('sRequireFefo').checked = s.require_fefo;
    $('sRequireExpiry').checked = s.require_expiry_inbound;
    $('sMinDays').value = s.min_days_to_sell;
    renderTimeline();
    Modal.open('alertModal');
  } catch (error) {
    alertError('Erro ao abrir os parâmetros', error);
  }
}

async function saveAlertSettings() {
  const bands = readBands();
  if (bands.some((b) => !b.name || !Number.isFinite(b.days) || b.days < 0)) {
    return alertError('Faixa incompleta', new Error('Preencha o nome e os dias (0 ou mais) de todas as faixas.'));
  }
  const days = bands.map((b) => b.days);
  if (new Set(days).size !== days.length) {
    return alertError('Faixas repetidas', new Error('Duas faixas não podem ter o mesmo número de dias.'));
  }

  const button = $('btnSaveSettings');
  button.disabled = true;
  try {
    await api('/alert-settings', {
      method: 'PUT',
      body: {
        expired_name: $('expName').value.trim(),
        expired_color: $('expColor').value,
        expired_action: $('expAction').value,
        bands,
        notify_dashboard: $('sNotifyDashboard').checked,
        notify_sales: $('sNotifySales').checked,
        notify_email: $('sNotifyEmail').checked,
        emails: $('sEmails').value,
        suggest_fefo: $('sSuggestFefo').checked,
        require_fefo: $('sRequireFefo').checked,
        require_expiry_inbound: $('sRequireExpiry').checked,
        min_days_to_sell: Number($('sMinDays').value || 0),
      },
    });
    Modal.close('alertModal');
    alertOk('Parâmetros salvos', 'As faixas de alerta já valem para a lista e para as reservas.');
    state.filters.situation = '';
    $('fSituation').value = '';
    await load();
  } catch (error) {
    alertError('Erro ao salvar os parâmetros', error);
  } finally {
    button.disabled = false;
  }
}

/* ───────────────────────── Exportar ───────────────────────── */
async function exportFile(format, button) {
  readMainFilters();
  const label = button.querySelector('span');
  const original = label?.textContent;
  button.disabled = true;
  if (label) label.textContent = 'Gerando...';
  try {
    const response = await fetch(`${API()}/panel/export?${queryString({ format })}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.message || data?.error || `Erro HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lotes-validade-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    alertError('Não foi possível exportar', error);
  } finally {
    button.disabled = false;
    if (label) label.textContent = original;
  }
}

/* ───────────────────────── Eventos ───────────────────────── */
function search() {
  readMainFilters();
  state.page = 1;
  load();
}

function bind() {
  Modal.setup();

  $('btnFilter').addEventListener('click', search);
  $('fQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  $('fSituation').addEventListener('change', search);
  $('fBalance').addEventListener('change', search);

  $('kpis').addEventListener('click', (e) => {
    const card = e.target.closest('[data-situation]');
    if (!card) return;
    const key = card.dataset.situation;
    state.filters.situation = state.filters.situation === key ? '' : key;
    $('fSituation').value = state.filters.situation;
    state.page = 1;
    load();
  });

  $('btnMoreFilters').addEventListener('click', () => {
    $('fBlocked').value = state.filters.blocked;
    $('fExpFrom').value = state.filters.expires_from;
    $('fExpTo').value = state.filters.expires_to;
    Modal.open('filtersModal');
  });
  $('btnApplyFilters').addEventListener('click', () => {
    state.filters.blocked = $('fBlocked').value;
    state.filters.expires_from = $('fExpFrom').value;
    state.filters.expires_to = $('fExpTo').value;
    moreFiltersCount();
    Modal.close('filtersModal');
    search();
  });
  $('btnClearFilters').addEventListener('click', () => {
    ['fBlocked', 'fExpFrom', 'fExpTo'].forEach((id) => { $(id).value = ''; });
  });

  $('btnPrev').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  $('btnNext').addEventListener('click', () => { state.page += 1; load(); });
  $('rowsPerPage').addEventListener('change', (e) => { state.limit = Number(e.target.value) || 20; state.page = 1; load(); });

  $('tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) onRowAction(btn.dataset.act, btn.dataset.id);
  });

  createSortableTable({
    table: '#lotsTable',
    defaultColumn: 'expires',
    defaultDirection: 'asc',
    onSort: ({ column, direction }) => {
      state.sort = column;
      state.dir = direction;
      state.page = 1;
      return load();
    },
  });

  $('btnNew').addEventListener('click', () => openLotModal(null));
  $('lotForm').addEventListener('submit', saveLot);
  $('mExpires').addEventListener('change', updateModalSituation);
  $('mProduct').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); lookupProduct($('mProduct').value); }
  });
  $('mProduct').addEventListener('change', () => { if (!state.product) lookupProduct($('mProduct').value); });
  $('btnPickProduct').addEventListener('click', () => {
    openProductsModalSearch({
      apiBase: apiBase(),
      priceId: null,
      onPick: (p) => lookupProduct(p?.product_code || p?.sku || p?.product_id || ''),
    });
  });
  $('btnReserve').addEventListener('click', () => moveLot('reserve'));
  $('btnUnreserve').addEventListener('click', () => moveLot('unreserve'));
  $('btnConsume').addEventListener('click', () => moveLot('consume'));

  $('btnAlertSettings').addEventListener('click', openAlertSettings);
  $('btnSaveSettings').addEventListener('click', saveAlertSettings);
  $('btnAddBand').addEventListener('click', () => {
    const bands = readBands();
    if (bands.length >= 8) return alertError('Limite de faixas', new Error('Use no máximo 8 faixas.'));
    const last = bands.reduce((m, b) => Math.max(m, Number(b.days) || 0), 0);
    $('bandsList').insertAdjacentHTML('beforeend', bandRowHtml({
      name: 'Nova faixa', days: last + 30, color: NEW_BAND_COLORS[bands.length % NEW_BAND_COLORS.length], action: 'ALERT',
    }));
    renderTimeline();
  });
  $('bandsList').addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove-band]')) return;
    if (readBands().length <= 1) return alertError('Faixa obrigatória', new Error('Mantenha pelo menos uma faixa de alerta.'));
    e.target.closest('[data-band]').remove();
    renderTimeline();
  });
  $('bandsList').addEventListener('input', renderTimeline);
  $('expColor').addEventListener('input', renderTimeline);

  $('btnExportPdf').addEventListener('click', (e) => exportFile('pdf', e.currentTarget));
  $('btnExportExcel').addEventListener('click', (e) => exportFile('xlsx', e.currentTarget));
}

bind();
load();
