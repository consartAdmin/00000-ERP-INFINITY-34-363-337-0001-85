// ╔══════════════════════════════════════════════════════════════════════╗
// ║ units.export.js — Exportar PDF / Excel das unidades                  ║
// ║ GET /api/units/export?format=pdf|xlsx&q=&onlyActive=                 ║
// ║ Usa a busca e o "Incluir inativos" da tela.                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './units.state.js';

function apiOrigin() {
  const base = String(window.apiBase || window.API_BASE || '').replace(/\/+$/, '');
  return base.replace(/\/api$/i, '');
}

export async function exportUnits(format, button) {
  const params = new URLSearchParams({ format });
  const q = String(state.refs.search?.value || '').trim();
  if (q) params.set('q', q);
  if (!state.refs.includeInactive?.checked) params.set('onlyActive', 'true');

  const label = button?.querySelector('span');
  const original = label?.textContent;
  if (button) button.disabled = true;
  if (label) label.textContent = 'Gerando...';

  try {
    const response = await fetch(`${apiOrigin()}/api/units/export?${params}`, { credentials: 'include' });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Erro HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unidades-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    console.error('[units.export]', error);
    window.alert(`Não foi possível exportar: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = original;
  }
}
