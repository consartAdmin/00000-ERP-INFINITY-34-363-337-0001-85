// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tecnoSpeedDFe.index.js — Integração DF-e PlugNotas (CONSART ERP)     ║
// ║ Mantém a mesma API pública do antigo tecnoSpeedDFeApi.js             ║
// ║   GET https://api.plugnotas.com.br/nfe/destinada                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { http } from './tecnoSpeedDFeClient.repository.js';
import { mapNota, normalizeListResponse } from './tecnoSpeedDFe.mappers.js';
import { listDfe, getByKey } from './tecnoSpeedDFeQuery.repository.js';
import { downloadXmlByKey } from './tecnoSpeedDFeXml.repository.js';

export { mapNota, normalizeListResponse, listDfe, getByKey, downloadXmlByKey };

// ======================================================================
// Export default (padrão usado nos outros apis)
// ======================================================================

export default {
  http,
  listDfe,
  getByKey,
  downloadXmlByKey,   // ✅ ADD AQUI
  mapNota,
  normalizeListResponse,
};
