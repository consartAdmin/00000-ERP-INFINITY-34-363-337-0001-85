// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ employees.index.js — Bootstrap do módulo (CONSART ERP | ESM)                 ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
'use strict';

import { bindEvents } from './employees.events.js';
import { resetEmployeeForm } from './employees.form.js';
import { loadEmployees } from './employees.core.js';
import { renderDocsTable } from './employees.render.js';
import { resetDocForm } from './employees.docs.js';
import { Modal } from '/public/includes/js/modal.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { state } from './employees.state.js';

async function boot() {
  Modal.setup();
  bindEvents();
  resetEmployeeForm(false);

  // ordenação em todas as colunas (feita no backend → vale para a lista inteira)
  createSortableTable({
    table: '#employeesTable',
    async onSort({ column, direction }) {
      state.sort = column;
      state.dir = direction;
      await loadEmployees({ page: 1 });
    },
  });

  await loadEmployees({ q: '', includeInactive: false });
  renderDocsTable([]);
  resetDocForm();
}

boot().catch((e) => {
  console.error(e);
  alert(`Falha ao iniciar: ${e.message}`);
});