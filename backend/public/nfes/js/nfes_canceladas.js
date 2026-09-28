// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfes_canceladas.js — Painel de NF-e Canceladas (CONSART ERP)        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { openCancelarNfeModal } from '/public/includes/js/cancelarNfeModal.js';
import { openCceNfeModal } from '/public/includes/js/cceNfeModal.js';

const API_BASE = (window.apiBase || window.API_BASE || window.location.origin).replace(/\/$/, '');

const fmtMoney = (v) =>
  (Number(v || 0)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const ROUTES = Object.freeze({
  nfesSearch: (q, status, limit, offset) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('nfeStatus', status);
    params.set('limit', limit || 20);
    params.set('offset', offset || 0);
    return `${API_BASE}/api/nfes/search?${params.toString()}`;
  },

  reconcile: (orderId) =>
    `${API_BASE}/api/nfes/reconcile/${encodeURIComponent(orderId)}`,

  danfePdf: (orderId) =>
    `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/danfe`,
  xml: (orderId) =>
    `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/xml`,

  cancel: (orderId) =>
    `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/cancelar`,
  cce: (orderId) =>
    `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/cce`,
});

const state = { list: [], total: 0, page: 1, limit: 20, q: '', status: 'CANCELADA' };
const $ = (s, r = document) => r.querySelector(s);

/* =====================================================================
 * Helpers
 * ===================================================================== */
function two(n) {
  return String(n).padStart(2, '0');
}

function formatDateTimeBR(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
      const [ymd, hm] = raw.split('T');
      const [y, m, da] = ymd.split('-');
      return `${da}/${m}/${y} ${hm.slice(0, 5)}`;
    }
    return raw.slice(0, 10);
  }
  const dia = two(d.getDate());
  const mes = two(d.getMonth() + 1);
  const ano = d.getFullYear();
  const hora = two(d.getHours());
  const min = two(d.getMinutes());
  return `${dia}/${mes}/${ano} ${hora}:${min}`;
}

function statusToBadgeClass(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'AUTORIZADA') return 'badge--approved';
  if (s === 'CANCELADA' || s === 'REJEITADA') return 'badge--canceled';
  return 'badge--open';
}

function formatAmbienteLabel(env) {
  const e = String(env || '').trim().toUpperCase();
  if (!e) return 'N/D';
  if (e.startsWith('PROD')) return 'Produção';
  if (e.startsWith('HOM')) return 'Homologação';
  return e;
}

function ambienteToBadgeClass(env) {
  const e = String(env || '').trim().toUpperCase();
  if (e.startsWith('PROD')) return 'badge--approved';
  if (e.startsWith('HOM')) return 'badge--open';
  return 'badge--open';
}

function getNfeNumber(nfe) {
  return (
    nfe.nfe_number ??
    nfe.nfe_numero ??
    nfe.nfeNumero ??
    nfe.numeroNfe ??
    nfe.numero ??
    nfe.numNfe ??
    null
  );
}

function getNfeKey(nfe) {
  return (
    nfe.nfe_key ??
    nfe.nfe_chave ??
    nfe.chaveAcesso ??
    nfe.chave_acesso ??
    nfe.chave ??
    nfe.chaveNfe ??
    nfe.chaveNFe ??
    null
  );
}

/* =====================================================================
 * Bind e busca
 * ===================================================================== */
function bindUI() {
  $('#btnBuscarNfesCanceladas')?.addEventListener('click', () => {
    state.q = $('#qNfesCanceladas').value.trim();
    state.page = 1;
    fetchNfes();
  });

  $('#qNfesCanceladas')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.q = $('#qNfesCanceladas').value.trim();
      state.page = 1;
      fetchNfes();
    }
  });

  $('#limitNfesCanceladas')?.addEventListener('change', (e) => {
    state.limit = Number(e.target.value) || 20;
    state.page = 1;
    fetchNfes();
  });

  $('#prevNfesCanceladas')?.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      fetchNfes();
    }
  });

  $('#nextNfesCanceladas')?.addEventListener('click', () => {
    const max = Math.ceil(state.total / state.limit) || 1;
    if (state.page < max) {
      state.page++;
      fetchNfes();
    }
  });

  $('#btnRecarregarNfesCanceladas')?.addEventListener('click', () => fetchNfes());
}

async function fetchNfes() {
  const offset = (state.page - 1) * state.limit;
  const url = ROUTES.nfesSearch(state.q, state.status, state.limit, offset);

  console.debug('[NFES CANCELADAS] fetch:', url);
  let js;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    js = await r.json();
  } catch (e) {
    console.error('[NFES CANCELADAS] erro ao buscar:', e);
    js = { rows: [], total: 0 };
  }

  state.list = js.rows || [];
  state.total = js.total || 0;
  console.debug(
    '[NFES CANCELADAS] rows:',
    state.list.length,
    'total:',
    state.total,
    'source:',
    js.source,
  );

  if (state.list[0]) {
    console.debug('[NFES CANCELADAS] primeiro registro:', state.list[0]);
  }

  renderNfes();
}

/* =====================================================================
 * Render
 * ===================================================================== */
function renderNfes() {
  const tbody = $('#tblNfesCanceladas tbody');
  const empty = $('#emptyNfesCanceladas');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (empty) empty.style.display = state.list.length ? 'none' : 'block';

  for (const nfe of state.list) {
    const orderId = nfe.order_id ?? nfe.order_number ?? '';
    const number = nfe.order_number || orderId || '';
    const dataHora = formatDateTimeBR(nfe.issue_date);
    const cli = nfe.customer_name || '';
    const doc = nfe.customer_tax_id || '';
    const total = Number(nfe.total_amount || 0);
    const status = String(nfe.nfe_status || 'CANCELADA').toUpperCase();

    const numNfe = getNfeNumber(nfe);
    const chaveNfe = getNfeKey(nfe);
    const ambiente = (nfe.nfe_environment || nfe.environment || '').trim();

    const numNfeLabel = numNfe ?? '— —';
    const chaveNfeFull =
      chaveNfe && String(chaveNfe).trim()
        ? String(chaveNfe).trim()
        : '— —';
    const chaveNfeLabel = chaveNfeFull;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="num">${number}</td>
      <td class="nowrap">${dataHora}</td>
      <td class="td-nfe-num">${numNfeLabel}</td>
      <td class="td-chave" title="${chaveNfeFull}">
        ${chaveNfeLabel}
      </td>
      <td title="${cli}">${cli.length > 29 ? cli.slice(0, 29) + '…' : cli}</td>
      <td class="num">${doc}</td>
      <td class="money ta-right">${fmtMoney(total)}</td>
      <td>
        <span class="badge ${statusToBadgeClass(status)}">
          ${status.charAt(0) + status.slice(1).toLowerCase()}
        </span>
      </td>
      <td>
        <span class="badge ${ambienteToBadgeClass(ambiente)}">
          ${formatAmbienteLabel(ambiente)}
        </span>
      </td>
      <td class="row gap-8">
        <button
          class="btn btn-flat btn-sm"
          data-act="viewOrder"
          data-id="${orderId}"
        >
          🔍 Pedido
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="refresh"
          data-id="${orderId}"
          title="Atualizar status"
        >
          🔄
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="pdf"
          data-id="${orderId}"
          title="Baixar DANFE"
        >
          🧾
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="xml"
          data-id="${orderId}"
          title="Baixar XML"
        >
          📄
        </button>

        <button
          class="btn btn-danger btn-sm btn-icon"
          data-act="cancel"
          data-id="${orderId}"
          data-nfe-number="${numNfeLabel}"
          data-nfe-key="${chaveNfeFull}"
          data-nfe-status="${status}"
          title="Cancelar NF-e"
        >
          ❌
        </button>

        <button
          class="btn btn-primary btn-sm btn-icon"
          data-act="cce"
          data-id="${orderId}"
          data-nfe-number="${numNfeLabel}"
          data-nfe-key="${chaveNfeFull}"
          data-nfe-status="${status}"
          title="Carta de Correção Eletrônica"
        >
          📝
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  const max = Math.ceil(state.total / state.limit) || 1;
  $('#totalInfoNfesCanceladas').textContent = `${state.total} NF-e(s)`;
  $('#pageInfoNfesCanceladas').textContent = `Página ${state.page} de ${max}`;
  $('#prevNfesCanceladas').disabled = state.page <= 1;
  $('#nextNfesCanceladas').disabled = state.page >= max;

  tbody.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;

    const id = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'viewOrder') {
      if (id) {
        window.location.href = `/public/orders/orders.html?orderId=${encodeURIComponent(id)}`;
      }
      return;
    }

    if (act === 'refresh') {
      await refreshRow(id, btn);
      return;
    }

    if (act === 'pdf') {
      if (!id) return;
      window.open(ROUTES.danfePdf(id), '_blank');
      return;
    }

    if (act === 'xml') {
      if (!id) return;
      window.open(ROUTES.xml(id), '_blank');
      return;
    }

    if (act === 'cancel') {
      openCancelarNfeModal({
        orderId: id,
        nfeNumber: btn.dataset.nfeNumber || '',
        nfeKey: btn.dataset.nfeKey || '',
        status: btn.dataset.nfeStatus || '',
        route: ROUTES.cancel(id),
      });
      return;
    }

    if (act === 'cce') {
      openCceNfeModal({
        orderId: id,
        nfeNumber: btn.dataset.nfeNumber || '',
        nfeKey: btn.dataset.nfeKey || '',
        status: btn.dataset.nfeStatus || '',
        route: ROUTES.cce(id),
      });
      return;
    }
  };
}

/* =====================================================================
 * Ação extra: reconcile
 * ===================================================================== */
async function refreshRow(orderId, btn) {
  if (!orderId) return;
  try {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳';

    const r = await fetch(ROUTES.reconcile(orderId), {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const js = await r.json().catch(() => ({}));
    console.debug('[NFES CANCELADAS] reconcile', orderId, js);

    await fetchNfes();
    btn.textContent = original;
  } catch (err) {
    console.error('[NFES CANCELADAS] reconcile EXC:', err);
  } finally {
    btn.disabled = false;
  }
}

/* =====================================================================
 * Boot
 * ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  fetchNfes();
});
