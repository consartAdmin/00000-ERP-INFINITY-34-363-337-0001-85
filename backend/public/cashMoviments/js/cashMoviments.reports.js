// ╔══════════════════════════════════════════════════════════════════════╗
// ║ caixa.reports.js — PDF + ZIP do período                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API, API_BASE, PATH_MOV } from './cashMoviments.config.js';
import { buildQueryFromFilters, getPeriodo } from './cashMoviments.filters.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import {
  fetchProgressStream,
  finishPdfReport,
  finishZipDownload,
  openPdfProgressModal,
  openZipProgressModal,
} from './cashMoviments.reportProgress.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));

function triggerDirectDownload(href) {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

export async function onAbrirRelatorioPdf(dom) {
  const button = dom.elBtnRelatorio;
  if (button?.disabled) return;

  const oldHtml = button?.innerHTML;
  const params = buildQueryFromFilters(dom);
  try {
    if (button) { button.disabled = true; button.textContent = '⏳ Gerando…'; }

    const streamParams = new URLSearchParams(params);
    streamParams.set('stream', '1');

    const progress = openPdfProgressModal();
    const result = await fetchProgressStream(`${API}/relatorio/pdf?${streamParams.toString()}`, (event) => {
      if (event.type === 'phase') progress.phase(event.message);
      if (event.type === 'start') progress.start(event.total);
      if (event.type === 'item') progress.item(event);
    });

    finishPdfReport(result);
  } catch (error) {
    console.error('[CAIXA][PDF]', error);

    // O progresso caiu no caminho: baixa do jeito antigo (sem progresso)
    if (error.incomplete) {
      triggerDirectDownload(`${API}/relatorio/pdf?${params.toString()}`);
      showCenterModal({
        variant: 'warning',
        title: 'Relatório PDF',
        timeoutMs: null,
        message: `${escapeHtml(error.message)}<br><br>O relatório está sendo baixado pelo modo direto, sem a barra de progresso. Aguarde o download começar.`,
      });
      return;
    }

    showCenterModal({
      variant: 'error',
      title: 'Erro ao gerar o Relatório PDF',
      message: escapeHtml(error.message || 'Falha na comunicação com a API.'),
    });
  } finally {
    if (button) { button.disabled = false; button.innerHTML = oldHtml; }
  }
}

export async function onBaixarZipPeriodo(dom) {
  const button = dom.elBtnZip;
  if (button?.disabled) return;

  const { startDate: d1, endDate: d2 } = getPeriodo(dom);

  if (!d1 || !d2) {
    const seguir = await showCenterModal({
      variant: 'warning',
      title: 'Período não definido',
      message: 'Sem período "De/Até", o ZIP pode juntar os anexos de <b>todos</b> os lançamentos. Deseja continuar?',
      okText: 'Continuar',
      closeText: 'Cancelar',
      timeoutMs: null,
    });
    if (seguir !== true) return;
  }

  const oldHtml = button?.innerHTML;
  try {
    if (button) { button.disabled = true; button.textContent = '⏳ Montando…'; }

    const params = buildQueryFromFilters(dom);
    params.set('stream', '1');

    const progress = openZipProgressModal();
    const result = await fetchProgressStream(`${API}/${PATH_MOV}/zip/periodo?${params.toString()}`, (event) => {
      if (event.type === 'phase') progress.phase(event.message);
      if (event.type === 'start') progress.start(event.total);
      if (event.type === 'item') progress.item(event);
    });

    finishZipDownload({ ...result, url: `${API_BASE}${result.url}` });
  } catch (error) {
    console.error('[CAIXA][ZIP]', error);
    showCenterModal({
      variant: 'error',
      title: 'Erro ao baixar os anexos do período',
      message: escapeHtml(error.message || 'Falha na comunicação com a API.'),
    });
  } finally {
    if (button) { button.disabled = false; button.innerHTML = oldHtml; }
  }
}
