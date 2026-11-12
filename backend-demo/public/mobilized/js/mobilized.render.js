'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { STATUS_LABELS } from './mobilized.config.js';
import { dom, state } from './mobilized.state.js';
import {
  computeItemsTotal, countMissingPrice, escapeHtml, formatBRL, formatDateBR, formatNumber,
  imageCandidates, setImageWithFallback, toNumber,
} from './mobilized.utils.js';

let handlers = {
  select: () => { }, pdf: () => { }, remove: () => { },
  editItem: () => { }, copyItem: () => { }, deleteItem: () => { },
};
export const configureRender = (next) => { handlers = { ...handlers, ...next }; };

export function statusPill(status) {
  const code = String(status || '').toUpperCase();
  const info = STATUS_LABELS[code] || { label: code || '—', pill: '' };
  return `<span class="summary-pill ${info.pill}">${escapeHtml(info.label)}</span>`;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function renderFooter() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  const page = Math.min(totalPages, Math.floor(state.offset / state.limit) + 1);
  if (dom.tableInfo) dom.tableInfo.textContent = `${plural(state.total, 'registro encontrado', 'registros encontrados')}`;
  if (dom.pageInfo) dom.pageInfo.textContent = `Página ${page} de ${totalPages}`;
  if (dom.btnPrev) dom.btnPrev.disabled = page <= 1;
  if (dom.btnNext) dom.btnNext.disabled = page >= totalPages;

  const summary = state.summary || {};
  const missing = Number(summary.items_missing_price || 0);
  if (dom.sumItems) dom.sumItems.textContent = `Itens ${Number(summary.items_count || 0)}`;
  if (dom.sumTotal) dom.sumTotal.textContent = `Total (filtro) ${formatBRL(summary.items_total)}`;
  if (dom.sumMissing) {
    dom.sumMissing.hidden = missing === 0;
    dom.sumMissing.style.display = missing === 0 ? 'none' : '';
    dom.sumMissing.textContent = `⚠ ${plural(missing, 'item sem valor', 'itens sem valor')}`;
  }
}

export function renderList() {
  if (!dom.list) return;
  dom.list.replaceChildren();
  renderFooter();

  if (!state.rows.length) {
    dom.list.innerHTML = '<tr><td colspan="6" class="td-center">Nenhum mobilizado encontrado.</td></tr>';
    return;
  }

  state.rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.mobilized_id;
    tr.title = 'Clique para abrir os detalhes';
    const missing = Number(row.items_missing_price || 0);
    const total = formatBRL(row.items_total);

    tr.innerHTML = `
      <td>${escapeHtml(formatDateBR(row.acquired_at))}</td>
      <td class="td-left">${escapeHtml(row.title || '(sem título)')}</td>
      <td>${statusPill(row.status)}</td>
      <td>${escapeHtml(row.items_count ?? 0)}</td>
      <td class="td-right">${escapeHtml(total)}${missing
        ? `<br><small title="Itens sem valor unitário: o total deles fica R$ 0,00">⚠ ${escapeHtml(plural(missing, 'item sem valor', 'itens sem valor'))}</small>`
        : ''}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Abrir / editar', attrs: { 'data-action': 'edit' } },
        { action: 'document', title: 'Visualizar PDF', attrs: { 'data-action': 'pdf' } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-action': 'delete' } },
      ])}</td>`;

    tr.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      const action = button?.dataset.action || 'edit';
      if (button) event.stopPropagation();
      if (action === 'pdf') handlers.pdf(row.mobilized_id);
      else if (action === 'delete') handlers.remove(row);
      else handlers.select(row.mobilized_id);
    });

    dom.list.append(tr);
  });
}

function loadItemImage(image, item) {
  const attachment = state.attachments.find((entry) =>
    Number(entry.mobilized_item_id) === Number(item.mobilized_item_id) &&
    entry.is_primary &&
    entry.status === 'ACTIVE'
  );
  setImageWithFallback(image, attachment?.public_url ? [attachment.public_url] : imageCandidates(item.sku));
}

export function renderItems() {
  if (!dom.itemsBody) return;
  if (!state.selectedId || !state.items.length) {
    const message = state.selectedId
      ? 'Nenhum item. Clique em “+ Adicionar item”.'
      : 'Salve o mobilizado para adicionar itens.';
    dom.itemsBody.innerHTML = `<tr><td colspan="11" class="td-center">${message}</td></tr>`;
    return;
  }
  dom.itemsBody.replaceChildren();
  state.items.forEach((item) => {
    const quantity = toNumber(item.quantity);
    const price = toNumber(item.unit_price);
    const total = item.total_value == null || item.total_value === '' ? quantity * price : toNumber(item.total_value);
    const noPrice = price === 0;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img alt="Imagem do item" width="32" height="32"></td>
      <td>${escapeHtml(item.sku || '—')}</td>
      <td class="td-left">${escapeHtml(item.description || '')}</td>
      <td>${escapeHtml(item.model || '—')}</td>
      <td>${escapeHtml(item.serial_number || '—')}</td>
      <td>${escapeHtml(item.nfe_ref || '—')}</td>
      <td>${escapeHtml(formatNumber(quantity, 4))}</td>
      <td>${escapeHtml(item.unit || '—')}</td>
      <td class="td-right">${noPrice ? '—' : escapeHtml(formatBRL(price))}</td>
      <td class="td-right">${noPrice
        ? '<span class="summary-pill summary-pill--warning" title="Informe o valor unitário">sem valor</span>'
        : escapeHtml(formatBRL(total))}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar item', attrs: { 'data-action': 'edit' } },
        { action: 'copy', title: 'Duplicar item (mesmos dados, outro S/N)', attrs: { 'data-action': 'copy' } },
        { action: 'delete', title: 'Excluir item', attrs: { 'data-action': 'delete' } },
      ])}</td>`;
    row.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'copy') handlers.copyItem(item);
      else if (action === 'delete') handlers.deleteItem(item);
      else handlers.editItem(item);
    });
    loadItemImage(row.querySelector('img'), item);
    dom.itemsBody.append(row);
  });
}

export function renderTotals() {
  const total = computeItemsTotal(state.items);
  const missing = countMissingPrice(state.items);
  state.selectedItemsTotal = total;
  if (dom.kpiItemsCount) dom.kpiItemsCount.textContent = plural(state.items.length, 'item', 'itens');
  if (dom.kpiItemsTotal) dom.kpiItemsTotal.textContent = `Total ${formatBRL(total)}`;
  if (dom.kpiItemsMissing) {
    dom.kpiItemsMissing.hidden = missing === 0;
    dom.kpiItemsMissing.style.display = missing === 0 ? 'none' : '';
    dom.kpiItemsMissing.textContent = `⚠ ${missing} sem valor unitário`;
  }
  if (dom.itemsFootTotal) dom.itemsFootTotal.innerHTML = `<b>${escapeHtml(formatBRL(total))}</b>`;
}
