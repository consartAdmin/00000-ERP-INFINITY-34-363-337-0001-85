import { FALLBACK_TYPE_COLOR } from './customerStatusTypes.config.js';
import { elements } from './customerStatusTypes.state.js';
import {
  escapeHtml,
  safeColor
} from './customerStatusTypes.utils.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

/* =====================================================================
   FOOTER — TOTAL DE REGISTROS
===================================================================== */

function renderTableInfo(total = 0) {
  if (!elements.apTableInfo) return;

  elements.apTableInfo.textContent =
    `${total} ${total === 1 ? 'Registro' : 'Registros'}`;
}

/* =====================================================================
   TABELA VAZIA
===================================================================== */

export function renderEmptyTypes(
  message = 'Nenhum tipo de status encontrado.'
) {
  elements.typesTableBody.innerHTML = `
    <tr>
      <td colspan="6" class="empty-row">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;

  renderTableInfo(0);
}

/* =====================================================================
   RENDERIZAÇÃO DOS TIPOS DE STATUS
===================================================================== */

export function renderTypes(rows = []) {
  const normalizedRows = Array.isArray(rows) ? rows : [];

  elements.typesTableBody.innerHTML = '';

  renderTableInfo(normalizedRows.length);

  if (!normalizedRows.length) {
    renderEmptyTypes();
    return;
  }

  for (const type of normalizedRows) {
    const color = safeColor(
      type.color_hex,
      FALLBACK_TYPE_COLOR
    );

    const row = document.createElement('tr');

    row.innerHTML = `
      <td>
        ${escapeHtml(type.id)}
      </td>

      <td>
        ${escapeHtml(type.name_pt)}
      </td>

      <td>
        ${escapeHtml(type.internal_code)}
      </td>

      <td>
        <span style="display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums;">
          <span aria-hidden="true" style="width:12px;height:12px;border-radius:50%;background:${escapeHtml(color)};box-shadow:0 0 0 1px rgba(15,23,42,.12);"></span>
          ${escapeHtml(color)}
        </span>
      </td>

      <td class="${type.is_active ? 'status-active' : 'status-inactive'}">
        ${type.is_active ? 'Sim' : 'Não'}
      </td>

      <td>
        ${actionIconsHtml([
          {
            action: 'edit',
            title: 'Editar',
            attrs: {
              'data-edit-id': type.id ?? '',
              'data-edit-name': type.name_pt ?? '',
              'data-edit-code': type.internal_code ?? '',
              'data-edit-color': color,
              'data-edit-order': type.sort_order ?? 0,
            },
          },
          {
            action: 'delete',
            title: 'Excluir',
            attrs: {
              'data-delete-id': type.id ?? '',
              'data-delete-name': type.name_pt ?? '',
            },
          },
        ])}
      </td>
    `;

    elements.typesTableBody.appendChild(row);
  }
}

/* =====================================================================
   ERRO AO CARREGAR A TABELA
===================================================================== */

export function renderTypesError(message) {
  renderEmptyTypes(
    `Erro ao carregar tipos: ${message}`
  );
}