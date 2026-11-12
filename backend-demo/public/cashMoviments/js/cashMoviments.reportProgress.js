// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashMoviments.reportProgress.js — progresso do PDF e do ZIP          ║
// ║ Mesmo modal da sincronização do Asaas (Contas a Receber): título,     ║
// ║ texto de status, barra, lista das linhas e botão "Ocultar".           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { fmtBRL } from './cashMoviments.utils.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));

/** Até onde o stream chegou, para a mensagem de erro e o console. */
function describeProgress(progress) {
  if (progress.total != null) return `parou em ${progress.index} de ${progress.total}${progress.pdfParts ? `, ${progress.pdfParts} parte(s) do arquivo` : ''}`;
  return progress.last ? `última etapa: ${progress.last}` : 'nenhuma resposta do servidor';
}

/**
 * Lê o NDJSON de GET ...?stream=1 (PDF ou ZIP) e devolve o evento 'done'.
 * O PDF chega em linhas { type: 'pdf', part } e volta em result.pdf.
 * Se a conexão cair antes do 'done', o erro tem incomplete = true.
 */
export async function fetchProgressStream(url, onEvent) {
  const response = await fetch(url, {
    headers: { Accept: 'application/x-ndjson' },
    credentials: 'include',
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pdfParts = [];
  const progress = { last: null, index: 0, total: null, pdfParts: 0 };
  let buffer = '';
  let result = null;

  const handleLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'ping') return;
    if (event.type === 'error') throw new Error(event.message || 'Falha ao gerar o arquivo.');
    if (event.type === 'pdf') {
      pdfParts.push(event.part || '');
      progress.pdfParts = pdfParts.length;
      return;
    }
    progress.last = event.type === 'phase' ? event.message : event.type;
    if (event.type === 'start') progress.total = event.total;
    if (event.type === 'item') { progress.index = event.index; progress.total = event.total; }
    if (event.type === 'done') result = event;
    onEvent?.(event);
  };

  const incomplete = (cause) => {
    const error = new Error(`A geração foi interrompida antes de terminar (${describeProgress(progress)}).`);
    error.incomplete = true;
    error.progress = progress;
    if (cause) error.cause = cause;
    console.warn('[CAIXA][STREAM] interrompido', { url, progress, cause });
    return error;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handleLine);
    }
  } catch (error) {
    // queda de rede no meio do stream (erros do servidor já vêm como Error comum)
    if (error instanceof TypeError) throw incomplete(error);
    throw error;
  }

  const rest = buffer + decoder.decode();
  try {
    handleLine(rest);
  } catch (error) {
    if (error instanceof SyntaxError) throw incomplete(error); // última linha cortada
    throw error;
  }

  if (!result) throw incomplete();

  if (result.parts != null) {
    if (pdfParts.length !== result.parts) throw incomplete();
    result.pdf = pdfParts.join('');
  }
  return result;
}

/**
 * Modal de progresso: fica aberto e é atualizado a cada linha.
 * renderItem(item) → { className, label, value, ok }
 */
function openProgressModal({ title, hint, startText, emptyText, finishingText, renderItem }) {
  showCenterModal({
    variant: 'info',
    title,
    className: 'cm-report-modal',
    timeoutMs: null,
    closeOnEscape: false,
    buttons: [{ label: 'Ocultar', variant: 'cancel' }],
    message: `
      <div class="cm-report-progress">
        <div class="cm-report-progress__head">
          <span id="cmReportProgressText">Preparando…</span>
          <b id="cmReportProgressCount"></b>
        </div>
        <div class="cm-report-progress__bar"><span id="cmReportProgressBar"></span></div>
        <ul id="cmReportProgressLog" class="cm-report-progress__log"></ul>
        <small class="cm-report-progress__hint">${escapeHtml(hint)}</small>
      </div>
    `,
  });

  const el = (id) => document.getElementById(id);
  const setText = (id, text) => { const node = el(id); if (node) node.textContent = text; };

  return {
    phase(message) {
      setText('cmReportProgressText', message);
    },
    start(total) {
      setText('cmReportProgressCount', `0 de ${total}`);
      setText('cmReportProgressText', total ? startText : emptyText);
    },
    item({ index, total, item }) {
      const percent = total ? Math.round((index / total) * 100) : 100;
      const bar = el('cmReportProgressBar');
      if (bar) bar.style.width = `${percent}%`;
      setText('cmReportProgressCount', `${index} de ${total}`);
      if (index === total && finishingText) setText('cmReportProgressText', finishingText);

      const log = el('cmReportProgressLog');
      if (!log || !item) return;

      const row = renderItem(item);
      const li = document.createElement('li');
      li.className = row.className || '';
      li.innerHTML = `
        <span class="cm-report-progress__icon">${row.ok === false ? '✕' : '✓'}</span>
        <span class="cm-report-progress__name">${escapeHtml(row.label)}</span>
        <span class="cm-report-progress__value">${escapeHtml(row.value)}</span>
      `;
      log.prepend(li);
    },
  };
}

export function openPdfProgressModal() {
  return openProgressModal({
    title: 'Gerando Relatório PDF',
    hint: 'Pode ocultar esta janela: o relatório continua sendo gerado e o download começa ao final.',
    startText: 'Montando as linhas do relatório…',
    emptyText: 'Nenhuma movimentação no filtro: gerando o relatório vazio…',
    finishingText: 'Finalizando o PDF (totais e dashboard)…',
    renderItem(item) {
      const tipo = String(item.tipo || '').toUpperCase();
      return {
        className: item.transferencia ? 'is-transfer' : tipo.startsWith('ENT') ? 'is-in' : 'is-out',
        label: `${item.data} · ${item.documento || `#${item.id}`} · ${item.nome || '—'}`,
        value: `${item.transferencia ? 'Transf.' : tipo || '—'} ${fmtBRL(item.valor)}`,
      };
    },
  });
}

const fmtSize = (bytes) => {
  const n = Number(bytes);
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
};

export function openZipProgressModal() {
  return openProgressModal({
    title: 'Baixando anexos do período',
    hint: 'Pode ocultar esta janela: o ZIP continua sendo montado e o download começa ao final.',
    startText: 'Juntando os anexos no ZIP…',
    emptyText: 'Nenhum anexo no filtro.',
    finishingText: 'Finalizando o ZIP…',
    renderItem(item) {
      return {
        ok: item.ok,
        className: item.ok ? (item.nota ? 'is-note' : '') : 'is-failed',
        label: [item.data, item.documento, item.fornecedor, item.nome].filter(Boolean).join(' · ') || '—',
        value: item.ok ? `${item.nota ? 'Nota · ' : ''}${fmtSize(item.tamanho)}` : `ignorado (${item.motivo || 'erro'})`,
      };
    },
  });
}

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Baixa o ZIP montado no servidor e mostra o resumo. */
export function finishZipDownload(result) {
  triggerDownload(result.url, result.filename);

  const ignorados = Number(result.ignorados) || 0;
  showCenterModal({
    variant: ignorados ? 'warning' : 'success',
    title: 'ZIP do período pronto',
    timeoutMs: null,
    message: `<b>${Number(result.incluidos) || 0}</b> anexo(s) no ZIP${ignorados ? ` · <b>${ignorados}</b> ignorado(s)` : ''}.<br><small>${escapeHtml(result.filename || '')} foi baixado.</small>`,
    buttons: [
      { label: 'Fechar', variant: 'cancel' },
      { label: 'Baixar de novo', variant: 'primary', action: () => triggerDownload(result.url, result.filename) },
    ],
  });
}

function base64ToPdfBlob(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Baixa o PDF e mostra o resumo com a opção de abrir em nova aba. */
export function finishPdfReport(result) {
  const blobUrl = URL.createObjectURL(base64ToPdfBlob(result.pdf));
  const filename = result.filename || 'relatorio_caixa.pdf';
  triggerDownload(blobUrl, filename);

  showCenterModal({
    variant: 'success',
    title: 'Relatório PDF pronto',
    timeoutMs: null,
    message: `<b>${Number(result.total) || 0}</b> movimentação(ões) no relatório.<br><small>${escapeHtml(filename)} foi baixado.</small>`,
    buttons: [
      { label: 'Fechar', variant: 'cancel' },
      { label: 'Abrir PDF', variant: 'primary', action: () => { window.open(blobUrl, '_blank', 'noopener'); } },
    ],
  }).finally(() => setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000));
}
