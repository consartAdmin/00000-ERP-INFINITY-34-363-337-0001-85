// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.filters.js                                                ║
// ║ MODULE: NF-es Filters / Export                                       ║
// ║ CONSART ERP                                                          ║
// ║ Filtros, CSV e exportação                                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './nfes.config.js';
import { state } from './nfes.state.js';
import {
  $,
  formatDateTimeBR,
  formatMoneyBR,
  formatAmbienteLabel,
  getNfeNumber,
  getNfeKey,
  getDisplayStatus,
  sortListLocally,
} from './nfes.utils.js';

export function applyFiltersFromUI() {
  state.q = $('#qNfes')?.value.trim() || '';
  state.status = $('#statusNfe')?.value || '';
  state.dataIni = $('#dataIniNfes')?.value || '';
  state.dataFim = $('#dataFimNfes')?.value || '';
  state.limit = Number($('#limitNfes')?.value || 20) || 20;
  state.sortBy = $('#sortByNfes')?.value || 'pedido';
  state.sortOrder = $('#sortOrderNfes')?.value || 'desc';
}

export function csvEscape(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildNfesCsv(rows = []) {
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

export function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8;') {
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

export async function exportarRelatorioNfesCsv(btn) {
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