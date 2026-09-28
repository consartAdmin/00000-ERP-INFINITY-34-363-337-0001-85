// Adaptador local para que o módulo não deixe de inicializar quando o
// centerAlertModal global não estiver disponível.
export function showCenterModal(options = {}) {
  const externalModal = window.showCenterModal;

  if (typeof externalModal === 'function' && externalModal !== showCenterModal) {
    return externalModal(options);
  }

  const title = options.title ? `${options.title}\n\n` : '';
  window.alert(`${title}${options.message || ''}`);
}
