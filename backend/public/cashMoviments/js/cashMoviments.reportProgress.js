// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashMoviments.reportProgress.js — progresso do Relatório PDF          ║
// ║ Mesmo modal da sincronização do Asaas (Contas a Receber): título,     ║
// ║ texto de status, barra, lista das linhas e botão "Ocultar".           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { fmtBRL } from './cashMoviments.utils.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));

/** Lê o NDJSON de GET .../relatorio/pdf?stream=1 e devolve o evento 'done'. */
export async function fetchPdfReportStream(url, onEvent) {
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
  let buffer = '';
  let result = null;

  const handleLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.message || 'Falha ao gerar o relatório PDF.');
    if (event.type === 'done') result = event;
    onEvent?.(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handleLine);
  }

  handleLine(buffer + decoder.decode());

  if (!result) throw new Error('A geração do relatório foi interrompida antes de terminar.');
  return result;
}

/** Modal de progresso: fica aberto e é atualizado a cada linha do PDF. */
export function openPdfProgressModal() {
  showCenterModal({
    variant: 'info',
    title: 'Gerando Relatório PDF',
    className: 'cm-report-modal',
    timeoutMs: null,
    closeOnEscape: false,
    buttons: [{ label: 'Ocultar', variant: 'cancel' }],
    message: `
      <div class="cm-report-progress">
        <div class="cm-report-progress__head">
          <span id="cmReportProgressText">Preparando o relatório…</span>
          <b id="cmReportProgressCount"></b>
        </div>
        <div class="cm-report-progress__bar"><span id="cmReportProgressBar"></span></div>
        <ul id="cmReportProgressLog" class="cm-report-progress__log"></ul>
        <small class="cm-report-progress__hint">Pode ocultar esta janela: o relatório continua sendo gerado e o download começa ao final.</small>
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
      setText('cmReportProgressText', total
        ? 'Montando as linhas do relatório…'
        : 'Nenhuma movimentação no filtro: gerando o relatório vazio…');
    },
    item({ index, total, item }) {
      const percent = total ? Math.round((index / total) * 100) : 100;
      const bar = el('cmReportProgressBar');
      if (bar) bar.style.width = `${percent}%`;
      setText('cmReportProgressCount', `${index} de ${total}`);
      if (index === total) setText('cmReportProgressText', 'Finalizando o PDF (totais e dashboard)…');

      const log = el('cmReportProgressLog');
      if (!log || !item) return;

      const tipo = String(item.tipo || '').toUpperCase();
      const li = document.createElement('li');
      li.className = item.transferencia ? 'is-transfer' : tipo.startsWith('ENT') ? 'is-in' : 'is-out';
      li.innerHTML = `
        <span class="cm-report-progress__icon">✓</span>
        <span class="cm-report-progress__name">${escapeHtml(item.data)} · ${escapeHtml(item.documento || `#${item.id}`)} · ${escapeHtml(item.nome || '—')}</span>
        <span class="cm-report-progress__value">${escapeHtml(item.transferencia ? 'Transf.' : tipo || '—')} ${escapeHtml(fmtBRL(item.valor))}</span>
      `;
      log.prepend(li);
    },
  };
}

function base64ToPdfBlob(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Baixa o PDF e mostra o resumo com a opção de abrir em nova aba. */
export function finishPdfReport(result) {
  const blobUrl = URL.createObjectURL(base64ToPdfBlob(result.pdf));

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = result.filename || 'relatorio_caixa.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();

  showCenterModal({
    variant: 'success',
    title: 'Relatório PDF pronto',
    timeoutMs: null,
    message: `<b>${Number(result.total) || 0}</b> movimentação(ões) no relatório.<br><small>${escapeHtml(a.download)} foi baixado.</small>`,
    buttons: [
      { label: 'Fechar', variant: 'cancel' },
      { label: 'Abrir PDF', variant: 'primary', action: () => { window.open(blobUrl, '_blank', 'noopener'); } },
    ],
  }).finally(() => setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000));
}
