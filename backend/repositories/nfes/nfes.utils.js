// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfes.utils.js — Helpers puros (dígitos, booleanos, busca profunda)   ║
// ╚══════════════════════════════════════════════════════════════════════╝

/* =====================================================================
 * Utils
 * ===================================================================== */
export function digitsOnly(v) {
  return String(v || '').replace(/\D+/g, '');
}

export function isTruthy(v) {
  return v === true || v === '1' || v === 1 || String(v || '').toLowerCase() === 'true';
}

// PlugNotas/TecnoSpeed may place fiscal details at the root, in `resumo`,
// `remote`, `data`, or inside arrays. Keep the useful SEFAZ diagnostics even
// when the provider changes that envelope.
export function findDeepValue(input, acceptedKeys, seen = new WeakSet()) {
  if (!input || typeof input !== 'object' || seen.has(input)) return null;
  seen.add(input);

  const keys = new Set(acceptedKeys.map((key) => String(key).toLowerCase()));
  for (const [key, value] of Object.entries(input)) {
    if (keys.has(String(key).toLowerCase()) && value != null && value !== '') {
      if (typeof value === 'string' || typeof value === 'number') return value;
    }
  }

  for (const value of Object.values(input)) {
    if (value && typeof value === 'object') {
      const found = findDeepValue(value, acceptedKeys, seen);
      if (found != null && found !== '') return found;
    }
  }

  return null;
}
