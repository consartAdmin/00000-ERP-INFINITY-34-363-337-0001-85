// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeCce.index.js — ponto de entrada da Carta de Correção (CC-e)       ║
// ║ Mantém a mesma API pública do antigo nfeCceApi.js                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { emitirCCe } from './nfeCceEmit.repository.js';
import { consultarStatusCCe } from './nfeCceQuery.repository.js';
import { obterPdfCCe, obterXmlCCe } from './nfeCceDocuments.repository.js';

export { emitirCCe, consultarStatusCCe, obterPdfCCe, obterXmlCCe };

/* =========================================================================
 * 📋 EXPORT DEFAULT
 * ========================================================================= */

const nfeCceApi = {
  emitirCCe,
  consultarStatusCCe,
  obterPdfCCe,
  obterXmlCCe,
};

export default nfeCceApi;
