export function showToast(message, type = 'info') {
  const titles = {
    info: 'Informação',
    success: 'Sucesso',
    error: 'Erro',
    warning: 'Atenção',
    warn: 'Atenção',
  };

  if (window.Alert) {
    const fn =
      window.Alert[type] ||
      (type === 'warning' ? window.Alert.warn : window.Alert.info);
    fn(titles[type] || titles.info, message);
    return;
  }

  window.alert(message);
}
