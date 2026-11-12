// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: customersList.render.js                                       ║
// ║ MODULE: Customers List — Render                                     ║
// ║ CONSART ERP                                                         ║
// ║ Customer rows, status badges, counters and pagination rendering     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { lookups, state } from './customersList.state.js';
import {
  $,
  escapeHtml,
  fmtBool,
  onlyDigits,
  pick,
  safe,
} from './customersList.utils.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

/** Linha única de aviso na tabela (carregando, vazio ou erro). */
export function renderTableMessage(message) {
  const tbody = $('#tbody');
  if (!tbody) return;
  const cols = document.querySelectorAll('#customersTable thead th').length || 1;
  tbody.innerHTML =
    `<tr><td class="table-empty-state" colspan="${cols}">${escapeHtml(message)}</td></tr>`;
}

export function renderRows(rows) {
  const tbody = $('#tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!rows.length) {
    renderTableMessage('Nenhum cliente encontrado com esses filtros.');
    return;
  }

  for (const customer of rows) {
    const id = pick(customer.customer_id, customer.id, customer.customerId);
    const name = pick(
      customer.trade_name,
      customer.fantasy_name,
      customer.nome_fantasia,
      customer.name,
      customer.legal_name,
      customer.social_reason
    );
    const taxId = pick(
      customer.tax_id,
      customer.cnpj_cpf,
      customer.cnpjCpf,
      customer.cpf_cnpj
    );
    const postalDigits = onlyDigits(pick(customer.postal_code, customer.cep));
    const postalCode = postalDigits.length === 8
      ? postalDigits.replace(/^(\d{5})(\d{3})$/, '$1-$2')
      : pick(customer.postal_code, customer.cep);

    const sellerFromRow = pick(
      customer.salesperson,
      customer.salesperson_id,
      customer.seller_id,
      customer.vendedor_id,
      customer.sellerId,
      customer.vendedorId
    );
    const sellerKey = pick(
      sellerFromRow,
      id != null ? lookups.sellerByCustomerId.get(String(id)) : null
    );
    let sellerName = null;
    if (String(sellerKey || '').startsWith('__NAME__:')) {
      sellerName = String(sellerKey).replace('__NAME__:', '').trim() || null;
    } else if (sellerKey != null && sellerKey !== '') {
      sellerName =
        lookups.sellersById.get(String(sellerKey)) ??
        lookups.sellersById.get(onlyDigits(sellerKey)) ??
        String(sellerKey);
    }

    const segmentKey = pick(
      customer.business_segment,
      customer.segment_id,
      customer.segment_code,
      customer.segmento,
      customer.segmentKey
    );
    const segmentName =
      segmentKey == null || segmentKey === ''
        ? null
        : lookups.segmentsByKey.get(String(segmentKey)) ??
        lookups.segmentsByKey.get(onlyDigits(segmentKey)) ??
        String(segmentKey);

    const statusKey = pick(
      customer.status_type_id,
      customer.customer_status_type_id,
      customer.customer_status_id,
      customer.status_id,
      customer.status_type,
      customer.status_code,
      customer.internal_code
    );
    const statusLabel =
      pick(
        customer.status_name_pt,
        customer.status_name,
        customer.status_label,
        customer.customer_status_name,
        customer.customer_status_label,
        customer.status_pt,
        customer.status,
        customer.status_cliente
      ) ||
      (statusKey != null
        ? lookups.statusById.get(String(statusKey)) ??
        lookups.statusById.get(onlyDigits(statusKey))
        : null);
    const statusColor = pick(
      customer.status_color_hex,
      customer.status_color,
      customer.statusColor
    );

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(safe(id))}</td>
      <td>${escapeHtml(safe(name))}</td>
      <td>${escapeHtml(safe(taxId))}</td>
      <td>${escapeHtml(safe(pick(customer.email, customer.mail)))}</td>
      <td>${escapeHtml(safe(pick(customer.phone_number, customer.phone, customer.telefone)))}</td>
      <td>${escapeHtml(safe(postalCode))}</td>
      <td>${escapeHtml(safe(pick(customer.street_type, customer.tipo_logradouro)))}</td>
      <td>${escapeHtml(safe(pick(customer.street_name, customer.logradouro)))}</td>
      <td>${escapeHtml(safe(pick(customer.street_number, customer.numero)))}</td>
      <td>${escapeHtml(safe(pick(customer.address_complement, customer.complemento)))}</td>
      <td>${escapeHtml(safe(pick(customer.neighborhood, customer.bairro)))}</td>
      <td>${escapeHtml(safe(pick(customer.city, customer.cidade)))}</td>
      <td>${escapeHtml(safe(pick(customer.state, customer.uf)))}</td>
      <td>${escapeHtml(safe(sellerName))}</td>
      <td>${escapeHtml(safe(segmentName))}</td>
      <td class="col-status"></td>
      <td>${escapeHtml(fmtBool(pick(customer.is_active, customer.ativo, customer.active)))}</td>
      <td>
        ${actionIconsHtml([
          { action: 'edit', title: 'Editar cliente', attrs: { 'data-edit': id ?? '' } },
        ])}
      </td>`;

    renderStatus(row.querySelector('.col-status'), statusLabel, statusColor);
    row.querySelector('[data-edit]')?.addEventListener('click', () => {
      if (id == null || id === '') return;
      location.href = (window.erpCompanyUrl ? window.erpCompanyUrl(`/public/customersEdit/customersEdit.html?id=${encodeURIComponent(id)}`) : `/public/customersEdit/customersEdit.html?id=${encodeURIComponent(id)}`);
    });
    tbody.appendChild(row);
  }
}

function renderStatus(cell, label, color) {
  if (!cell) return;
  if (!label) {
    cell.textContent = '—';
    return;
  }

  // Selo suave: fundo claro e texto na cor do status (cadastro de Status).
  const hex = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color) : null;
  const badge = document.createElement('span');
  badge.textContent = label;
  Object.assign(badge.style, {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '999px',
    fontSize: '0.75rem',
    fontWeight: '500',
    lineHeight: '1.4',
    border: `1px solid ${hex ? `${hex}40` : '#e2e8f0'}`,
    backgroundColor: hex ? `${hex}14` : '#f8fafc',
    color: hex || '#475569',
  });
  cell.appendChild(badge);
}

export function renderListMeta() {
  const counter = $('#apTableInfo');
  if (counter) {
    counter.textContent =
      `${state.total} ${state.total === 1 ? 'cliente encontrado' : 'clientes encontrados'}`;
  }

  const pageInfo = $('#pageInfo');
  if (pageInfo) {
    pageInfo.textContent = `Página ${state.page} de ${state.totalPages}`;
  }

  const buttons = {
    firstPage: state.page <= 1,
    prevPage: state.page <= 1,
    nextPage: state.page >= state.totalPages,
    lastPage: state.page >= state.totalPages,
  };
  for (const [id, disabled] of Object.entries(buttons)) {
    const button = $(`#${id}`);
    if (button) button.disabled = disabled;
  }
}
