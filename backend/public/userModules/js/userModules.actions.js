import { elements } from './userModules.config.js';
import { aplicarFiltrosUI, atualizarContadores } from './userModules.render.js';

export function alterarMarcacaoVisiveis(marcar) {
  elements.listaModulos.querySelectorAll('.modulo-item').forEach((item) => {
    if (item.style.display === 'none') return;
    const check = item.querySelector('input[type="checkbox"][data-module-id]');
    const status = item.querySelector('.modulo-checkbox span:nth-child(2)');
    if (!check) return;
    check.checked = marcar;
    item.classList.toggle('modulo-item--checked', marcar);
    if (status) status.textContent = marcar ? 'Permitido' : 'Bloqueado';
  });
  atualizarContadores();
  aplicarFiltrosUI();
}

export function registrarAcoes() {
  elements.btnMarcarTodos?.addEventListener('click', () =>
    alterarMarcacaoVisiveis(true)
  );
  elements.btnLimparTodos?.addEventListener('click', () =>
    alterarMarcacaoVisiveis(false)
  );
}
