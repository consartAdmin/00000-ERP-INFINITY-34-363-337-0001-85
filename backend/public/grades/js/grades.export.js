// ╔══════════════════════════════════════════════════════════════════════╗
// ║ grades.export.js — Exportar PDF / Excel das grades                   ║
// ║ GET /api/grades/export?format=pdf|xlsx&q=&is_active=                 ║
// ║ Usa os filtros digitados na tela (mesmo sem clicar em Filtrar).      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { API_BASE } from './grades.config.js';
import { elements } from './grades.state.js';
import { showToast } from './grades.utils.js';

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export async function exportGrades(format, button) {
  const params = new URLSearchParams({ format });
  const q = elements.inputBusca?.value.trim() || '';
  const status = elements.selectStatus?.value || '';

  if (q) params.set('q', q);
  if (status === 'ativo' || status === 'inativo') params.set('is_active', status === 'ativo' ? 'true' : 'false');

  const label = button?.querySelector('span');
  const original = label?.textContent;
  if (button) button.disabled = true;
  if (label) label.textContent = 'Gerando...';

  try {
    const response = await fetch(`${API_BASE}/export?${params}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Erro HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grades-${stamp()}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    console.error('[grades.export]', error);
    showToast(`Não foi possível exportar: ${error.message}`, 'erro');
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = original;
  }
}
