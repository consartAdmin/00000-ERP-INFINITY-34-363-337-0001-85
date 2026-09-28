export function getModuloKey(modulo) {
  const raw =
    modulo.id ?? modulo.modulo_id ?? modulo.codigo ?? modulo.code ?? modulo.module_code;

  if (raw == null) {
    console.warn('[userModules] Módulo sem código definido:', modulo);
    return NaN;
  }

  return Number(raw);
}

export function unwrapArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}
