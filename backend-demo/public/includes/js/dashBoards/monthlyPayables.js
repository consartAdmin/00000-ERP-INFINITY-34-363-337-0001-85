// ╔══════════════════════════════════════════════════════════════════════╗
// ║ Total à Pagar no período (padrão: mês atual)
// ║ Segue o período do cabeçalho da página Financeiro (dashboardPeriod.js)
// ╚══════════════════════════════════════════════════════════════════════╝

import { moneyBR, fetchDashboard } from './dashboardUtils.js';
import {
  getFinancialPeriod,
  financialPeriodQuery,
  financialPeriodLabel,
  isWholeMonth,
} from './dashboardPeriod.js?v=20261106-1';

export const monthlyPayablesDashboard = {
  key: 'monthly-payables',

  render() {
    return `<article class="dash-card" data-dashboard-key="monthly-payables"><h3 data-label="monthlyPayablesTitle">Total à Pagar Mês</h3><div class="dash-value" data-field="monthlyPayables">R$ 0,00</div><footer><span data-label="monthlyPayablesPeriod">—</span></footer></article>`;
  },

  async load(root) {
    try {
      const period = getFinancialPeriod();
      const data = await fetchDashboard(`/api/dashboard/total-pagar-mes?${financialPeriodQuery(period)}`);
      const card = root.querySelector('[data-dashboard-key="monthly-payables"]');
      const el = card?.querySelector('[data-field="monthlyPayables"]');
      const info = card?.querySelector('[data-label="monthlyPayablesPeriod"]');
      const title = card?.querySelector('[data-label="monthlyPayablesTitle"]');

      if (el) el.textContent = moneyBR(data?.valor ?? data?.total ?? 0);
      if (info) info.textContent = financialPeriodLabel(period);
      if (title) title.textContent = isWholeMonth(period) ? 'Total à Pagar Mês' : 'Total à Pagar no Período';
    } catch (error) {
      console.error('[dashboard][monthly-payables]', error);
    }
  },
};
