// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.export.js — Exportar PDF / Excel | CONSART ERP     ║
// ║ GET /api/price-commissions/export?format=pdf|xlsx                   ║
// ║ Usa os filtros e a ordenação da tela, sem paginação.                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './priceCommissions.config.js';
import { buildFilterParams } from './priceCommissions.filters.js';

export async function exportPriceCommissions(format, button) {
  const { limit, offset, ...filters } = buildFilterParams();
  const params = new URLSearchParams({ format });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value != null) params.set(key, value);
  });

  const label = button?.querySelector('span');
  const original = label?.textContent;
  if (button) button.disabled = true;
  if (label) label.textContent = 'Gerando...';

  try {
    const response = await fetch(`${ROUTES.export}?${params}`, { cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Erro HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comissoes-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    throw new Error(`Não foi possível gerar o relatório: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = original;
  }
}
