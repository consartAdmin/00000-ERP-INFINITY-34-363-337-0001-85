// ╔══════════════════════════════════════════════════════════════════════╗
// ║ Total à Receber no período (padrão: mês atual)
// ║ Segue o período do cabeçalho da página Financeiro (dashboardPeriod.js)
// ╚══════════════════════════════════════════════════════════════════════╝

import { moneyBR, fetchDashboard } from './dashboardUtils.js';
import {
  getFinancialPeriod,
  financialPeriodQuery,
  financialPeriodLabel,
  isWholeMonth,
} from './dashboardPeriod.js?v=20261106-1';

export const monthlyReceivablesDashboard = {
  key: 'monthly-receivables',

  render() {
    return `<article class="dash-card" data-dashboard-key="monthly-receivables"><h3 data-label="monthlyReceivablesTitle">Total à Receber Mês</h3><div class="dash-value" data-field="monthlyReceivables">R$ 0,00</div><footer><span data-label="monthlyReceivablesPeriod">—</span></footer></article>`;
  },

  async load(root) {
    try {
      const period = getFinancialPeriod();
      const data = await fetchDashboard(`/api/dashboard/total-receber-mes?${financialPeriodQuery(period)}`);
      const card = root.querySelector('[data-dashboard-key="monthly-receivables"]');
      const el = card?.querySelector('[data-field="monthlyReceivables"]');
      const info = card?.querySelector('[data-label="monthlyReceivablesPeriod"]');
      const title = card?.querySelector('[data-label="monthlyReceivablesTitle"]');

      if (el) el.textContent = moneyBR(data?.valor ?? data?.total ?? 0);
      if (info) info.textContent = financialPeriodLabel(period);
      if (title) title.textContent = isWholeMonth(period) ? 'Total à Receber Mês' : 'Total à Receber no Período';
    } catch (error) {
      console.error('[dashboard][monthly-receivables]', error);
    }
  },
};
