export function showToast(message, type = 'info') {
  const prefix = {
    success: '✅',
    error: '❌',
    warn: '⚠️',
    warning: '⚠️',
    info: 'ℹ️',
  }[type] || 'ℹ️';

  window.alert(`${prefix} ${message}`);
}

export function confirmarExclusao(nome) {
  return window.confirm(`Tem certeza que deseja excluir o módulo "${nome}"?`);
}
