// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expensesAttachments.js — 📎 Contratos e documentos da despesa        ║
// ║ Path: public/expenses/expensesAttachments.js                         ║
// ║ Mesmo esquema do Contas a Receber: arquivos no bucket do projeto     ║
// ║ (pasta expenses/expense-{id}/), metadados em "expensesAttachments".  ║
// ║ Os arquivos escolhidos sobem depois de salvar a despesa.             ║
// ║ API: GET/POST /api/expenses/:id/attachments                          ║
// ║      GET  /api/expenses/:id/attachments/:attId/download              ║
// ║      DELETE /api/expenses/:id/attachments/:attId                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));

function sizeLabel(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function dateLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

async function readJson(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

/**
 * @param {{ api: string }} opts  api = base das despesas (ex.: /api/expenses)
 */
export function createExpensesAttachments({ api }) {
  const el = {
    box: document.getElementById('expFilesBox'),
    button: document.getElementById('expFilesBtn'),
    input: document.getElementById('expFilesInput'),
    list: document.getElementById('expFilesList'),
  };

  const state = { expenseId: null, saved: [], pending: [] };

  const base = (id) => `${api}/${encodeURIComponent(id)}/attachments`;
  const downloadUrl = (id, attId) => `${base(id)}/${encodeURIComponent(attId)}/download`;

  function render() {
    if (!el.list) return;
    const { expenseId, saved, pending } = state;
    const items = [];

    for (const file of saved) {
      items.push(`
        <li class="exp-files__item">
          <a href="${escapeHtml(downloadUrl(expenseId, file.id))}" target="_blank" rel="noopener"
            class="exp-files__name" title="Abrir ${escapeHtml(file.file_name)}">📄 ${escapeHtml(file.file_name)}</a>
          <small class="exp-files__meta">${sizeLabel(file.file_size)}${file.created_at ? ` · ${dateLabel(file.created_at)}` : ''}</small>
          <button type="button" class="action-icon action-icon--delete" data-file-delete="${escapeHtml(file.id)}"
            title="Excluir anexo" aria-label="Excluir ${escapeHtml(file.file_name)}">${TRASH_ICON}</button>
        </li>`);
    }

    pending.forEach((file, index) => {
      items.push(`
        <li class="exp-files__item is-pending">
          <span class="exp-files__name" title="${escapeHtml(file.name)}">📎 ${escapeHtml(file.name)}</span>
          <small class="exp-files__meta">${sizeLabel(file.size)} · a enviar ao salvar</small>
          <button type="button" class="action-icon action-icon--cancel" data-file-remove="${index}"
            title="Tirar da lista" aria-label="Tirar ${escapeHtml(file.name)} da lista">${CLOSE_ICON}</button>
        </li>`);
    });

    el.list.innerHTML = items.length
      ? items.join('')
      : '<li class="exp-files__empty">Nenhum contrato ou documento anexado.</li>';
  }

  function addFiles(fileList) {
    const files = [...(fileList || [])];
    const tooBig = files.filter((f) => f.size > MAX_FILE_SIZE);
    const valid = files.filter((f) => f.size > 0 && f.size <= MAX_FILE_SIZE);
    if (tooBig.length) alert(`O limite é 50 MB por arquivo:\n${tooBig.map((f) => f.name).join('\n')}`);
    state.pending = [...state.pending, ...valid];
    render();
  }

  async function removeSaved(attId) {
    const file = state.saved.find((f) => String(f.id) === String(attId));
    if (!state.expenseId || !file) return;
    if (!confirm(`Excluir o arquivo "${file.file_name}" desta despesa?`)) return;
    try {
      await readJson(await fetch(`${base(state.expenseId)}/${encodeURIComponent(attId)}`, {
        method: 'DELETE', credentials: 'include',
      }));
      state.saved = state.saved.filter((f) => f !== file);
      render();
    } catch (err) {
      alert(`Erro ao excluir anexo: ${err.message}`);
    }
  }

  function bind() {
    el.button?.addEventListener('click', () => el.input?.click());
    el.input?.addEventListener('change', () => {
      addFiles(el.input.files);
      el.input.value = '';
    });
    el.list?.addEventListener('click', (event) => {
      const rm = event.target.closest('[data-file-remove]');
      if (rm) {
        state.pending.splice(Number(rm.dataset.fileRemove), 1);
        render();
        return;
      }
      const del = event.target.closest('[data-file-delete]');
      if (del) removeSaved(del.dataset.fileDelete);
    });
    el.box?.addEventListener('dragover', (event) => {
      event.preventDefault();
      el.box.classList.add('is-dragover');
    });
    el.box?.addEventListener('dragleave', () => el.box.classList.remove('is-dragover'));
    el.box?.addEventListener('drop', (event) => {
      event.preventDefault();
      el.box.classList.remove('is-dragover');
      addFiles(event.dataTransfer?.files);
    });
  }

  /** Ao abrir o modal: Nova (vazio) ou Editar (carrega os anexos salvos) */
  async function reset(expenseId = null) {
    state.expenseId = expenseId || null;
    state.saved = [];
    state.pending = [];
    render();
    if (!expenseId) return;
    try {
      const data = await readJson(await fetch(base(expenseId), { credentials: 'include' }));
      if (state.expenseId !== expenseId) return;
      state.saved = Array.isArray(data?.data) ? data.data : [];
      render();
    } catch (err) {
      console.error('[expensesAttachments] list', err);
    }
  }

  /** Envia os arquivos escolhidos depois de salvar a despesa */
  async function uploadPending(expenseId) {
    const files = state.pending;
    const failed = [];
    if (!files.length) return { sent: 0, failed };
    if (!expenseId) return { sent: 0, failed: files.map((f) => f.name) };

    for (const file of files) {
      try {
        const form = new FormData();
        form.append('arquivo', file, file.name);
        await readJson(await fetch(base(expenseId), { method: 'POST', body: form, credentials: 'include' }));
      } catch (err) {
        console.error('[expensesAttachments] upload', file.name, err);
        failed.push(file.name);
      }
    }
    state.pending = [];
    render();
    return { sent: files.length - failed.length, failed };
  }

  bind();
  render();

  return { reset, uploadPending, hasPending: () => state.pending.length > 0 };
}
