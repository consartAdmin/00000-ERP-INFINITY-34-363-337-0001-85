// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.attachments.js — Anexos da entrada (CONSART ERP)     ║
// ║ Os arquivos são gravados na movimentação do Caixa ligada à entrada  ║
// ║ (mesmas rotas da tela Caixa):                                        ║
// ║  - GET/POST /api/expense-entries/:id/cash-movement                   ║
// ║  - POST /api/upload/anexo (campo "arquivo" + movimentacao_id)        ║
// ║  - GET  /api/caixa/movimentacoes/:id/anexos                          ║
// ║  - DELETE /api/caixa/movimentacoes/:id/anexos/:anexoId               ║
// ║  - GET  /api/upload/anexo/sign-read?object=...                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { http } from './expenseEntries.api.js';
import { API, apiBase } from './expenseEntries.config.js';
import { state } from './expenseEntries.state.js';
import { $, escapeHtml, toast } from './expenseEntries.utils.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

function formatSize(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function fileIcon(name = '', mime = '') {
  const ext = String(name).split('.').pop().toLowerCase();
  if (ext === 'xml' || mime.includes('xml')) return '🧾';
  if (ext === 'pdf' || mime.includes('pdf')) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  return '📎';
}

function attachmentRow({ icon, name, meta, actions }) {
  return `
    <div role="listitem" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <span title="${escapeHtml(name)}">${icon} ${escapeHtml(name)} <span class="ee-muted">${escapeHtml(meta)}</span></span>
      <span class="btn-inline btn-gap-3">${actions}</span>
    </div>`;
}

export function renderAttachments() {
  const list = $('#attachmentsList');
  if (!list) return;

  const saved = state.savedAttachments.map((a) => attachmentRow({
    icon: fileIcon(a.file_name, a.mime_type || ''),
    name: a.file_name || 'arquivo',
    meta: `${formatSize(a.file_size_bytes)} • no Caixa`,
    actions: `
      <button type="button" class="btn btn-toolbar btn-sm" data-att-open="${escapeHtml(a.storage_path || '')}">Abrir</button>
      <button type="button" class="btn btn-toolbar btn-sm" data-att-delete="${escapeHtml(a.id)}" title="Excluir anexo">✕</button>`,
  }));

  const pending = state.pendingFiles.map((file, index) => attachmentRow({
    icon: fileIcon(file.name, file.type || ''),
    name: file.name,
    meta: `${formatSize(file.size)} • enviado ao salvar`,
    actions: `<button type="button" class="btn btn-toolbar btn-sm" data-att-remove="${index}" title="Remover">✕</button>`,
  }));

  list.innerHTML = [...saved, ...pending].join('');
}

export function resetAttachments() {
  state.pendingFiles = [];
  state.savedAttachments = [];
  state.cashMovementId = null;
  renderAttachments();
}

export function addPendingFiles(files) {
  for (const file of files || []) {
    const duplicate = state.pendingFiles.some((f) => f.name === file.name && f.size === file.size);
    if (!duplicate) state.pendingFiles.push(file);
  }
  renderAttachments();
}

async function fetchSavedAttachments(movementId) {
  const response = await fetch(`${apiBase}/api/caixa/movimentacoes/${movementId}/anexos`);
  const json = await response.json().catch(() => []);
  return Array.isArray(json) ? json : (json?.data || []);
}

// Edição: mostra os anexos que já estão na movimentação do Caixa.
export async function loadSavedAttachments(expenseEntryId) {
  try {
    const json = await http(`${API}/${expenseEntryId}/cash-movement`);
    state.cashMovementId = json?.data?.id || null;
    state.cashMovement = json?.data?.movement || null;
    state.savedAttachments = state.cashMovementId ? await fetchSavedAttachments(state.cashMovementId) : [];
  } catch (error) {
    state.savedAttachments = [];
    console.warn('[expenseEntries] anexos:', error);
  }
  renderAttachments();
}

// Depois de salvar: envia os arquivos pendentes para a movimentação do Caixa.
export async function uploadPendingAttachments(expenseEntryId, cashMovementId = null) {
  if (!state.pendingFiles.length) return { sent: 0, failed: 0 };

  let movementId = cashMovementId || state.cashMovementId;
  if (!movementId) {
    const json = await http(`${API}/${expenseEntryId}/cash-movement`, { method: 'POST', body: {} });
    movementId = json?.data?.id || null;
  }
  if (!movementId) throw new Error('Movimentação do Caixa não encontrada para gravar os anexos.');

  let sent = 0;
  let failed = 0;
  for (const file of state.pendingFiles) {
    const formData = new FormData();
    formData.append('movimentacao_id', String(movementId));
    formData.append('arquivo', file, file.name);
    try {
      const response = await fetch(`${apiBase}/api/upload/anexo`, { method: 'POST', body: formData });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${response.status}`);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error('[expenseEntries] upload anexo:', file.name, error);
    }
  }

  state.pendingFiles = [];
  return { sent, failed };
}

async function openSaved(object) {
  try {
    const response = await fetch(`${apiBase}/api/upload/anexo/sign-read?object=${encodeURIComponent(object)}`);
    const json = await response.json().catch(() => null);
    if (!json?.url) throw new Error(json?.error || 'Link indisponível');
    window.open(json.url, '_blank', 'noopener');
  } catch (error) {
    toast(`Erro ao abrir anexo: ${error.message}`, 'error');
  }
}

async function deleteSaved(anexoId) {
  if (!state.cashMovementId) return;
  const confirmed = await showCenterModal({
    variant: 'warning',
    title: 'Excluir anexo',
    message: 'Excluir este anexo da movimentação do Caixa?<br><br>Esta operação não poderá ser desfeita.',
    okText: 'Sim, excluir',
    closeText: 'Voltar',
    timeoutMs: null,
  });
  if (confirmed !== true) return;
  try {
    const response = await fetch(`${apiBase}/api/caixa/movimentacoes/${state.cashMovementId}/anexos/${anexoId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.savedAttachments = state.savedAttachments.filter((a) => String(a.id) !== String(anexoId));
    renderAttachments();
  } catch (error) {
    toast(`Erro ao excluir anexo: ${error.message}`, 'error');
  }
}

export function setupAttachments() {
  const dropzone = $('#attachmentsDropzone');
  const input = $('#attachmentsInput');
  const list = $('#attachmentsList');
  if (!dropzone || !input || !list) return;

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    addPendingFiles(event.dataTransfer?.files);
  });
  input.addEventListener('change', () => {
    addPendingFiles(input.files);
    input.value = '';
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.attRemove !== undefined) {
      state.pendingFiles.splice(Number(button.dataset.attRemove), 1);
      renderAttachments();
    } else if (button.dataset.attOpen !== undefined) {
      openSaved(button.dataset.attOpen);
    } else if (button.dataset.attDelete !== undefined) {
      deleteSaved(button.dataset.attDelete);
    }
  });
}
