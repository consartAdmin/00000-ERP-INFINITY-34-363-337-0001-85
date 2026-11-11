// ╔══════════════════════════════════════════════════════════════════════╗
// ║ caixa.reports.js — PDF + ZIP do período                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API, PATH_MOV } from './cashMoviments.config.js';
import { buildQueryFromFilters, getPeriodo } from './cashMoviments.filters.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export async function onAbrirRelatorioPdf(dom) {
  try {
    const params = buildQueryFromFilters(dom);

    let url = `${API}/relatorio/pdf?${params.toString()}`;
    let head = await fetch(url, { method: 'HEAD' });

    if (!head.ok) {
      url = `${API}/relatorio?${params.toString()}`;
      head = await fetch(url, { method: 'HEAD' });
    }

    if (!head.ok) throw new Error('Rota de relatório não encontrada.');
    window.open(url, '_blank');

  } catch {
    alert('Relatório PDF ainda não disponível no backend.');
  }
}

export async function onBaixarZipPeriodo(dom) {
  try {
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