// ╔══════════════════════════════════════════════════════════════════════╗
// ║ accountsReceivable.attachments.js — Anexos nos modais               ║
// ║ CONSART ERP                                                         ║
// ║ • form    → Nova/Editar Conta: anexos do título (bucket do projeto) ║
// ║ • receive → Receber: arquivos da movimentação criada no Caixa       ║
// ║ Os arquivos escolhidos só sobem depois de salvar/confirmar.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from './accountsReceivable.alert.js';
import {
  attachmentDownloadUrl,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
  uploadCashMovementFile,
} from './accountsReceivable.api.js';
import { $ } from './accountsReceivable.utils.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const BOXES = {
  form: { box: '#arFilesBox', button: '#arFilesBtn', input: '#arFilesInput', list: '#arFilesList' },
  receive: { box: '#receiveFilesBox', button: '#receiveFilesBtn', input: '#receiveFilesInput', list: '#receiveFilesList' },
};

const state = {
  form: { accountId: null, saved: [], pending: [], legacyUrl: '' },
  receive: { accountId: null, saved: [], pending: [], legacyUrl: '' },
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));

function sizeLabel(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// -------------------------------------------------------------------
// RENDER
// -------------------------------------------------------------------

function render(kind) {
  const list = $(BOXES[kind].list);
  if (!list) return;

  const { accountId, saved, pending, legacyUrl } = state[kind];
  const items = [];

  if (legacyUrl) {
    items.push(`
      <li class="ar-files__item">
        <a href="${escapeHtml(legacyUrl)}" target="_blank" rel="noopener" class="ar-files__name"
          title="${escapeHtml(legacyUrl)}">🔗 Link do anexo (antigo)</a>
      </li>`);
  }

  for (const file of saved) {
    items.push(`
      <li class="ar-files__item">
        <a href="${escapeHtml(attachmentDownloadUrl(accountId, file.id))}" target="_blank" rel="noopener"
          class="ar-files__name" title="Abrir ${escapeHtml(file.file_name)}">📄 ${escapeHtml(file.file_name)}</a>
        <small class="ar-files__meta">${sizeLabel(file.file_size)}</small>
        <button type="button" class="action-icon action-icon--delete" data-file-delete="${escapeHtml(file.id)}"
          title="Excluir anexo" aria-label="Excluir ${escapeHtml(file.file_name)}">${TRASH_ICON}</button>
      </li>`);
  }

  pending.forEach((file, index) => {
    items.push(`
      <li class="ar-files__item is-pending">
        <span class="ar-files__name" title="${escapeHtml(file.name)}">📎 ${escapeHtml(file.name)}</span>
        <small class="ar-files__meta">${sizeLabel(file.size)} · a enviar</small>
        <button type="button" class="action-icon action-icon--cancel" data-file-remove="${index}"
          title="Tirar da lista" aria-label="Tirar ${escapeHtml(file.name)} da lista">${CLOSE_ICON}</button>
      </li>`);
  });

  list.innerHTML = items.length
    ? items.join('')
    : '<li class="ar-files__empty">Nenhum arquivo anexado.</li>';
}

// -------------------------------------------------------------------
// SELEÇÃO DE ARQUIVOS
// -------------------------------------------------------------------

function addFiles(kind, fileList) {
  const files = [...(fileList || [])];
  const tooBig = files.filter((file) => file.size > MAX_FILE_SIZE);
  const valid = files.filter((file) => file.size > 0 && file.size <= MAX_FILE_SIZE);

  if (tooBig.length) {
    showCenterModal({
      type: 'warning',
      title: 'Arquivo muito grande',
      message: `O limite é 50 MB por arquivo:\n${tooBig.map((file) => file.name).join('\n')}`,
    });
  }

  state[kind].pending = [...state[kind].pending, ...valid];
  render(kind);
}

async function removeSaved(kind, attachmentId) {
  const { accountId, saved } = state[kind];
  const file = saved.find((item) => String(item.id) === String(attachmentId));
  if (!accountId || !file) return;

  const confirmed = await showCenterModal({
    type: 'warning',
    title: 'Excluir anexo',
    message: `Excluir o arquivo "${file.file_name}" desta conta?`,
    okText: 'Excluir',
    closeText: 'Cancelar',
    timeoutMs: null,
  });
  if (confirmed !== true) return;

  try {
    await deleteAttachment(accountId, attachmentId);
    state[kind].saved = saved.filter((item) => item !== file);
    render(kind);
  } catch (error) {
    showCenterModal({ type: 'error', title: 'Erro ao excluir anexo', message: error.message });
  }
}

function bindBox(kind) {
  const { box, button, input, list } = BOXES[kind];
  const fileInput = $(input);

  $(button)?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    addFiles(kind, fileInput.files);
    fileInput.value = '';
  });

  $(list)?.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-file-remove]');
    if (removeButton) {
      state[kind].pending.splice(Number(removeButton.dataset.fileRemove), 1);
      render(kind);
      return;
    }

    const deleteButton = event.target.closest('[data-file-delete]');
    if (deleteButton) removeSaved(kind, deleteButton.dataset.fileDelete);
  });

  const dropArea = $(box);
  dropArea?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropArea.classList.add('is-dragover');
  });
  dropArea?.addEventListener('dragleave', () => dropArea.classList.remove('is-dragover'));
  dropArea?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropArea.classList.remove('is-dragover');
    addFiles(kind, event.dataTransfer?.files);
  });
}

// -------------------------------------------------------------------
// API PÚBLICA
// -------------------------------------------------------------------

export function bindAttachments() {
  bindBox('form');
  bindBox('receive');
  render('form');
  render('receive');
}

/**
 * Prepara a caixa de anexos ao abrir um modal.
 * form: carrega os anexos já salvos da conta (accountId) e o link antigo.
 * receive: começa vazia (os arquivos vão para a movimentação do Caixa).
 */
export async function resetAttachments(kind, { accountId = null, legacyUrl = '' } = {}) {
  state[kind] = { accountId, saved: [], pending: [], legacyUrl: legacyUrl || '' };
  render(kind);

  if (kind !== 'form' || !accountId) return;

  try {
    const result = await listAttachments(accountId);
    if (state[kind].accountId !== accountId) return;
    state[kind].saved = Array.isArray(result?.data) ? result.data : [];
    render(kind);
  } catch (error) {
    console.error('[accountsReceivable.attachments] list:', error);
  }
}

/**
 * Envia os arquivos escolhidos.
 * form → anexos da conta; receive → movimentação do Caixa (targetId).
 * @returns {Promise<{ sent: number, failed: string[] }>}
 */
export async function uploadPendingAttachments(kind, targetId) {
  const files = state[kind].pending;
  const failed = [];
  if (!files.length || !targetId) return { sent: 0, failed: files.map((file) => file.name) };

  for (const file of files) {
    try {
      if (kind === 'receive') await uploadCashMovementFile(targetId, file);
      else await uploadAttachment(targetId, file);
    } catch (error) {
      console.error('[accountsReceivable.attachments] upload', file.name, error);
      failed.push(file.name);
    }
  }

  state[kind].pending = [];
  render(kind);

  return { sent: files.length - failed.length, failed };
}

export function hasPendingAttachments(kind) {
  return state[kind].pending.length > 0;
}

/** Texto para juntar à mensagem de sucesso do salvar/receber. */
export function uploadSummary({ sent, failed }) {
  if (!sent && !failed.length) return '';
  const parts = [];
  if (sent) parts.push(`${sent} arquivo${sent === 1 ? '' : 's'} anexado${sent === 1 ? '' : 's'}.`);
  if (failed.length) parts.push(`Não foi possível enviar: ${failed.join(', ')}.`);
  return `\n${parts.join(' ')}`;
}
