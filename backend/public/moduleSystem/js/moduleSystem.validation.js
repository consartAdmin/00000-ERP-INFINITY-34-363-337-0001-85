export function validarModulo({ name, path }) {
  if (!name || !path) {
    return 'Preencha os campos "Nome do Módulo" e "Caminho".';
  }
  return null;
}

export function validarElementos(elements) {
  const obrigatorios = [
    'moduleForm', 'moduleId', 'name', 'path', 'isActive',
    'btnSave', 'btnClear', 'formTitle', 'searchInput', 'tbody',
  ];
  const ausentes = obrigatorios.filter((nome) => !elements[nome]);
  if (ausentes.length) {
    throw new Error(`Elementos HTML ausentes: ${ausentes.join(', ')}`);
  }
}
