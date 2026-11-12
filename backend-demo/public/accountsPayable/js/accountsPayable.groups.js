// ╔══════════════════════════════════════════════════════════════════════╗
// ║ accountsPayable.groups.js — Filtro "Grupo" do Contas a Pagar       ║
// ║ CONSART ERP                                                        ║
// ║ - Multi-seleção de grupos com contagem por grupo                   ║
// ║ - Chips dos grupos marcados e tag de grupo na tabela               ║
// ║ Chaves iguais a repositories/accountsPayable/accountsPayable.groups ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { patchState, state } from './accountsPayable.state.js';
import { qs } from './accountsPayable.utils.js';

export const PAYABLE_GROUPS = Object.freeze([
  { key: 'IMPOSTOS', label: 'Impostos e Tributos' },
  { key: 'PARCELAMENTOS', label: 'Parcelamentos' },
  { key: 'RH', label: 'R.H / Folha' },
  { key: 'FORNECEDORES', label: 'Fornecedores (mercadorias)' },
  { key: 'OPERACIONAIS', label: 'Despesas operacionais' },
  { key: 'FINANCEIRO', label: 'Financeiro e bancário' },
  { key: 'OUTROS', label: 'Outros / sem grupo' },
]);

const LABELS = Object.fromEntries(PAYABLE_GROUPS.map((g) => [g.key, g.label]));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderGroupTag(key) {
  const group = LABELS[key] ? key : 'OUTROS';
  const label = group === 'FORNECEDORES' ? 'Fornecedores' : LABELS[group];
  return `<span class="ap-group-tag ap-group--${group.toLowerCase()}" title="${escapeHtml(LABELS[group])}">${escapeHtml(label)}</span>`;
}

function renderTriggerLabel() {
  const label = qs('#apGroupTriggerLabel');
  if (!label) return;
  const selected = state.groups;
  if (!selected.length) label.textContent = 'Todos os grupos';
  else if (selected.length === 1) label.textContent = LABELS[selected[0]];
  else label.textContent = `${selected.length} grupos selecionados`;
}

function renderChips() {
  const box = qs('#apGroupChips');
  if (!box) return;
  box.hidden = !state.groups.length;
  box.innerHTML = state.groups.map((key) => `
    <button type="button" class="ap-group-chip ap-group--${key.toLowerCase()}" data-remove-group="${key}"
      title="Remover filtro">${escapeHtml(LABELS[key])} <span aria-hidden="true">✕</span></button>
  `).join('');
}

function renderOptions() {
  const box = qs('#apGroupOptions');
  if (!box) return;
  const counts = state.groupCounts || {};
  box.innerHTML = PAYABLE_GROUPS.map((g) => `
    <label class="ap-group-option">
      <input type="checkbox" value="${g.key}" ${state.groups.includes(g.key) ? 'checked' : ''} />
      <i class="ap-group-dot ap-group--${g.key.toLowerCase()}" aria-hidden="true"></i>
      <span>${escapeHtml(g.label)}</span>
      <small>${Number(counts[g.key] || 0)}</small>
    </label>
  `).join('');
}

/** Atualiza contagens, rótulo e chips (chamado após cada listagem) */
export function renderGroupFilter() {
  renderOptions();
  renderTriggerLabel();
  renderChips();
}

function setMenuOpen(open) {
  const menu = qs('#apGroupMenu');
  const trigger = qs('#apGroupTrigger');
  if (!menu || !trigger) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
}

export function clearGroupFilter() {
  patchState({ groups: [] });
  renderGroupFilter();
}

/**
 * Liga os eventos do filtro. onChange recarrega a lista
 * (mudar grupo aplica na hora, sem precisar de "Aplicar Filtros").
 */
export function initGroupFilter(onChange) {
  const root = qs('#apGroupFilter');
  const menu = qs('#apGroupMenu');
  if (!root || !menu) return;

  const apply = (groups) => {
    patchState({ groups, page: 1 });
    renderGroupFilter();
    onChange?.();
  };

  qs('#apGroupTrigger')?.addEventListener('click', () => setMenuOpen(menu.hidden));

  menu.addEventListener('change', (ev) => {
    const input = ev.target.closest('input[type="checkbox"]');
    if (!input) return;
    const checked = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
    // mantém a ordem fixa dos grupos
    apply(PAYABLE_GROUPS.map((g) => g.key).filter((k) => checked.includes(k)));
  });

  menu.addEventListener('click', (ev) => {
    const action = ev.target.closest('[data-group-action]')?.dataset.groupAction;
    if (action === 'all') apply(PAYABLE_GROUPS.map((g) => g.key));
    if (action === 'none') apply([]);
  });

  qs('#apGroupChips')?.addEventListener('click', (ev) => {
    const key = ev.target.closest('[data-remove-group]')?.dataset.removeGroup;
    if (key) apply(state.groups.filter((k) => k !== key));
  });

  document.addEventListener('click', (ev) => {
    if (!menu.hidden && !root.contains(ev.target)) setMenuOpen(false);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !menu.hidden) setMenuOpen(false);
  });

  renderGroupFilter();
}
