'use strict';

import { API_BASE, MOBILIZED_API } from './mobilized.config.js';
import { mobilizedApi } from './mobilized.api.js';
import { collectItem, collectMobilized, fillEditor, prepareNew, recalcItemTotal, resetEditor } from './mobilized.form.js';
import { closeDetailsModal, closeItemModal, openDetailsModal, openItemModal } from './mobilized.modal.js';
import { configureRender, renderItems, renderList, renderTotals } from './mobilized.render.js';
import { dom, fields, itemFields, itemImageFile, state } from './mobilized.state.js';
import { confirmCenter, imageCandidates, notify, setImageWithFallback } from './mobilized.utils.js';
import { validateItem, validateMobilized } from './mobilized.validation.js';

/* ──────────────────────────────────────────────────────────────
   Filtros → querystring (lista e PDF da lista)
────────────────────────────────────────────────────────────── */
function filterQuery() {
  const query = new URLSearchParams();
  const text = dom.q?.value.trim();
  if (text) query.set('q', text);
  if (dom.statusFilter?.value) query.set('status', dom.statusFilter.value);
  const { startDate = '', endDate = '' } = dom.periodFilter?.value || {};
  if (startDate) query.set('from', `${startDate}T00:00:00`);
  if (endDate) query.set('to', `${endDate}T23:59:59`);
  return query;
}

export async function loadList(reset = false) {
  try {
    if (reset) state.offset = 0;
    const query = filterQuery();
    query.set('limit', state.limit);
    query.set('offset', state.offset);
    query.set('orderBy', `${state.sortColumn} ${state.sortDirection}`);
    const output = await mobilizedApi.list(query);
    state.rows = output.data || [];
    state.total = output.meta?.total ?? state.rows.length;
    state.summary = output.meta?.summary || state.summary;
    renderList();
  } catch (error) { notify(error.message || 'Erro ao listar mobilizados.', 'error'); }
}

export async function loadItems(id) {
  try {
    state.items = (await mobilizedApi.listItems(id)).data || [];
  } catch (error) {
    state.items = [];
    notify(error.message || 'Erro ao carregar itens.', 'error');
  }
  try {
    state.attachments = (await mobilizedApi.listAttachments(id)).data || [];
  } catch (error) {
    state.attachments = [];
    console.warn('[mobilized] Não foi possível carregar os anexos:', error);
  }
  renderItems(); renderTotals();
}

export async function selectMobilized(id) {
  try {
    const row = (await mobilizedApi.get(id)).data;
    if (!row) return notify('Registro não encontrado.', 'error');
    fillEditor(row); await loadItems(id); openDetailsModal();
  } catch (error) { notify(error.message || 'Erro ao carregar mobilizado.', 'error'); }
}

export function newMobilized() {
  prepareNew(); renderItems(); renderTotals(); openDetailsModal({ focusTitle: true });
}

export async function saveMobilized() {
  const payload = collectMobilized(); const validation = validateMobilized(payload);
  if (validation) return notify(validation, 'warning');
  try {
    const id = Number(fields.mobilized_id.value) || null;
    const output = id ? await mobilizedApi.update(id, payload) : await mobilizedApi.create(payload);
    fillEditor(output.data); renderItems(); renderTotals();
    await loadList(!id);
    notify(id ? 'Mobilizado atualizado.' : 'Mobilizado criado. Agora adicione os itens.');
  } catch (error) { notify(error.message || 'Erro ao salvar mobilizado.', 'error'); }
}

async function removeMobilized(row) {
  const id = Number(row?.mobilized_id) || null;
  if (!id) return;
  const ok = await confirmCenter(
    `Excluir o mobilizado "${row.title || `#${id}`}" e todos os seus itens?`,
    { title: 'Excluir mobilizado' },
  );
  if (!ok) return;
  try {
    await mobilizedApi.remove(id);
    if (String(state.selectedId) === String(id)) { closeDetailsModal(); resetEditor(); }
    await loadList(false);
    notify('Mobilizado excluído.');
  } catch (error) { notify(error.message || 'Erro ao excluir mobilizado.', 'error'); }
}

export async function saveItem() {
  if (!state.selectedId) return notify('Salve o mobilizado primeiro.', 'warning');
  const payload = collectItem(); const validation = validateItem(payload);
  if (validation) return notify(validation, 'warning');
  const id = Number(itemFields.mobilized_item_id.value) || null;
  try {
    if (id) await mobilizedApi.updateItem(id, payload); else await mobilizedApi.createItem(state.selectedId, payload);
    closeItemModal(); await loadItems(state.selectedId); await loadList(false);
    notify(id ? 'Item atualizado.' : 'Item adicionado.');
  } catch (error) { notify(error.message || 'Erro ao salvar item.', 'error'); }
}

export async function deleteItem(item) {
  const ok = await confirmCenter(`Excluir o item "${item.description || item.sku || ''}"?`, { title: 'Excluir item' });
  if (!ok) return;
  try {
    await mobilizedApi.removeItem(item.mobilized_item_id);
    await loadItems(state.selectedId); await loadList(false);
    notify('Item excluído.');
  } catch (error) { notify(error.message || 'Erro ao excluir item.', 'error'); }
}

/* ──────────────────────────────────────────────────────────────
   Imagem do item (mobilizedAttachments + GCS)
────────────────────────────────────────────────────────────── */
function primaryAttachment(itemId) {
  return itemId
    ? state.attachments.find((entry) =>
      Number(entry.mobilized_item_id) === itemId && entry.is_primary && entry.status === 'ACTIVE')
    : null;
}

export async function refreshItemImage() {
  const itemId = Number(itemFields.mobilized_item_id.value) || null;
  const attachment = primaryAttachment(itemId);
  setImageWithFallback(
    dom.itemImgPreview,
    attachment?.public_url ? [attachment.public_url] : imageCandidates(itemFields.sku.value),
  );
  if (dom.btnItemSetImageUrl) dom.btnItemSetImageUrl.disabled = !itemId;
  if (dom.btnItemClearImageUrl) dom.btnItemClearImageUrl.disabled = !attachment;
}

async function uploadSelectedImage() {
  const file = itemImageFile.files?.[0];
  const itemId = Number(itemFields.mobilized_item_id.value) || null;
  if (!file) return;
  if (!state.selectedId || !itemId) {
    itemImageFile.value = '';
    return notify('Salve o item antes de enviar a imagem.', 'warning');
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    itemImageFile.value = '';
    return notify('Selecione uma imagem JPG, PNG ou WEBP.', 'warning');
  }
  try {
    const data = new FormData();
    data.append('attachment', file);
    data.append('attachment_type', 'IMAGE');
    data.append('is_primary', 'true');
    const output = await mobilizedApi.uploadItemAttachment(state.selectedId, itemId, data);
    state.attachments = state.attachments.filter((entry) =>
      !(Number(entry.mobilized_item_id) === itemId && entry.is_primary));
    if (output.data) state.attachments.push(output.data);
    await refreshItemImage();
    renderItems();
    notify('Imagem enviada.');
  } catch (error) { notify(error.message || 'Falha ao enviar imagem.', 'error'); }
  finally { itemImageFile.value = ''; }
}

async function clearItemImage() {
  const itemId = Number(itemFields.mobilized_item_id.value) || null;
  const attachment = primaryAttachment(itemId);
  if (!attachment) return notify('Este item não possui imagem enviada.', 'warning');
  const ok = await confirmCenter('Remover a imagem deste item?', { title: 'Remover imagem', confirmLabel: 'Remover' });
  if (!ok) return;
  try {
    await mobilizedApi.removeAttachment(state.selectedId, attachment.mobilized_attachment_id);
    state.attachments = state.attachments.filter((entry) =>
      Number(entry.mobilized_attachment_id) !== Number(attachment.mobilized_attachment_id));
    await refreshItemImage();
    renderItems();
    notify('Imagem removida.');
  } catch (error) { notify(error.message || 'Falha ao remover imagem.', 'error'); }
}

/* ──────────────────────────────────────────────────────────────
   PDF
────────────────────────────────────────────────────────────── */
function openPath(path) {
  if (!path) return;
  const url = /^https?:\/\//i.test(path) ? path : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
// GET /:id/pdf gera o PDF na hora (não depende de PDF salvo no GCS)
const openGeneratedPdf = (id) => id && openPath(`${MOBILIZED_API}/${id}/pdf`);

function downloadAll() {
  const query = filterQuery();
  query.set('orderBy', `${state.sortColumn} ${state.sortDirection}`);
  openPath(`${MOBILIZED_API}/pdf/all?${query}`);
}

/* ──────────────────────────────────────────────────────────────
   Eventos
────────────────────────────────────────────────────────────── */
export function setSort({ column, direction }) {
  state.sortColumn = column;
  state.sortDirection = direction;
  return loadList(true);
}

export function bindActions() {
  configureRender({
    select: selectMobilized,
    pdf: openGeneratedPdf,
    remove: removeMobilized,
    editItem: (item) => openItemModal(item),
    copyItem: (item) => openItemModal(item, { copy: true }),
    deleteItem,
  });

  dom.btnNew?.addEventListener('click', newMobilized);
  dom.btnRefresh?.addEventListener('click', () => loadList(false));
  dom.btnSearch?.addEventListener('click', () => loadList(true));
  dom.btnClearFilters?.addEventListener('click', () => {
    if (dom.q) dom.q.value = '';
    if (dom.statusFilter) dom.statusFilter.value = '';
    if (dom.periodFilter) dom.periodFilter.value = { startDate: '', endDate: '' };
    loadList(true);
  });
  dom.q?.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadList(true); });
  dom.statusFilter?.addEventListener('change', () => loadList(true));
  dom.periodFilter?.addEventListener('change', () => loadList(true));

  // rodapé padrão
  dom.btnPrev?.addEventListener('click', () => {
    if (state.offset <= 0) return;
    state.offset = Math.max(0, state.offset - state.limit); loadList();
  });
  dom.btnNext?.addEventListener('click', () => {
    if (state.offset + state.limit >= state.total) return;
    state.offset += state.limit; loadList();
  });
  dom.perPage?.addEventListener('change', () => {
    state.limit = Number(dom.perPage.value) || state.limit; loadList(true);
  });
  if (dom.perPage) state.limit = Number(dom.perPage.value) || state.limit;

  // modal detalhes
  dom.btnSave?.addEventListener('click', (event) => { event.preventDefault(); saveMobilized(); });
  dom.form?.addEventListener('submit', (event) => { event.preventDefault(); saveMobilized(); });
  dom.btnDelete?.addEventListener('click', (event) => { event.preventDefault(); removeMobilized(state.selectedRow); });
  dom.btnAddItem?.addEventListener('click', () => (state.selectedId
    ? openItemModal()
    : notify('Salve o mobilizado primeiro.', 'warning')));

  dom.btnPdfDownload?.addEventListener('click', () => openGeneratedPdf(state.selectedId));
  dom.btnOpenPdf?.addEventListener('click', () => openPath(String(state.selectedRow?.pdf_path || '').trim()));
  dom.btnPdfAll?.addEventListener('click', downloadAll);
  dom.btnPdfGenerateUpload?.addEventListener('click', async () => {
    if (!state.selectedId) return notify('Salve o mobilizado primeiro.', 'warning');
    try {
      fillEditor((await mobilizedApi.generatePdf(state.selectedId)).data);
      await loadList(false);
      notify('PDF gerado e salvo.');
    } catch (error) { notify(error.message || 'Falha ao gerar PDF.', 'error'); }
  });
  dom.btnPdfPickUpload?.addEventListener('click', () => (state.selectedId
    ? dom.pdfFile?.click()
    : notify('Salve o mobilizado primeiro.', 'warning')));
  dom.pdfFile?.addEventListener('change', async () => {
    const file = dom.pdfFile.files?.[0]; if (!file || !state.selectedId) return;
    try {
      const data = new FormData(); data.append('pdf', file);
      fillEditor((await mobilizedApi.uploadPdf(state.selectedId, data)).data);
      notify('PDF enviado.');
    } catch (error) { notify(error.message || 'Falha ao enviar PDF.', 'error'); }
    finally { dom.pdfFile.value = ''; }
  });

  // modal item
  dom.btnItemSave?.addEventListener('click', saveItem);
  itemFields.quantity?.addEventListener('input', recalcItemTotal);
  itemFields.unit_price?.addEventListener('input', recalcItemTotal);
  itemFields.sku?.addEventListener('change', refreshItemImage);
  dom.btnItemSetImageUrl?.addEventListener('click', () => {
    if (!Number(itemFields.mobilized_item_id.value)) return notify('Salve o item antes de enviar a imagem.', 'warning');
    itemImageFile.value = '';
    itemImageFile.click();
  });
  itemImageFile.addEventListener('change', uploadSelectedImage);
  dom.btnItemClearImageUrl?.addEventListener('click', clearItemImage);
}
