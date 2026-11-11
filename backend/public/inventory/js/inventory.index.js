// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.index.js — Entry point (bind + init)                      ║
// ║ CONSART ERP | Inventário (Frontend ESM)                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getEls } from './inventory.dom.js';
import { state } from './inventory.state.js';

import { activateTab, bindTabButtons } from './inventory.tabs.js';
import { Modal } from '/public/includes/js/modal.js';
import {
  bindKeyboardShortcuts,
  applySaveHotkeyHint,
} from './inventory.shortcuts.js';

import {
  loadInventories,
  onSelectInventory,
  resetInventoryForm,
  saveInventory,
  finalizeInventory,
  reopenInventory,
  updateInventoryKeyboardSelection,
} from './inventory.inventories.js';

import {
  clearLotSelect,
  loadItems,
  renderItemsTable,
  openProductSearchModal,
  saveItem,
  deleteItem,
  bindItemsFieldEvents,
  bindItemsKeyboard,
  bindItemsTableActions,
} from './inventory.items.js';

import { loadLogs, renderLogsTable, clearLogFilters } from './inventory.logs.js';
import { focusProductField } from './inventory.utils.js';
import { bindQuickCreate } from './inventory.quickCreate.js';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */

function setButtonsDisabled(buttons, disabled) {
  buttons.forEach((button) => {
    if (button) {
      button.disabled = disabled;
    }
  });
}

/* ──────────────────────────────────────────────────────────────
   Events
────────────────────────────────────────────────────────────── */

function bindEvents(els) {
  let savingInventory = false;
  let finalizingInventory = false;

  /* ────────────────────────────────────────────────────────────
     Inventories: search and refresh
  ──────────────────────────────────────────────────────────── */

  els.btnSearchInventories?.addEventListener('click', async () => {
    await loadInventories(els);
  });

  els.btnRefreshInventories?.addEventListener('click', async () => {
    await loadInventories(els);
  });

  /* ────────────────────────────────────────────────────────────
     New inventory
  ──────────────────────────────────────────────────────────── */

  els.btnNewInventory?.addEventListener('click', () => {
    resetInventoryForm(els);
    renderItemsTable(els);
    activateTab(els, 'edit');
    focusProductField(els);
  });

  /* ────────────────────────────────────────────────────────────
     Save inventory
  ──────────────────────────────────────────────────────────── */

  const handleSaveInventory = async () => {
    if (savingInventory || finalizingInventory) return;

    savingInventory = true;

    const saveButtons = [
      els.btnSaveInventory,
      els.btnSaveInventoryInline,
    ];

    setButtonsDisabled(saveButtons, true);

    try {
      await saveInventory(els, {
        afterReloadInventories: async () => {
          await loadInventories(els);
        },

        afterSelectCreated: async (created) => {
          state.currentInventory = created;

          await onSelectInventory(els, created, {
            loadItemsFn: async () => {
              await loadItems(els);
            },
          });
        },
      });
    } catch (error) {
      console.error(
        '[INVENTORY][ERROR] Falha ao salvar inventário:',
        error
      );
    } finally {
      savingInventory = false;
      setButtonsDisabled(saveButtons, false);
    }
  };

  els.btnSaveInventory?.addEventListener(
    'click',
    handleSaveInventory
  );

  els.btnSaveInventoryInline?.addEventListener(
    'click',
    handleSaveInventory
  );

  /* ────────────────────────────────────────────────────────────
     Finalize inventory and apply stock
  ──────────────────────────────────────────────────────────── */

  const handleFinalizeInventory = async () => {
    if (savingInventory || finalizingInventory) return;

    finalizingInventory = true;

    const finalizeButtons = [
      els.btnFinalizeInventory,
      els.btnFinalizeInventoryInline,
    ];

    setButtonsDisabled(finalizeButtons, true);

    try {
      await finalizeInventory(els, {
        afterReloadInventories: async () => {
          await loadInventories(els);
        },

        afterReloadItems: async () => {
          await loadItems(els);
        },
      });
    } catch (error) {
      console.error(
        '[INVENTORY][ERROR] Falha ao finalizar inventário:',
        error
      );
    } finally {
      finalizingInventory = false;
      setButtonsDisabled(finalizeButtons, false);
    }
  };

  els.btnFinalizeInventory?.addEventListener(
    'click',
    handleFinalizeInventory
  );

  els.btnFinalizeInventoryInline?.addEventListener(
    'click',
    handleFinalizeInventory
  );

  /* ────────────────────────────────────────────────────────────
     Items buttons
  ──────────────────────────────────────────────────────────── */

  els.btnSearchProduct?.addEventListener('click', () => {
    openProductSearchModal(els);
  });

  els.btnSaveItem?.addEventListener('click', async () => {
    await saveItem(els);
  });

  /* ────────────────────────────────────────────────────────────
     Delete item
  ──────────────────────────────────────────────────────────── */

  els.itemsTbody?.addEventListener('click', async (event) => {
    const button = event.target.closest('.js-delete-item');

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const itemId = button.dataset.id;

    if (!itemId) return;

    await deleteItem(els, itemId);
  });

  /* ────────────────────────────────────────────────────────────
     Open/select inventory by clicking table row
  ──────────────────────────────────────────────────────────── */

  els.inventoryTableBody?.addEventListener(
    'click',
    async (event) => {
      // O lápis (data-act="open") abre como o clique na linha; Relatório e Estornar têm handler próprio
      const clickedAction = event.target.closest(
        [
          'a',
          '[data-act="report"]',
          '[data-act="reopen"]',
        ].join(',')
      );

      if (clickedAction) return;

      const row = event.target.closest('tr');

      if (!row) return;

      const inventoryId =
        row.dataset.id ||
        row.dataset.inventoryId ||
        row.dataset.inventory_id ||
        row.querySelector('[data-id]')?.dataset?.id ||
        null;

      if (!inventoryId) return;

      const cachedInventory = state.inventoryRowsCache.find(
        (entry) => {
          const cachedId =
            entry?.data?.inventory_id ??
            entry?.data?.id ??
            '';

          return String(cachedId) === String(inventoryId);
        }
      );

      const inventoryData =
        cachedInventory?.data || {
          inventory_id: inventoryId,
          id: inventoryId,
        };

      await onSelectInventory(els, inventoryData, {
        loadItemsFn: async () => {
          await loadItems(els);
        },
      });

      activateTab(els, 'edit');
      focusProductField(els);
    }
  );

  /* ────────────────────────────────────────────────────────────
     Reopen inventory
  ──────────────────────────────────────────────────────────── */

  els.inventoryTableBody?.addEventListener(
    'click',
    async (event) => {
      const button = event.target.closest(
        '[data-act="reopen"]'
      );

      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      const inventoryId = button.dataset.id;
      const inventoryCode = button.dataset.code;

      if (!inventoryId) return;

      await reopenInventory(
        els,
        inventoryId,
        inventoryCode,
        {
          afterReloadInventories: async () => {
            await loadInventories(els);
          },

          afterReloadCurrent: async (reopenedInventoryId) => {
            const currentInventoryId =
              state.currentInventory?.inventory_id ??
              state.currentInventory?.id;

            if (
              currentInventoryId &&
              String(currentInventoryId) ===
              String(reopenedInventoryId)
            ) {
              await onSelectInventory(
                els,
                state.currentInventory,
                {
                  loadItemsFn: async () => {
                    await loadItems(els);
                  },
                }
              );
            }
          },
        }
      );
    }
  );

  /* ────────────────────────────────────────────────────────────
     Inventory search keyboard navigation
  ──────────────────────────────────────────────────────────── */

  els.searchInventory?.addEventListener(
    'keydown',
    async (event) => {
      const rows = state.inventoryRowsCache || [];

      if (event.key === 'Enter') {
        event.preventDefault();

        if (
          state.inventoryKeyboardIndex >= 0 &&
          rows[state.inventoryKeyboardIndex]
        ) {
          const selected =
            rows[state.inventoryKeyboardIndex];

          await onSelectInventory(
            els,
            selected.data,
            {
              loadItemsFn: async () => {
                await loadItems(els);
              },
            }
          );

          activateTab(els, 'edit');
          focusProductField(els);
          return;
        }

        await loadInventories(els);
        return;
      }

      if (!rows.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();

        state.inventoryKeyboardIndex =
          state.inventoryKeyboardIndex <
            rows.length - 1
            ? state.inventoryKeyboardIndex + 1
            : 0;

        updateInventoryKeyboardSelection();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();

        state.inventoryKeyboardIndex =
          state.inventoryKeyboardIndex > 0
            ? state.inventoryKeyboardIndex - 1
            : rows.length - 1;

        updateInventoryKeyboardSelection();
      }
    }
  );

  els.statusFilter?.addEventListener(
    'keydown',
    async (event) => {
      if (event.key !== 'Enter') return;

      event.preventDefault();
      await loadInventories(els);
    }
  );

  /* ────────────────────────────────────────────────────────────
     Tabs
  ──────────────────────────────────────────────────────────── */

  els.tabListBtn?.addEventListener('click', () => {
    activateTab(els, 'list');
  });

  els.tabEditBtn?.addEventListener('click', () => {
    activateTab(els, 'edit');
  });

  els.tabLogsBtn?.addEventListener(
    'click',
    async () => {
      activateTab(els, 'logs');
      await loadLogs(els);
    }
  );

  /* ────────────────────────────────────────────────────────────
     Logs
  ──────────────────────────────────────────────────────────── */

  els.btnSearchLogs?.addEventListener(
    'click',
    async (event) => {
      event.preventDefault();
      await loadLogs(els);
    }
  );
  [els.logUserName, els.logProductCode].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); renderLogsTable(els); }
    });
  });
  document.getElementById('btnClearLogFilters')?.addEventListener('click', () => clearLogFilters(els));

  /* ────────────────────────────────────────────────────────────
     Limpar filtros da lista + recarregar depois da importação XLS
  ──────────────────────────────────────────────────────────── */
  document.getElementById('btnClearInventoryFilters')?.addEventListener('click', async () => {
    if (els.searchInventory) els.searchInventory.value = '';
    if (els.statusFilter) els.statusFilter.value = '';
    await loadInventories(els);
  });
  els.statusFilter?.addEventListener('change', async () => { await loadInventories(els); });
  window.addEventListener('inventory:xls-imported', async () => { await loadInventories(els); });

  /* ────────────────────────────────────────────────────────────
     Observações do inventário (modal)
  ──────────────────────────────────────────────────────────── */
  const notesText = document.getElementById('inventoryNotesModalText');
  const saveNotes = () => {
    if (els.inventoryNotes) els.inventoryNotes.value = notesText?.value || '';
    Modal.close('inventoryNotesModal');
  };
  els.btnOpenInventoryNotes?.addEventListener('click', () => {
    if (notesText) notesText.value = els.inventoryNotes?.value || '';
    notesText.disabled = !!els.inventoryNotes?.disabled;
    Modal.open('inventoryNotesModal', { focusSelector: '#inventoryNotesModalText' });
  });
  document.getElementById('btnSaveInventoryNotes')?.addEventListener('click', saveNotes);
  notesText?.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); saveNotes(); }
  });

  bindTabButtons(els);

  /* ────────────────────────────────────────────────────────────
     Item field and keyboard events
  ──────────────────────────────────────────────────────────── */

  bindItemsFieldEvents(els);

  bindItemsKeyboard(els, {
    onSaveItem: async () => {
      await saveItem(els);
    },
  });

  bindItemsTableActions(els);

  // "+" ao lado de Unidade / Localização / Lote: cadastro rápido sem sair da tela
  bindQuickCreate(els);

  return {
    handleSaveInventory,
    handleFinalizeInventory,
  };
}

/* ──────────────────────────────────────────────────────────────
   Init
────────────────────────────────────────────────────────────── */

async function init() {
  const els = getEls();

  try {
    Modal.setup();
    const {
      handleSaveInventory,
    } = bindEvents(els);

    bindKeyboardShortcuts({
      triggerSave: handleSaveInventory,
    });

    applySaveHotkeyHint(els);

    clearLotSelect(els);
    resetInventoryForm(els);
    renderItemsTable(els);

    await loadInventories(els);

    activateTab(els, 'list');
  } catch (error) {
    console.error(
      '[INVENTORY][ERROR] init():',
      error
    );
  }
}

/* ──────────────────────────────────────────────────────────────
   Boot
────────────────────────────────────────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    init,
    { once: true }
  );
} else {
  init();
}