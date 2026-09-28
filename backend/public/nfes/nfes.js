// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfes.js — Front da lista de NF-e (CONSART ERP)                      ║
// ║ ✅ Ordenação por combo + clique no cabeçalho                        ║
// ║ ✅ Envia sortBy/sortOrder para API                                  ║
// ║ ✅ Fallback de ordenação local no front                             ║
// ║ ✅ Botão "Inutilizar NF-e"                                          ║
// ║ ✅ Botão "Enviar por e-mail" usa modal dinâmico                     ║
// ║ ✅ Preenche "Para" com E-mail do Cliente                            ║
// ║ ✅ Integração ajustada com módulo CC-e                              ║
// ║ ✅ CC-e habilitada para AUTORIZADA / CONCLUIDO / CONCLUÍDO          ║
// ║ ✅ Download PDF/XML da CC-e                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { openCancelarNfeModal } from '/public/includes/js/cancelarNfeModal.js';
import { openCceNfeModal } from '/public/includes/js/cceNfeModal.js';
import { openNfeSendEmailModal } from '/public/nfes/nfesModalSend.js';

const API_BASE = (window.apiBase || window.API_BASE || window.location.origin).replace(/\/$/, '');

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const ROUTES = Object.freeze({
  nfesSearch: (q, status, limit, offset, dataIni, dataFim, sortBy, sortOrder) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('nfeStatus', status);
    if (dataIni) params.set('dataIni', dataIni);
    if (dataFim) params.set('dataFim', dataFim);
    params.set('includeStarted', '1');
    params.set('limit', limit || 20);
    params.set('offset', offset || 0);
    params.set('sortBy', sortBy || 'pedido');
    params.set('sortOrder', sortOrder || 'desc');
    return `${API_BASE}/api/nfes/search?${params.toString()}`;
  },

  nfesSearchAll: (q, status, dataIni, dataFim, sortBy, sortOrder) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('nfeStatus', status);
    if (dataIni) params.set('dataIni', dataIni);
    if (dataFim) params.set('dataFim', dataFim);
    params.set('includeStarted', '1');
    params.set('limit', '10000');
    params.set('offset', '0');
    params.set('sortBy', sortBy || 'pedido');
    params.set('sortOrder', sortOrder || 'desc');
    return `${API_BASE}/api/nfes/search?${params.toString()}`;
  },

  reconcile: (orderId) => `${API_BASE}/api/nfes/reconcile/${encodeURIComponent(orderId)}`,
  danfePdf: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/danfe`,
  xml: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/xml`,
  cancel: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/cancelar`,
  cce: () => `${API_BASE}/api/nfe/cce`,
  cceStatus: (idOuChaveOuProtocolo) =>
    `${API_BASE}/api/nfe/cce/status/${encodeURIComponent(idOuChaveOuProtocolo)}`,
  cceEventosByOrder: (orderId) =>
    `${API_BASE}/api/nfe/cce/order/${encodeURIComponent(orderId)}`,
  ccePdf: (idOuChave) =>
    `${API_BASE}/api/nfe/cce/pdf/${encodeURIComponent(idOuChave)}`,
  cceXml: (idOuChaveOuProtocolo) =>
    `${API_BASE}/api/nfe/cce/xml/${encodeURIComponent(idOuChaveOuProtocolo)}`,
  details: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/details`,
  billing: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/billing`,
  xmlLote: (params) => `${API_BASE}/api/nfes/xml/lote?${params}`,
  inutilizar: `${API_BASE}/api/nfes/inutilizar`,
});

const state = {
  list: [],
  total: 0,
  page: 1,
  limit: 20,
  q: '',
  status: '',
  dataIni: '',
  dataFim: '',
  sortBy: 'pedido',
  sortOrder: 'desc',
};

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

function formatDateBR(value) {
  if (!value) return '';

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y, m, da] = raw.split('T')[0].split('-');
      return `${da}/${m}/${y}`;
    }
    return raw.slice(0, 10);
  }

  const dia = two(d.getDate());
  const mes = two(d.getMonth() + 1);
  const ano = d.getFullYear();

  return `${dia}/${mes}/${ano}`;
}

function formatMoneyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusToBadgeClass(status) {
  const s = String(status || '').toUpperCase().trim();

  if (
    s === 'AUTORIZADA' ||
    s === 'CONCLUIDO' ||
    s === 'CONCLUÍDO'
  ) {
    return 'badge--approved';
  }

  if (
    s === 'INUTILIZADO' ||
    s.includes('INUTILIZ')
  ) {
    return 'badge--open';
  }

  if (s === 'CANCELADO' || s.includes('CANCEL')) {
    return 'badge--canceled';
  }

  if (s === 'REJEITADA' || s === 'REJEITADO' || s.includes('REJEIT')) {
    return 'badge--canceled';
  }

  return 'badge--open';
}

function formatAmbienteLabel(env) {
  const e = String(env || '').trim().toUpperCase();
  if (!e) return 'N/D';
  if (e.startsWith('PROD')) return 'PRODUÇÃO';
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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normText(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getDisplayStatus(nfe) {
  return (
    nfe.display_status ||
      nfe.nfe_display_status ||
      nfe.nfe_status
      ? String(nfe.display_status || nfe.nfe_display_status || nfe.nfe_status).toUpperCase()
      : (getNfeNumber(nfe) ? 'INICIADA' : 'SEM_NFE')
  );
}

function canIssueCce(status) {
  const s = String(status || '').toUpperCase().trim();
  return ['AUTORIZADA', 'CONCLUIDO', 'CONCLUÍDO'].includes(s);
}

function hasValidNfeKey(key) {
  const value = String(key || '').trim();
  return /^\d{44}$/.test(value);
}

function getComparableValue(nfe, sortBy) {
  switch (sortBy) {
    case 'pedido':
      return Number(nfe.order_number ?? nfe.order_id ?? 0);

    case 'emissao': {
      const raw = nfe.issue_date || nfe.created_at || nfe.updated_at || '';
      const t = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    }

    case 'numero_nfe':
      return Number(getNfeNumber(nfe) || 0);

    case 'chave':
      return normText(getNfeKey(nfe) || '');

    case 'cliente':
      return normText(nfe.customer_name || '');

    case 'documento':
      return normText(nfe.customer_tax_id || '');

    case 'total':
      return Number(nfe.total_amount || 0);

    case 'status':
      return normText(getDisplayStatus(nfe));

    case 'ambiente':
      return normText(nfe.nfe_environment || nfe.environment || '');

    default:
      return Number(nfe.order_number ?? nfe.order_id ?? 0);
  }
}

function sortListLocally(list, sortBy, sortOrder) {
  const arr = Array.isArray(list) ? [...list] : [];
  const factor = sortOrder === 'asc' ? 1 : -1;

  arr.sort((a, b) => {
    const av = getComparableValue(a, sortBy);
    const bv = getComparableValue(b, sortBy);

    if (typeof av === 'number' && typeof bv === 'number') {
      if (av === bv) return 0;
      return av > bv ? factor : -factor;
    }

    const as = String(av ?? '');
    const bs = String(bv ?? '');
    const cmp = as.localeCompare(bs, 'pt-BR', {
      numeric: true,
      sensitivity: 'base',
    });

    return cmp * factor;
  });

  return arr;
}

function updateSortIndicators() {
  document.querySelectorAll('#tblNfes thead th.sortable-th').forEach((th) => {
    const key = th.dataset.sort;
    const indicator = th.querySelector('.sort-indicator');
    const active = key === state.sortBy;

    th.classList.toggle('is-active', active);

    if (!indicator) return;
    indicator.textContent = active ? (state.sortOrder === 'asc' ? '▲' : '▼') : '';
  });

  const sortBySelect = $('#sortByNfes');
  const sortOrderSelect = $('#sortOrderNfes');

  if (sortBySelect) sortBySelect.value = state.sortBy;
  if (sortOrderSelect) sortOrderSelect.value = state.sortOrder;
}

/* =====================================================================
 * Modal Inutilização (NF-e)
 * ===================================================================== */
function openModalInutilizarNfe(prefill = {}) {
  const serie = Number(prefill.serie ?? 1);
  const numeroIni = Number(prefill.numeroIni ?? 0);
  const numeroFim = Number(prefill.numeroFim ?? 0);
  const justificativa = String(prefill.justificativa ?? '').trim();
  const ambiente = String(prefill.ambiente ?? 'prod').trim();

  const s = prompt('Série da NF-e para inutilização:', String(serie));
  if (s === null) return;

  const ni = prompt('Número inicial:', numeroIni > 0 ? String(numeroIni) : '');
  if (ni === null) return;

  const nf = prompt('Número final:', numeroFim > 0 ? String(numeroFim) : ni);
  if (nf === null) return;

  const j = prompt('Justificativa (mínimo 15 caracteres):', justificativa);
  if (j === null) return;

  const amb = prompt('Ambiente (prod ou hom):', ambiente);
  if (amb === null) return;

  submitInutilizacao({
    serie: Number(s),
    numeroIni: Number(ni),
    numeroFim: Number(nf),
    justificativa: String(j || '').trim(),
    ambiente: String(amb || 'prod').trim().toLowerCase(),
  });
}

async function submitInutilizacao({ serie, numeroIni, numeroFim, justificativa, ambiente }) {
  if (!serie || serie < 1) {
    alert('Informe a Série (>= 1).');
    return;
  }

  if (!numeroIni || numeroIni < 1 || !numeroFim || numeroFim < 1 || numeroFim < numeroIni) {
    alert('Informe Nº Inicial e Nº Final corretamente.');
    return;
  }

  if (justificativa.length < 15) {
    alert('Justificativa deve ter no mínimo 15 caracteres.');
    return;
  }

  const ok = confirm(
    `Confirmar inutilização da numeração?\n\nSérie: ${serie}\nDe: ${numeroIni}\nAté: ${numeroFim}\nAmbiente: ${ambiente}\n\n⚠️ A inutilização é irreversível.`,
  );
  if (!ok) return;

  try {
    const currentYear = new Date().getFullYear();

    const payload = {
      companyCnpj: window.EMPRESA_CNPJ || window.companyCnpj || '',
      model: '55',
      serie: Number(serie),
      numberStart: Number(numeroIni),
      numberEnd: Number(numeroFim),
      year: currentYear,
      justification: String(justificativa || '').trim(),
      ambiente: String(ambiente || 'prod').trim().toLowerCase(),
    };

    const res = await fetch(ROUTES.inutilizar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { ok: false, raw: text };
    }

    if (!res.ok || json?.ok === false) {
      console.error('[NFES] inutilizar erro:', json);

      if (isDuplicateInutilizacao(json)) {
        const friendly = extractInutilizacaoDuplicateMessage(json) || extractErrorMessage(json);
        alert(friendly);
        return;
      }

      alert(extractErrorMessage(json) || `Falha na inutilização (HTTP ${res.status}).`);
      return;
    }

    alert(json?.message || 'Inutilização solicitada com sucesso.');
    await fetchNfes();
  } catch (err) {
    console.error('[NFES] inutilizar EXC:', err);
    alert(err?.message || String(err));
  }
}

function bindModalInutilizarOnce() {
  // Mantido para compatibilidade. A inutilização agora usa prompt para evitar
  // dependência de um modal ausente no HTML atual.
}

function extractErrorMessage(payload) {
  if (!payload) return 'Erro desconhecido.';

  if (typeof payload === 'string') return payload;

  if (Array.isArray(payload?.errors) && payload.errors.length) {
    return payload.errors.join('\n');
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }

  if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }

  if (typeof payload?.error?.data?.current?.mensagem === 'string' && payload.error.data.current.mensagem.trim()) {
    return payload.error.data.current.mensagem.trim();
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function extractInutilizacaoDuplicateMessage(payload) {
  const current = payload?.error?.data?.current;
  if (!current) return '';

  const protocol = current.protocol || 'N/D';
  const status = current.status || 'N/D';
  const cStat = current.cStat || 'N/D';
  const mensagem = current.mensagem || current.message || '';

  return [
    'Esta inutilização já foi realizada anteriormente.',
    `Protocolo: ${protocol}`,
    `Status: ${status}`,
    `cStat: ${cStat}`,
    mensagem ? `Mensagem SEFAZ: ${mensagem}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function isDuplicateInutilizacao(payload) {
  const msg = String(
    payload?.error?.message ||
    payload?.message ||
    ''
  ).toUpperCase();

  return (
    msg.includes('JÁ EXISTE UMA INUTILIZAÇÃO DE NUMERAÇÃO') ||
    msg.includes('JA EXISTE UMA INUTILIZACAO DE NUMERACAO')
  );
}

/* =====================================================================
 * Billing UI helpers
 * ===================================================================== */
nfesSearchAll: (q, status, dataIni, dataFim, sortBy, sortOrder) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('nfeStatus', status);
  if (dataIni) params.set('dataIni', dataIni);
  if (dataFim) params.set('dataFim', dataFim);
  params.set('includeStarted', '1');
  params.set('limit', '10000');
  params.set('offset', '0');
  params.set('sortBy', sortBy || 'pedido');
  params.set('sortOrder', sortOrder || 'desc');
  return `${API_BASE}/api/nfes/search?${params.toString()}`;
},

  function renderBillingForOrder(container, billingRows = []) {
    if (!container) return;

    container.innerHTML = '';

    if (!billingRows.length) {
      container.innerHTML = `
      <p class="nfe-billing-empty nfe-details-muted">
        Nenhuma cobrança vinculada a este pedido.
      </p>
    `;
      return;
    }

    const table = document.createElement('table');
    table.className = 'tbl tbl-sm nfe-billing-table';

    table.innerHTML = `
    <thead>
      <tr>
        <th>Origem</th>
        <th>Tipo</th>
        <th>Valor</th>
        <th>Vencimento</th>
        <th>Pago em</th>
        <th>Status</th>
        <th>Parcela</th>
        <th>Boleto</th>
      </tr>
    </thead>
    <tbody>
      ${billingRows.map((row) => {
      const parcela =
        row.installment_number && row.installments_total
          ? `${row.installment_number}/${row.installments_total}`
          : row.installment_number
            ? `${row.installment_number}`
            : '-';

      const boletoLink = row.bank_slip_pdf_url || row.bank_slip_url || null;

      return `
          <tr>
            <td>${row.billing_source || '-'}</td>
            <td>${row.billing_type || '-'}</td>
            <td>R$ ${formatMoneyBR(row.amount)}</td>
            <td>${formatDateBR(row.due_date)}</td>
            <td>${formatDateBR(row.paid_date)}</td>
            <td>${row.status || '-'}</td>
            <td>${parcela || '-'}</td>
            <td>
              ${boletoLink
          ? `<a href="${boletoLink}" target="_blank" rel="noopener noreferrer">Ver boleto</a>`
          : '-'}
            </td>
          </tr>
        `;
    }).join('')}
    </tbody>
  `;

    container.appendChild(table);
  }

/* =====================================================================
 * Bind e busca
 * ===================================================================== */
function applyFiltersFromUI() {
  state.q = $('#qNfes')?.value.trim() || '';
  state.status = $('#statusNfe')?.value || '';
  state.dataIni = $('#dataIniNfes')?.value || '';
  state.dataFim = $('#dataFimNfes')?.value || '';
  state.limit = Number($('#limitNfes')?.value || 20) || 20;
  state.sortBy = $('#sortByNfes')?.value || 'pedido';
  state.sortOrder = $('#sortOrderNfes')?.value || 'desc';
}

function csvEscape(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function buildNfesCsv(rows = []) {
  const headers = [
    'Pedido',
    'Order ID',
    'Emissao',
    'Numero NFe',
    'Chave de Acesso',
    'Cliente',
    'CNPJ/CPF',
    'Email Cliente',
    'Total (R$)',
    'Status NFe',
    'Ambiente',
    'Data Criacao',
    'Data Atualizacao',
  ];

  const lines = [headers.map(csvEscape).join(';')];

  for (const nfe of rows) {
    const orderId = nfe.order_id ?? '';
    const pedido = nfe.order_number ?? orderId ?? '';
    const emissao = formatDateTimeBR(nfe.issue_date || nfe.created_at || '');
    const numeroNfe = getNfeNumber(nfe) ?? '';
    const chave = getNfeKey(nfe) ?? '';
    const cliente = nfe.customer_name ?? '';
    const documento = nfe.customer_tax_id ?? '';
    const email = nfe.customer_email ?? nfe.email ?? nfe.customerEmail ?? '';
    const total = formatMoneyBR(nfe.total_amount || 0);
    const status = getDisplayStatus(nfe);
    const ambiente = formatAmbienteLabel(nfe.nfe_environment || nfe.environment || '');
    const createdAt = formatDateTimeBR(nfe.created_at || '');
    const updatedAt = formatDateTimeBR(nfe.updated_at || '');

    const row = [
      pedido,
      orderId,
      emissao,
      numeroNfe,
      chave,
      cliente,
      documento,
      email,
      total,
      status,
      ambiente,
      createdAt,
      updatedAt,
    ];

    lines.push(row.map(csvEscape).join(';'));
  }

  return '\uFEFF' + lines.join('\r\n');
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportarRelatorioNfesCsv(btn) {
  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = '⏳ Exportando...';
    }

    applyFiltersFromUI();

    const url = ROUTES.nfesSearchAll(
      state.q,
      state.status,
      state.dataIni,
      state.dataFim,
      state.sortBy,
      state.sortOrder,
    );

    console.debug('[NFES] export csv:', url);

    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    const js = text ? JSON.parse(text) : {};

    if (!r.ok) {
      throw new Error(js?.error || `Falha ao exportar relatório (HTTP ${r.status}).`);
    }

    const rows = Array.isArray(js?.rows) ? js.rows : Array.isArray(js?.data) ? js.data : [];
    const orderedRows = sortListLocally(rows, state.sortBy, state.sortOrder);

    if (!orderedRows.length) {
      alert('Nenhuma NF-e encontrada para exportar com os filtros atuais.');
      return;
    }

    const csv = buildNfesCsv(orderedRows);

    const hoje = new Date();
    const yyyy = hoje.getFullYear();
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    const dd = String(hoje.getDate()).padStart(2, '0');
    const hh = String(hoje.getHours()).padStart(2, '0');
    const mi = String(hoje.getMinutes()).padStart(2, '0');

    const nomeArquivo = `relatorio_nfes_${yyyy}-${mm}-${dd}_${hh}-${mi}.csv`;

    downloadTextFile(nomeArquivo, csv, 'text/csv;charset=utf-8;');
  } catch (err) {
    console.error('[NFES] erro exportando CSV:', err);
    alert(err?.message || 'Erro ao exportar relatório de NF-e.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '📊 Exportar Relatório';
    }
  }
}

function bindUI() {
  $('#btnBuscarNfes')?.addEventListener('click', () => {
    applyFiltersFromUI();
    state.page = 1;
    fetchNfes();
  });

  $('#qNfes')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyFiltersFromUI();
      state.page = 1;
      fetchNfes();
    }
  });

  $('#dataIniNfes')?.addEventListener('change', () => {
    state.dataIni = $('#dataIniNfes')?.value || '';
  });

  $('#dataFimNfes')?.addEventListener('change', () => {
    state.dataFim = $('#dataFimNfes')?.value || '';
  });

  $('#limitNfes')?.addEventListener('change', (e) => {
    state.limit = Number(e.target.value) || 20;
    state.page = 1;
    fetchNfes();
  });

  $('#statusNfe')?.addEventListener('change', () => {
    state.status = $('#statusNfe')?.value || '';
    state.page = 1;
    fetchNfes();
  });

  $('#sortByNfes')?.addEventListener('change', () => {
    state.sortBy = $('#sortByNfes')?.value || 'pedido';
    state.page = 1;
    fetchNfes();
  });

  $('#sortOrderNfes')?.addEventListener('change', () => {
    state.sortOrder = $('#sortOrderNfes')?.value || 'desc';
    state.page = 1;
    fetchNfes();
  });

  document.querySelectorAll('#tblNfes thead th.sortable-th').forEach((th) => {
    th.addEventListener('click', () => {
      const clickedSort = th.dataset.sort;
      if (!clickedSort) return;

      if (state.sortBy === clickedSort) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = clickedSort;
        state.sortOrder =
          clickedSort === 'cliente' || clickedSort === 'status' || clickedSort === 'ambiente'
            ? 'asc'
            : 'desc';
      }

      updateSortIndicators();
      state.page = 1;
      fetchNfes();
    });
  });

  $('#prevNfes')?.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      fetchNfes();
    }
  });

  $('#nextNfes')?.addEventListener('click', () => {
    const max = Math.ceil(state.total / state.limit) || 1;
    if (state.page < max) {
      state.page++;
      fetchNfes();
    }
  });

  $('#btnRecarregarNfes')?.addEventListener('click', () => fetchNfes());

  $('#btnDownloadXmlLote')?.addEventListener('click', () => {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.status) params.set('nfeStatus', state.status);
    if (state.dataIni) params.set('dataIni', state.dataIni);
    if (state.dataFim) params.set('dataFim', state.dataFim);
    params.set('sortBy', state.sortBy || 'pedido');
    params.set('sortOrder', state.sortOrder || 'desc');

    const url = ROUTES.xmlLote(params.toString());
    console.debug('[NFES] XML LOTE →', url);
    window.open(url, '_blank');
  });

  $('#btnExportarRelatorioNfes')?.addEventListener('click', async (e) => {
    await exportarRelatorioNfesCsv(e.currentTarget);
  });

  updateSortIndicators();
}

async function fetchNfes() {
  const offset = (state.page - 1) * state.limit;

  const url = ROUTES.nfesSearch(
    state.q,
    state.status,
    state.limit,
    offset,
    state.dataIni,
    state.dataFim,
    state.sortBy,
    state.sortOrder,
  );

  console.debug('[NFES] fetch:', url);

  let js;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    js = text ? JSON.parse(text) : {};

    if (!r.ok) {
      console.error('[NFES] HTTP', r.status, js);
      js = { ok: false, rows: [], total: 0, error: js?.error || `HTTP ${r.status}` };
    }
  } catch (e) {
    console.error('[NFES] erro ao buscar:', e);
    js = { ok: false, rows: [], total: 0, error: String(e?.message || e) };
  }

  const rows = Array.isArray(js?.rows) ? js.rows : Array.isArray(js?.data) ? js.data : [];
  const total = Number(js?.total ?? rows.length) || 0;

  state.list = sortListLocally(rows, state.sortBy, state.sortOrder);
  state.total = total;

  console.debug(
    '[NFES] rows:',
    state.list.length,
    'total:',
    state.total,
    'source:',
    js.source,
    'ok:',
    js.ok,
    'sortBy:',
    state.sortBy,
    'sortOrder:',
    state.sortOrder,
  );

  renderNfes();
}

/* =====================================================================
 * Render detalhes
 * ===================================================================== */
function renderNfeDetailsHtml(data) {
  if (!data) {
    return '<div class="nfe-details-error">Detalhes não disponíveis.</div>';
  }

  const summary = data.summary || data.resumo || null;
  const errors = data.errors || data.erros || data.rejections || [];
  const payments = data.payments || data.pagamentos || [];
  const timeline = data.timeline || data.historico || data.history || [];

  const summaryBlock = summary
    ? `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(summary, null, 2))}</pre>`
    : '<div class="nfe-details-muted">Sem resumo estruturado.</div>';

  const errorsBlock = errors?.length
    ? `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(errors, null, 2))}</pre>`
    : '<div class="nfe-details-ok">Sem erros registrados.</div>';

  const paymentsBlock = payments?.length
    ? `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(payments, null, 2))}</pre>`
    : '<div class="nfe-details-muted">Nenhuma forma de pagamento extraída do XML.</div>';

  const timelineBlock = timeline?.length
    ? `<ul class="nfe-timeline">
        ${timeline
      .map(
        (t) => `
          <li>
            <span class="nfe-timeline-status">${escapeHtml(t.status || t.situacao || '')}</span>
            <small class="nfe-timeline-date">${escapeHtml(t.at || t.data || t.ts || '')}</small>
          </li>`,
      )
      .join('')}
       </ul>`
    : '<div class="nfe-details-muted">Nenhum histórico retornado.</div>';

  const rawBlock = `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;

  return `
    <div class="nfe-details-grid">
      <div class="nfe-details-col">
        <h4>📄 Resumo</h4>
        ${summaryBlock}

        <h4>🔄 Histórico de Status</h4>
        ${timelineBlock}
      </div>

      <div class="nfe-details-col">
        <h4>⚠️ Erros / Avisos</h4>
        ${errorsBlock}

        <h4>💳 Formas de Pagamento (XML)</h4>
        ${paymentsBlock}

        <h4>💳 Cobrança / Billing (ERP / Asaas)</h4>
        <div class="nfe-billing-container" data-billing-container>
          <div class="nfe-details-muted">Carregando cobrança vinculada ao pedido...</div>
        </div>
      </div>
    </div>

    <details class="nfe-details-raw">
      <summary>Ver JSON completo retornado pela API</summary>
      ${rawBlock}
    </details>
  `;
}

/* =====================================================================
 * Toggle da linha de detalhes
 * ===================================================================== */
async function toggleDetailsRow(rowKey, orderId, btn) {
  if (!rowKey) return;

  const row = document.querySelector(`.nfe-details-row[data-order-id="${rowKey}"]`);
  if (!row) return;

  const container = row.querySelector('.nfe-details-container');
  const isOpen = row.style.display === 'table-row';

  if (isOpen) {
    row.style.display = 'none';
    if (btn) btn.textContent = '▸';
    return;
  }

  row.style.display = 'table-row';
  if (btn) btn.textContent = '▾';

  if (container?.dataset.loaded === '1') return;

  if (!orderId) {
    container.innerHTML =
      '<div class="nfe-details-muted">Registro sem vínculo com Pedido no ERP (order_id ausente). Nenhum detalhe adicional disponível.</div>';
    container.dataset.loaded = '1';
    return;
  }

  container.innerHTML = '<div class="nfe-details-loading">Carregando detalhes da NF-e...</div>';

  try {
    const r = await fetch(ROUTES.details(orderId), { headers: { Accept: 'application/json' } });
    const js = await r.json().catch(() => null);

    if (!js) {
      container.innerHTML = '<div class="nfe-details-error">Não foi possível carregar os detalhes.</div>';
      return;
    }

    container.innerHTML = renderNfeDetailsHtml(js);
    container.dataset.loaded = '1';

    const billingContainer = container.querySelector('[data-billing-container]');
    if (billingContainer) {
      try {
        const br = await fetch(ROUTES.billing(orderId), { headers: { Accept: 'application/json' } });
        const bj = await br.json().catch(() => null);

        if (bj && bj.ok) {
          renderBillingForOrder(billingContainer, bj.rows || []);
        } else {
          renderBillingForOrder(billingContainer, []);
        }
      } catch {
        renderBillingForOrder(billingContainer, []);
      }
    }
  } catch (err) {
    console.error('[NFES] details EXC:', err);
    container.innerHTML = '<div class="nfe-details-error">Erro ao carregar os detalhes desta NF-e.</div>';
  }
}

/* =====================================================================
 * Render
 * ===================================================================== */
function renderNfes() {
  const tbody = $('#tblNfes tbody');
  const empty = $('#emptyNfes');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (empty) empty.style.display = state.list.length ? 'none' : 'block';

  for (const nfe of state.list) {
    const orderIdRaw = nfe.order_id ?? null;

    const rowKey =
      (orderIdRaw !== null && orderIdRaw !== undefined && String(orderIdRaw).trim() !== '')
        ? String(orderIdRaw).trim()
        : String(
          getNfeKey(nfe) ||
          getNfeNumber(nfe) ||
          `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        );

    const orderId =
      orderIdRaw !== null && orderIdRaw !== undefined && String(orderIdRaw).trim() !== ''
        ? String(orderIdRaw).trim()
        : '';

    const number = nfe.order_number || orderId || '';
    const dataHora = formatDateTimeBR(nfe.issue_date);
    const cli = nfe.customer_name || '';
    const doc = nfe.customer_tax_id || '';
    const customerEmail = (nfe.customer_email || nfe.email || nfe.customerEmail || '').toString().trim();
    const total = Number(nfe.total_amount || 0);
    const status = getDisplayStatus(nfe);
    const numNfe = getNfeNumber(nfe);
    const chaveNfe = getNfeKey(nfe);
    const ambiente = (nfe.nfe_environment || nfe.environment || '').trim();

    const numNfeLabel = numNfe ?? '— —';
    const chaveNfeFull = chaveNfe && String(chaveNfe).trim() ? String(chaveNfe).trim() : '';
    const chaveNfeLabel = chaveNfeFull || '— —';
    const canSendCce = canIssueCce(status);
    const canDownloadCce = hasValidNfeKey(chaveNfeFull);

    const tr = document.createElement('tr');
    tr.classList.add('nfe-row');
    tr.dataset.orderId = orderId;
    tr.dataset.rowKey = rowKey;

    const isCanceled = status === 'CANCELADO' || status.includes('CANCEL');
    tr.classList.toggle('nfe-row-canceled', isCanceled);

    tr.innerHTML = `
      <td class="caret-cell">
        <button
          class="caret-btn"
          data-act="toggleDetails"
          data-row="${escapeAttr(rowKey)}"
          data-id="${escapeAttr(orderId)}"
          title="Mostrar detalhes da NF-e"
        >▸</button>
      </td>

      <td class="num">${escapeHtml(number)}</td>
      <td class="nowrap">${escapeHtml(dataHora)}</td>
      <td class="td-nfe-num">${escapeHtml(numNfeLabel)}</td>
      <td class="td-chave" title="${escapeAttr(chaveNfeLabel)}">${escapeHtml(chaveNfeLabel)}</td>
      <td title="${escapeAttr(cli)}">${cli.length > 29 ? escapeHtml(cli.slice(0, 29) + '…') : escapeHtml(cli)}</td>
      <td class="num">${escapeHtml(doc)}</td>
      <td class="money ta-right">${fmtMoney(total)}</td>

      <td>
        <span class="badge ${statusToBadgeClass(status)}">
          ${escapeHtml(status.charAt(0) + status.slice(1).toLowerCase())}
        </span>
      </td>

      <td>
        <span class="badge ${ambienteToBadgeClass(ambiente)}">
          ${escapeHtml(formatAmbienteLabel(ambiente))}
        </span>
      </td>

      <td class="row gap-8">
        <button
          class="btn btn-flat btn-sm"
          data-act="viewOrder"
          data-id="${escapeAttr(orderId)}"
          ${orderId ? '' : 'disabled'}
        >
          🔍 Pedido
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="refresh"
          data-id="${escapeAttr(orderId)}"
          title="Atualizar status"
          ${orderId ? '' : 'disabled'}
        >
          🔄
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="pdf"
          data-id="${escapeAttr(orderId)}"
          title="Baixar DANFE"
          ${orderId ? '' : 'disabled'}
        >
          🧾
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="xml"
          data-id="${escapeAttr(orderId)}"
          title="Baixar XML"
          ${orderId ? '' : 'disabled'}
        >
          📄
        </button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="email"
          data-id="${escapeAttr(orderId)}"
          data-nfe-number="${escapeAttr(numNfeLabel)}"
          data-nfe-key="${escapeAttr(chaveNfeLabel)}"
          data-nfe-status="${escapeAttr(status)}"
          data-customer-name="${escapeAttr(cli)}"
          data-customer-doc="${escapeAttr(doc)}"
          data-customer-email="${escapeAttr(customerEmail)}"
          title="Enviar NF-e por e-mail (DANFE+XML)"
          style="border:1px solid rgba(148,163,184,.65);"
          ${orderId ? '' : 'disabled'}
        >✉️</button>

        <button
          class="btn btn-danger btn-sm btn-icon"
          data-act="cancel"
          data-id="${escapeAttr(orderId)}"
          data-nfe-number="${escapeAttr(numNfeLabel)}"
          data-nfe-key="${escapeAttr(chaveNfeLabel)}"
          data-nfe-status="${escapeAttr(status)}"
          title="Cancelar NF-e"
          ${orderId ? '' : 'disabled'}
        >❌</button>

        <button
          class="btn btn-primary btn-sm btn-icon"
          data-act="cce"
          data-id="${escapeAttr(orderId)}"
          data-nfe-number="${escapeAttr(numNfeLabel)}"
          data-nfe-key="${escapeAttr(chaveNfeLabel)}"
          data-nfe-status="${escapeAttr(status)}"
          title="${canSendCce ? 'Carta de Correção Eletrônica' : 'CC-e disponível apenas para NF-e autorizada/concluída'}"
          ${orderId && canSendCce ? '' : 'disabled'}
        >📝</button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="ccePdf"
          data-key="${escapeAttr(chaveNfeFull)}"
          title="Baixar PDF da CC-e"
          ${canDownloadCce ? '' : 'disabled'}
        >📑</button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="cceXml"
          data-key="${escapeAttr(chaveNfeFull)}"
          title="Baixar XML da CC-e"
          ${canDownloadCce ? '' : 'disabled'}
        >🧷</button>

        <button
          class="btn btn-flat btn-sm btn-icon"
          data-act="inutilizar"
          title="Inutilizar numeração (NF-e)"
          style="border:1px solid rgba(148,163,184,.65);"
        >🧾🚫</button>
      </td>
    `;

    tbody.appendChild(tr);

    const detailsTr = document.createElement('tr');
    detailsTr.classList.add('nfe-details-row');
    detailsTr.setAttribute('data-order-id', rowKey);
    detailsTr.style.display = 'none';

    detailsTr.innerHTML = `
      <td colspan="11">
        <div class="nfe-details-container" id="nfe-details-${escapeAttr(rowKey)}" data-loaded="0"></div>
      </td>
    `;

    tbody.appendChild(detailsTr);
  }

  const max = Math.ceil(state.total / state.limit) || 1;
  $('#totalInfoNfes').textContent = `${state.total} NF-e(s)`;
  $('#pageInfoNfes').textContent = `Página ${state.page} de ${max}`;
  $('#prevNfes').disabled = state.page <= 1;
  $('#nextNfes').disabled = state.page >= max;

  updateSortIndicators();

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

    if (act === 'ccePdf') {
      const key = btn.dataset.key;
      if (!key) return;
      window.open(ROUTES.ccePdf(key), '_blank');
      return;
    }

    if (act === 'cceXml') {
      const key = btn.dataset.key;
      if (!key) return;
      window.open(ROUTES.cceXml(key), '_blank');
      return;
    }

    if (act === 'email') {
      await openNfeSendEmailModal({
        apiBase: API_BASE,
        orderId: id,
        nfeNumber: btn.dataset.nfeNumber || '',
        nfeKey: btn.dataset.nfeKey || '',
        status: btn.dataset.nfeStatus || '',
        customerName: btn.dataset.customerName || '',
        customerDoc: btn.dataset.customerDoc || '',
        defaultTo: (btn.dataset.customerEmail || '').trim(),
      });
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
        route: ROUTES.cce(),
        createdBy: window.currentUserName || window.currentUser?.name || '',
      });
      return;
    }

    if (act === 'toggleDetails') {
      await toggleDetailsRow(btn.dataset.row, btn.dataset.id || '', btn);
      return;
    }

    if (act === 'inutilizar') {
      openModalInutilizarNfe({ serie: 1, ambiente: 'prod' });
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

    await r.json().catch(() => ({}));
    await fetchNfes();

    btn.textContent = original;
  } catch (err) {
    console.error('[NFES] reconcile EXC:', err);
  } finally {
    btn.disabled = false;
  }
}

/* =====================================================================
 * Boot
 * ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  bindModalInutilizarOnce();
  bindUI();
  applyFiltersFromUI();
  updateSortIndicators();
  fetchNfes();
});

window.addEventListener('nfes:reload', () => {
  fetchNfes();
});