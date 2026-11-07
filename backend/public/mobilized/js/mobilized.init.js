'use strict';

import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js';
import { bindActions, loadList, refreshItemImage, setSort } from './mobilized.actions.js';
import { resetEditor } from './mobilized.form.js';
import { configureModal, exposeDetailsApi } from './mobilized.modal.js';
import { renderItems, renderTotals } from './mobilized.render.js';
import { dom, fields, itemImageFile, state } from './mobilized.state.js';

function init() {
  try {
    document.body.append(itemImageFile);
    configureModal({ refreshItemImage });
    if (fields.acquired_at) enhanceBrDateTime(fields.acquired_at);
    bindActions(); exposeDetailsApi();

    createSortableTable({
      table: dom.table,
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: ['acquired_at', 'title', 'status', 'items_count', 'items_total'],
      onSort: setSort,
    });

    resetEditor(); renderItems(); renderTotals(); loadList(true);
  } catch (error) {
    console.error('[mobilized.init] Falha na inicialização:', error);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
