export function unwrapArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

export function moduloEstaAtivo(modulo) {
  return modulo.is_active ?? modulo.isActive ?? true;
}
