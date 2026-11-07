// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.status.js — Status em português e mensagem      ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

const DONE_STATUSES = ['DONE', 'SUCCESS', 'AUTHORIZED', 'CONCLUIDO', 'CONCLUÍDO', 'INUTILIZADA'];
const DONE_CSTAT = ['102', '135', '136', '155'];

export const STATUS_INFO = Object.freeze({
  done: { label: 'Inutilizada', pill: 'summary-pill--success', order: 1 },
  processing: { label: 'Em processamento', pill: 'summary-pill--warning', order: 2 },
  pending: { label: 'Pendente', pill: 'summary-pill--info', order: 3 },
  error: { label: 'Erro', pill: 'summary-pill--danger', order: 4 },
  rejected: { label: 'Rejeitada', pill: 'summary-pill--danger', order: 5 },
});

const textOf = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};

function isDone(item) {
  const status = String(item?.status ?? '').trim().toUpperCase();
  if (DONE_STATUSES.includes(status)) return true;

  const xml = String(item?.xmlResponse ?? '').toLowerCase();
  if (DONE_CSTAT.some((code) => xml.includes(`<cstat>${code}</cstat>`))) return true;

  const payload = textOf(item?.responsePayload).toLowerCase();
  return DONE_CSTAT.some((code) => payload.includes(`"cstat":"${code}"`) || payload.includes(`"cstat":${code}`))
    || payload.includes('inutilização homologada') || payload.includes('inutilizacao homologada');
}

/** done | processing | pending | error | rejected */
export function statusKey(item) {
  if (isDone(item)) return 'done';
  const status = String(item?.status ?? '').trim().toUpperCase();
  if (status === 'REJECTED') return 'rejected';
  if (status === 'ERROR') return 'error';
  if (status === 'PENDING') return 'pending';
  return 'processing';
}

export const statusInfo = (item) => STATUS_INFO[statusKey(item)];

/** Pode consultar na SEFAZ enquanto não está finalizada. */
export const canConsult = (item) => ['processing', 'pending'].includes(statusKey(item));

/* -----------------------------------------------------------------------
 * Mensagem — registros antigos gravaram "[object Object]" no banco:
 * nesse caso tenta tirar o texto do responsePayload.
 * --------------------------------------------------------------------- */
const MESSAGE_PATHS = [
  ['mensagem'], ['message'], ['motivo'], ['xMotivo'],
  ['data', 'mensagem'], ['data', 'message'], ['data', 'motivo'], ['data', 'xMotivo'],
  ['retorno', 'mensagem'], ['retorno', 'message'], ['retorno', 'xMotivo'],
  ['error', 'message'], ['error', 'data', 'current', 'mensagem'], ['error', 'data', 'current', 'message'],
];

function parse(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function messageFromPayload(payload) {
  const data = parse(payload);
  if (!data || typeof data !== 'object') return '';
  for (const path of MESSAGE_PATHS) {
    const found = path.reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), data);
    if (typeof found === 'string' && found.trim()) return found.trim();
  }
  return '';
}

export function messageText(item) {
  const raw = item?.message;
  if (typeof raw === 'string' && raw.trim() && raw.trim() !== '[object Object]') return raw.trim();
  if (raw && typeof raw === 'object') {
    const fromObject = messageFromPayload(raw);
    if (fromObject) return fromObject;
  }
  const fromPayload = messageFromPayload(item?.responsePayload);
  if (fromPayload) return fromPayload;
  return statusKey(item) === 'done' ? 'Inutilização homologada' : '';
}
