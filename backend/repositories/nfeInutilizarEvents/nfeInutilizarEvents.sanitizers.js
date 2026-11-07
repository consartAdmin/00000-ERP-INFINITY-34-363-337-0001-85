// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.sanitizers.js — Normalização de entrada          ║
// ╚══════════════════════════════════════════════════════════════════════╝

/* =======================================================================
 * Helpers
 * ======================================================================= */
export function normalizeDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function nowYear() {
  return new Date().getFullYear();
}

export function normalizeStatusValue(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Mensagem gravada na coluna message (texto).
 * O provedor às vezes devolve objeto em message/mensagem: String(obj)
 * gravava "[object Object]". Aqui tira o texto ou guarda o JSON.
 */
export function toMessageText(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value !== 'object') return String(value);

  const keys = ['mensagem', 'message', 'xMotivo', 'motivo', 'descricao', 'error'];
  for (const key of keys) {
    const inner = value[key];
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
    if (inner && typeof inner === 'object') {
      const nested = toMessageText(inner);
      if (nested) return nested;
    }
  }

  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return null;
  }
}
