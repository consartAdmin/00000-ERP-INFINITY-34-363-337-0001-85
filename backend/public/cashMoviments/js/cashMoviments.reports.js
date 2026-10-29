// ╔══════════════════════════════════════════════════════════════════════╗
// ║ caixa.reports.js — PDF + ZIP do período                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API, PATH_MOV } from './cashMoviments.config.js';
import { buildQueryFromFilters, getPeriodo } from './cashMoviments.filters.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { fetchPdfReportStream, finishPdfReport, openPdfProgressModal } from './cashMoviments.reportProgress.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));

export async function onAbrirRelatorioPdf(dom) {
  const button = dom.elBtnRelatorio;
  if (button?.disabled) return;

  const oldHtml = button?.innerHTML;
  try {
    if (button) { button.disabled = true; button.textContent = '⏳ Gerando…'; }

    const params = buildQueryFromFilters(dom);
    params.set('stream', '1');

    const progress = openPdfProgressModal();
    const result = await fetchPdfReportStream(`${API}/relatorio/pdf?${params.toString()}`, (event) => {
      if (event.type === 'phase') progress.phase(event.message);
      if (event.type === 'start') progress.start(event.total);
      if (event.type === 'item') progress.item(event);
    });

    finishPdfReport(result);
  } catch (error) {
    console.error('[CAIXA][PDF]', error);
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
  try {
    const { startDate: d1, endDate: d2 } = getPeriodo(dom);

    if (!d1 || !d2) {
      const seguir = confirm(
        'Você não definiu um período "De/Até".\n' +
        'O sistema pode tentar baixar anexos de TODOS os lançamentos.\n\n' +
        'Deseja continuar mesmo assim?'
      );
      if (!seguir) return;
    }

    const params = buildQueryFromFilters(dom);
    const qs = params.toString();

    let url = `${API}/${PATH_MOV}/zip/periodo?${qs}`;

    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) throw new Error(`HEAD falhou: HTTP ${head.status}`);

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);

  } catch (e) {
    console.error('[CAIXA][ZIP]', e);
    alert(
      'Download ZIP ainda não está disponível no backend.\n\n' +
      'Certifique-se de expor uma rota GET/HEAD semelhante a:\n' +
      `${API}/${PATH_MOV}/zip?date_from=2025-01-01T00:00:00&date_to=2025-01-31T23:59:59`
    );
  }
}