import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const TITLES = {
  success: 'Sucesso',
  error: 'Erro',
  warn: 'Atenção',
  warning: 'Atenção',
  info: 'Informação',
};

export function showToast(message, type = 'info') {
  const variant = type === 'warn' ? 'warning' : type;

  return showCenterModal({
    variant,
    title: TITLES[type] || TITLES.info,
    message,
  });
}

export async function confirmarAlteracaoEmLote(quantidade, descricao) {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Alteração em lote',
    message: `Confirma ${descricao} em ${quantidade} módulo${quantidade === 1 ? '' : 's'}?`,
    okText: 'Sim, alterar',
    closeText: 'Cancelar',
  });

  return ok === true;
}

export async function confirmarExclusao(nome) {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Confirmar exclusão',
    message: `Tem certeza que deseja excluir o módulo "${nome}"?`,
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  });

  return ok === true;
}
