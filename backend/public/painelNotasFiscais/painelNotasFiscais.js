// ╔════════════════════════════════════════════════════════════════════╗
// ║ painelNotasFiscais.js — Notas Fiscais Sistema Antigo | CONSART ERP ║
// ║  - Lista paginada no backend (busca, período, ordenação)          ║
// ║  - Ações: ver XML, baixar XML, DANFE em PDF                       ║
// ║  - Avisos via centerAlertModal                                    ║
// ╚════════════════════════════════════════════════════════════════════╝

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API = '/api/painel-notas-fiscais';
const COLSPAN = 7;
const SEARCH_DELAY_MS = 350;

const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  pageSize: 50,
  totalPages: 1,
  sortColumn: 'emissao',
  sortDirection: 'desc',
  rows: [],
  requestSeq: 0
};

// ──────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

/** CNPJ/CPF sempre com máscara (completa zeros perdidos em XMLs antigos). */
function formatDocument(value) {
  let digits = onlyDigits(value);
  if (!digits) return '';
  if (digits.length > 11 && digits.length < 14) digits = digits.padStart(14, '0');
  if (digits.length < 11) digits = digits.padStart(11, '0');

  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return digits;
}

/** "2023-12-05T15:59:00-03:00" → "05/12/2023 15:59" (hora do emitente). */
function formatDateTimeBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value ?? '').trim());
  if (!match) return '';
  const [, y, m, d, hh, mi] = match;
  // Notas sem hora no XML vêm como 00:00: mostra só a data
  const hasTime = hh && !(hh === '00' && mi === '00');
  return `${d}/${m}/${y}${hasTime ? ` ${hh}:${mi}` : ''}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function plural(count, one, many) {
  return `${Number(count).toLocaleString('pt-BR')} ${count === 1 ? one : many}`;
}

function showError(title, message) {
  return showCenterModal({ variant: 'error', title, message });
}

// ──────────────────────────────────────────────────────────────────────
// FILTROS
// ──────────────────────────────────────────────────────────────────────
const PLACEHOLDERS = {
  all: 'Cliente, CNPJ/CPF, nº da NF, valor ou chave...',
  cliente: 'Nome do cliente (destinatário)...',
  cnpj: 'CNPJ ou CPF, com ou sem pontuação...',
  numero: 'Número da NF. Ex.: 5530',
  valor: 'Valor da NF. Ex.: 1.625,71',
  arquivo: 'Chave de acesso ou nome do arquivo...'
};

function syncPlaceholder() {
  $('fQ').placeholder = PLACEHOLDERS[$('fCampo').value] || PLACEHOLDERS.all;
}

function readFilters() {
  return {
    filtro: $('fQ').value.trim(),
    campo: $('fCampo').value || 'all',
    dataDe: $('fDe').value || '',
    dataAte: $('fAte').value || ''
  };
}

async function validateDates() {
  const { dataDe, dataAte } = readFilters();
  if (dataDe && dataAte && dataDe > dataAte) {
    await showCenterModal({
      variant: 'warning',
      title: 'Período inválido',
      message: 'A data inicial da emissão é maior que a data final.'
    });
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────
// CARREGAR LISTA
// ──────────────────────────────────────────────────────────────────────
function setLoading(message = 'Carregando...') {
  $('tbody').innerHTML = `<tr><td colspan="${COLSPAN}" class="td-center">${escapeHtml(message)}</td></tr>`;
  $('prevPage').disabled = true;
  $('nextPage').disabled = true;
}

async function load() {
  const seq = ++state.requestSeq;
  const filters = readFilters();

  const params = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize),
    campo: filters.campo,
    ordenarPor: state.sortColumn,
    sentido: state.sortDirection
  });
  if (filters.filtro) params.set('filtro', filters.filtro);
  if (filters.dataDe) params.set('dataDe', filters.dataDe);
  if (filters.dataAte) params.set('dataAte', filters.dataAte);

  setLoading();

  try {
    const response = await fetch(`${API}/xmls?${params}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.erro || data?.error || `HTTP ${response.status}`);
    }

    // Uma resposta antiga (busca digitada antes) não sobrescreve a atual
    if (seq !== state.requestSeq) return;

    state.rows = Array.isArray(data.arquivos) ? data.arquivos : (data.itens || []);
    state.page = Number(data.page) || 1;
    state.totalPages = Number(data.totalPages) || 1;

    renderTable();
    renderFooter(Number(data.total) || 0, data.valorTotalFiltrado);
  } catch (err) {
    if (seq !== state.requestSeq) return;
    console.error('[painelNotasFiscais] Erro ao carregar:', err);
    state.rows = [];
    setLoading('Não foi possível carregar as notas fiscais.');
    $('tableInfo').textContent = '0 notas';
    $('pageInfo').textContent = 'Página 1 de 1';
    $('sumCount').textContent = '0 notas';
    $('sumTotal').textContent = formatMoney(0);
    showError('Erro ao carregar', `Não foi possível carregar as notas fiscais: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────────
// RENDER
// ──────────────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = $('tbody');

  if (!state.rows.length) {
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="td-center">Nenhuma nota fiscal encontrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.rows.map((row, index) => {
    const numero = String(row.numero ?? '').replace(/^0+/, '') || '-';
    const cliente = row.cliente && row.cliente !== '-' ? row.cliente : '';
    const documento = formatDocument(row.cnpj);
    const emissao = formatDateTimeBR(row.emissao);
    const valor = formatMoney(row.valorTotal);
    const chave = onlyDigits(row.chave);

    return `
      <tr>
        <td><strong>${escapeHtml(numero)}</strong></td>
        <td>${escapeHtml(emissao || '-')}</td>
        <td class="td-left" title="${escapeHtml(cliente)}">${escapeHtml(cliente || '-')}</td>
        <td>${escapeHtml(documento || '-')}</td>
        <td class="td-right"><strong>${escapeHtml(valor || '-')}</strong></td>
        <td class="td-left" title="${escapeHtml(chave ? `Chave: ${chave}` : row.nome)}">${escapeHtml(row.nome || '-')}</td>
        <td>${actionIconsHtml([
          { action: 'view', title: 'Ver XML', attrs: { 'data-act': 'view', 'data-index': index } },
          { action: 'download', title: 'Baixar XML', attrs: { 'data-act': 'download', 'data-index': index } },
          { action: 'document', title: 'Baixar DANFE (PDF)', attrs: { 'data-act': 'danfe', 'data-index': index } }
        ])}</td>
      </tr>`;
  }).join('');
}

function renderFooter(total, valorTotal) {
  const start = total ? (state.page - 1) * state.pageSize + 1 : 0;
  const end = Math.min(total, state.page * state.pageSize);

  $('tableInfo').textContent = total
    ? `${start.toLocaleString('pt-BR')}–${end.toLocaleString('pt-BR')} de ${plural(total, 'nota', 'notas')}`
    : '0 notas';
  $('pageInfo').textContent = `Página ${state.page} de ${state.totalPages}`;
  $('prevPage').disabled = state.page <= 1;
  $('nextPage').disabled = state.page >= state.totalPages;

  $('sumCount').textContent = plural(Number(total), 'nota', 'notas');
  $('sumTotal').textContent = formatMoney(valorTotal || 0);
}

// ──────────────────────────────────────────────────────────────────────
// AÇÕES
// ──────────────────────────────────────────────────────────────────────
function xmlPathOf(row) {
  return row.caminho || `/public/painelNotasFiscais/xmlAntigasBh3/${encodeURIComponent(row.nome || '')}`;
}

function viewXml(row) {
  window.open(xmlPathOf(row), '_blank', 'noopener');
}

function downloadXml(row) {
  const a = document.createElement('a');
  a.href = xmlPathOf(row);
  a.download = row.nome || 'nota.xml';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadDanfe(row, button) {
  if (button) button.disabled = true;

  try {
    const chave = onlyDigits(row.chave);
    const response = await fetch(`${API}/danfe/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(chave.length === 44 ? { chave } : {}),
        xmlPath: xmlPathOf(row)
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.erro || data?.error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileName = disposition.match(/filename="([^"]+)"/i)?.[1]
      || `DANFE_${chave || String(row.numero || 'nota')}.pdf`;

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('[painelNotasFiscais] DANFE:', err);
    showError('Erro ao gerar DANFE', `Não foi possível gerar o PDF da NF ${row.numero || ''}: ${err.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

// ──────────────────────────────────────────────────────────────────────
// EVENTOS
// ──────────────────────────────────────────────────────────────────────
function reloadFromFirstPage() {
  state.page = 1;
  load();
}

let searchTimer = null;

function bindEvents() {
  $('fQ').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reloadFromFirstPage, SEARCH_DELAY_MS);
  });

  $('fQ').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(searchTimer);
    reloadFromFirstPage();
  });

  $('fCampo').addEventListener('change', () => {
    syncPlaceholder();
    if ($('fQ').value.trim()) reloadFromFirstPage();
  });

  ['fDe', 'fAte'].forEach((id) => {
    $(id).addEventListener('change', async () => {
      if (await validateDates()) reloadFromFirstPage();
    });
  });

  $('btnSearch').addEventListener('click', async () => {
    clearTimeout(searchTimer);
    if (await validateDates()) reloadFromFirstPage();
  });

  $('btnClear').addEventListener('click', () => {
    clearTimeout(searchTimer);
    $('fQ').value = '';
    $('fCampo').value = 'all';
    $('fDe').value = '';
    $('fAte').value = '';
    syncPlaceholder();
    reloadFromFirstPage();
  });

  $('prevPage').addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      load();
    }
  });

  $('nextPage').addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      load();
    }
  });

  $('perPage').addEventListener('change', () => {
    state.pageSize = Number($('perPage').value) || 50;
    reloadFromFirstPage();
  });

  $('tbody').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;

    const row = state.rows[Number(button.dataset.index)];
    if (!row) return;

    if (button.dataset.act === 'view') viewXml(row);
    if (button.dataset.act === 'download') downloadXml(row);
    if (button.dataset.act === 'danfe') downloadDanfe(row, button);
  });

  createSortableTable({
    table: $('nfTable'),
    defaultColumn: state.sortColumn,
    defaultDirection: state.sortDirection,
    allowedColumns: ['numero', 'emissao', 'cliente', 'cnpj', 'valor', 'nome'],
    onSort: ({ column, direction }) => {
      state.sortColumn = column;
      state.sortDirection = direction;
      reloadFromFirstPage();
    }
  });
}

// ──────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.pageSize = Number($('perPage').value) || 50;
  syncPlaceholder();
  bindEvents();
  load();
});
