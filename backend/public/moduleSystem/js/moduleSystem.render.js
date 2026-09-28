import { elements } from './moduleSystem.config.js';
import { moduloEstaAtivo } from './moduleSystem.utils.js';

function criarCelula(texto = '') {
  const td = document.createElement('td');
  td.textContent = texto;
  return td;
}

function criarBotao({ texto, titulo, onClick }) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'btn btn-toolbar btn-sm';
  botao.textContent = texto;
  botao.title = titulo;
  botao.addEventListener('click', onClick);
  return botao;
}

export function renderModulesTable(modules, handlers) {
  elements.tbody.innerHTML = '';

  if (!modules.length) {
    const tr = document.createElement('tr');
    const td = criarCelula('Nenhum módulo encontrado.');
    td.colSpan = 5;
    td.className = 'ms-table-empty';
    tr.appendChild(td);
    elements.tbody.appendChild(tr);
    return;
  }

  modules.forEach((modulo) => {
    const ativo = moduloEstaAtivo(modulo);
    const tr = document.createElement('tr');
    const tdActive = document.createElement('td');
    const badge = document.createElement('span');
    badge.textContent = ativo ? 'Ativo' : 'Inativo';
    badge.className = ativo
      ? 'ms-badge ms-badge--active'
      : 'ms-badge ms-badge--inactive';
    tdActive.appendChild(badge);

    const tdActions = document.createElement('td');
    tdActions.className = 'ms-actions-cell';
    tdActions.append(
      criarBotao({ texto: '✏️', titulo: 'Editar módulo', onClick: () => handlers.editar(modulo) }),
      criarBotao({
        texto: ativo ? '⏸' : '▶',
        titulo: ativo ? 'Desativar' : 'Ativar',
        onClick: () => handlers.alternar(modulo),
      }),
      criarBotao({ texto: '🗑', titulo: 'Excluir módulo', onClick: () => handlers.excluir(modulo) })
    );

    tr.append(
      criarCelula(modulo.id),
      criarCelula(modulo.name || ''),
      criarCelula(modulo.path || ''),
      tdActive,
      tdActions
    );
    elements.tbody.appendChild(tr);
  });
}
