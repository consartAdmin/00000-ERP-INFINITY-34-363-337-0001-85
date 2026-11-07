'use strict';

export function validateMobilized(payload) {
  if (!payload.title) return 'Informe o título do mobilizado.';
  return null;
}

export function validateItem(payload) {
  if (!payload.description) return 'Informe a descrição do item.';
  if (!(payload.quantity > 0)) return 'A quantidade deve ser maior que zero.';
  return null;
}
