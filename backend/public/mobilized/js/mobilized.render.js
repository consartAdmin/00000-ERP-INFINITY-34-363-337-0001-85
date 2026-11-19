'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { STATUS_LABELS } from './mobilized.config.js';
import { dom, state } from './mobilized.state.js';
import {
  computeItemsTotal, countMissingPrice, escapeHtml, formatBRL, formatDateBR, formatNumber,
  imageCandidates, PLACEHOLDER_IMAGE, setImageWithFallback, toNumber,
} from './mobilized.utils.js';

let handlers = {
  select: () => { }, pdf: () => { }, remove: () => { }, image: () => { },
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

const LIST_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
const CARDS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>';

// Visão Cards (padrão) x Lista: só troca qual bloco aparece; os dados são os mesmos.
export function applyViewMode() {
  const cards = state.viewMode !== 'list';
  if (dom.cardsWrap) { dom.cardsWrap.hidden = !cards; dom.cardsWrap.style.display = cards ? '' : 'none'; }
  if (dom.tableWrap) { dom.tableWrap.hidden = cards; dom.tableWrap.style.display = cards ? 'none' : ''; }
  if (dom.btnViewMode) {
    dom.btnViewMode.innerHTML = cards ? `${LIST_ICON}<span>Ver em lista</span>` : `${CARDS_ICON}<span>Ver em cards</span>`;
  }
}

function renderCards() {
  if (!dom.cards) return;
  dom.cards.replaceChildren();
  if (!state.rows.length) {
    dom.cards.innerHTML = '<p class="kanban-card__description">Nenhum mobilizado encontrado.</p>';
    return;
  }
  state.rows.forEach((row) => {
    const card = document.createElement('article');
    card.className = 'kanban-card';
    card.dataset.id = row.mobilized_id;
    card.title = 'Clique para abrir os detalhes';
    const missing = Number(row.items_missing_price || 0);
    card.innerHTML = `
      <div class="summary summary--center"><img class="img" alt="Imagem do mobilizado" width="100%" height="150" loading="lazy"></div>
      <h4 class="kanban-card__title">${escapeHtml(row.title || '(sem título)')}</h4>
      <div class="kanban-card__meta">
        <span>${escapeHtml(formatDateBR(row.acquired_at))}</span>
        <span>${escapeHtml(plural(Number(row.items_count || 0), 'item', 'itens'))}</span>
      </div>
      <div class="summary summary--between">
        ${statusPill(row.status)}
        <b>${escapeHtml(formatBRL(row.items_total))}</b>
      </div>
      ${missing ? `<small title="Itens sem valor unitário: o total deles fica R$ 0,00">⚠ ${escapeHtml(plural(missing, 'item sem valor', 'itens sem valor'))}</small>` : ''}
      <div class="summary summary--right">${actionIconsHtml([
        { action: 'edit', title: 'Abrir / editar', attrs: { 'data-action': 'edit' } },
        { action: 'document', title: 'Visualizar PDF', attrs: { 'data-action': 'pdf' } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-action': 'delete' } },
      ])}</div>`;
    card.addEventListener('click', (event) => handleRowClick(event, row));
    loadRowThumb(card.querySelector('img'), row);
    dom.cards.append(card);
  });
}

function handleRowClick(event, row) {
  const button = event.target.closest('[data-action]');
  const action = button?.dataset.action || 'edit';
  if (button) event.stopPropagation();
  if (action === 'image') handlers.image(row);
  else if (action === 'pdf') handlers.pdf(row.mobilized_id);
  else if (action === 'delete') handlers.remove(row);
  else handlers.select(row.mobilized_id);
}

export function renderList() {
  applyViewMode();
  renderCards();
  if (!dom.list) return;
  dom.list.replaceChildren();
  renderFooter();

  if (!state.rows.length) {
    dom.list.innerHTML = '<tr><td colspan="7" class="td-center">Nenhum mobilizado encontrado.</td></tr>';
    return;
  }

  state.rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.mobilized_id;
    tr.title = 'Clique para abrir os detalhes';
    const missing = Number(row.items_missing_price || 0);
    const total = formatBRL(row.items_total);

    tr.innerHTML = `
      <td><img class="img img-w-8 img-h-8" alt="Imagem do mobilizado" width="32" height="32" loading="lazy"></td>
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

    tr.addEventListener('click', (event) => handleRowClick(event, row));

    loadRowThumb(tr.querySelector('img'), row);
    dom.list.append(tr);
  });
}

// Miniatura da lista: foto enviada no item (GCS) → imagem do produto pelo SKU → brasão.
// Só vira botão (abre o modal ampliado) quando existe uma imagem de verdade.
function loadRowThumb(image, row) {
  if (!image) return;
  const urls = row.image_url ? [row.image_url] : imageCandidates(row.first_sku);
  setImageWithFallback(image, urls);
  const markReal = () => {
    if (image.src.endsWith(PLACEHOLDER_IMAGE)) {
      // no card, o brasão fica pequeno e centralizado (a foto real ocupa a largura toda)
      if (image.getAttribute('width') === '100%') image.setAttribute('width', '56');
      image.title = 'Sem imagem: abra o mobilizado e envie a foto no item';
      return;
    }
    image.classList.add('img-action');
    image.dataset.action = 'image';
    image.title = 'Clique para ampliar a imagem';
    image.removeEventListener('load', markReal);
  };
  image.addEventListener('load', markReal);
}

export function renderImageGallery(row, images) {
  const list = images || [];
  if (dom.imageModalTitle) dom.imageModalTitle.textContent = row.title || 'Imagem do mobilizado';
  const show = (entry) => {
    setImageWithFallback(dom.imageModalMain, entry.urls);
    if (dom.imageModalCaption) dom.imageModalCaption.textContent = entry.caption || '';
  };
  dom.imageModalThumbs?.replaceChildren();
  const many = list.length > 1;
  if (dom.imageModalThumbs) dom.imageModalThumbs.hidden = !many;
  if (dom.imageModalDivider) dom.imageModalDivider.hidden = !many;
  if (dom.imageModalThumbs) dom.imageModalThumbs.style.display = many ? '' : 'none';
  if (dom.imageModalDivider) dom.imageModalDivider.style.display = many ? '' : 'none';
  if (many) {
    list.forEach((entry) => {
      const thumb = document.createElement('img');
      thumb.className = 'img img-action img-w-16 img-h-16';
      thumb.width = 64; thumb.height = 64;
      thumb.alt = entry.caption || 'Imagem';
      thumb.title = entry.caption || '';
      thumb.dataset.index = String(entry.index);
      setImageWithFallback(thumb, entry.urls);
      thumb.addEventListener('click', () => show(entry));
      dom.imageModalThumbs.append(thumb);
    });
  }
  if (list.length) show(list[0]);
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
