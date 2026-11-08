// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.tabs.js — Troca entre Lista / Inventário / Auditoria       ║
// ║ CONSART ERP | Inventário                                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const PANEL_BY_ID = { 'tab-list': 'list', 'tab-edit': 'edit', 'tab-logs': 'logs' };

export function activateTab(els, name) {
  const panelMap = { list: els.tabListPanel, edit: els.tabEditPanel, logs: els.tabLogsPanel };

  Object.entries(panelMap).forEach(([key, panel]) => {
    if (!panel) return;
    const active = key === name;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
}

/** Botões com data-tab="tab-list|tab-edit|tab-logs" */
export function bindTabButtons(els) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = PANEL_BY_ID[button.dataset.tab];
      if (name) activateTab(els, name);
    });
  });
}
