// backend/services/utils/strings.js (ESM)

// Liga logs deste helper quando NFE_DEBUG=1
const DEBUG = String(process.env.NFE_DEBUG || "").trim() === "1";
const log = (...a) => DEBUG && console.log("[strings]", ...a);

/** Remove tudo que não é dígito. */
export function onlyDigits(v) {
  return (v ?? "").toString().replace(/\D+/g, "");
}

/** Trim + colapsa espaços internos. */
export function compactSpaces(v) {
  return (v ?? "").toString().replace(/\s+/g, " ").trim();
}

/** Normaliza para maiúsculas sem acentos. */
export function toAsciiUpper(v) {
  return removeAccents((v ?? "").toString()).toUpperCase();
}

/** Remove acentos usando normalize. */
export function removeAccents(v) {
  return (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Limita tamanho máximo. */
export function limit(v, max) {
  const s = (v ?? "").toString();
  return s.length > max ? s.slice(0, max) : s;
}

/** Left pad com caractere (default '0'). */
export function padLeft(v, size, ch = "0") {
  const s = (v ?? "").toString();
  return s.length >= size ? s : ch.repeat(size - s.length) + s;
}

/** Right pad com caractere (default ' '). */
export function padRight(v, size, ch = " ") {
  const s = (v ?? "").toString();
  return s.length >= size ? s : s + ch.repeat(size - s.length);
}

/** Converte número (locale-agnostic); retorna Number ou null. */
export function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = (v + "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Formata com casas fixas (string). */
export function toFixed(n, decimals = 2) {
  const num = typeof n === "number" ? n : toNumber(n);
  if (!Number.isFinite(num)) return "0." + "0".repeat(decimals);
  return num.toFixed(decimals);
}

/** Normaliza UF (2 letras) ou null. */
export function normalizeUF(uf) {
  const u = (uf ?? "").toString().trim().toUpperCase();
  return /^[A-Z]{2}$/.test(u) ? u : null;
}

/** Normaliza CEP para 8 dígitos. */
export function normalizeCEP(cep) {
  const d = onlyDigits(cep);
  return d.length === 8 ? d : null;
}

/** Normaliza CNPJ (14) ou CPF (11); retorna string ou null. */
export function normalizeCNPJCPF(v) {
  const d = onlyDigits(v);
  if (d.length === 11 || d.length === 14) return d;
  return null;
}

/** Sanitiza texto simples pro layout da NF-e. */
export function sanitizeText(v, { upper = false, max = null } = {}) {
  let s = compactSpaces(v);
  s = removeAccents(s);
  if (upper) s = s.toUpperCase();
  if (typeof max === "number") s = limit(s, max);
  return s;
}

/** Constrói chave numérica com padding; útil para NCM/CEST etc. */
export function normalizeCode(v, size) {
  const d = onlyDigits(v);
  if (!size) return d;
  if (!d) return null;
  return padLeft(d.slice(-size), size, "0");
}

/** Log controlado por flag. */
export function debug(...a) {
  log(...a);
}

export default {
  onlyDigits,
  compactSpaces,
  toAsciiUpper,
  removeAccents,
  limit,
  padLeft,
  padRight,
  toNumber,
  toFixed,
  normalizeUF,
  normalizeCEP,
  normalizeCNPJCPF,
  sanitizeText,
  normalizeCode,
  debug,
};
