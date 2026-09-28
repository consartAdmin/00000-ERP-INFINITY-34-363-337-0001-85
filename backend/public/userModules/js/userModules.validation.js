export function validarSalvamento(usuarioId, checks) {
  if (!usuarioId) return 'Selecione um usuário antes de salvar.';
  if (!checks.length) return 'Nenhum módulo encontrado para salvar.';
  return null;
}
