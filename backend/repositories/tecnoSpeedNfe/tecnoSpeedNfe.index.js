// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tecnoSpeedNfe.index.js — Integração TecnoSpeed / PlugNotas NF-e      ║
// ║ Mantém a mesma API pública do antigo tecnoSpeedNfeApi.js             ║
// ║ ✔ Emissão, consulta, listagem, cancelamento, CC-e e inutilização     ║
// ║ ✔ NF-e de devolução ao fornecedor e de uso e consumo                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

// Cliente primeiro: carrega dotenv + axios e registra os logs de boot.
import { getEffectiveConfig } from './tecnoSpeedNfeClient.repository.js';
import { cancelarNFe } from '../cancelarNfe/cancelarNfe.index.js';
import { buildNFeFromOrder } from './tecnoSpeedNfeBuild.repository.js';
import { emitirNFe } from './tecnoSpeedNfeEmit.repository.js';
import {
  consultarNFe,
  obterXml,
  obterPdf,
  extrairTpAmb,
} from './tecnoSpeedNfeQuery.repository.js';
import { listarNFe } from './tecnoSpeedNfeList.repository.js';
import { reconcileOrderNfe } from './tecnoSpeedNfeOrderSync.repository.js';
import {
  emitirCCe,
  consultarStatusCCe,
  obterPdfCCe,
  obterXmlCCe,
} from './tecnoSpeedNfeCce.repository.js';
import {
  inutilizarNumeracao,
  consultarInutilizacao,
} from './tecnoSpeedNfeInutilizacao.repository.js';
import { emitirNFeSupplierReturn } from './tecnoSpeedNfeSupplierReturn.repository.js';
import { emitirNFeUsoConsumo } from './tecnoSpeedNfeUsoConsumo.repository.js';

export {
  buildNFeFromOrder,
  emitirNFe,
  consultarNFe,
  obterXml,
  obterPdf,
  extrairTpAmb,
  listarNFe,
  reconcileOrderNfe,
  getEffectiveConfig,
  emitirCCe,
  consultarStatusCCe,
  obterPdfCCe,
  obterXmlCCe,
  inutilizarNumeracao,
  consultarInutilizacao,
  emitirNFeSupplierReturn,
  emitirNFeUsoConsumo,
};

/* =========================================================================
 * 📦 Export default
 * ========================================================================= */
const tecnospeedNfeApi = {
  buildNFeFromOrder,
  emitirNFe,
  emitirNFeUsoConsumo,
  consultarNFe,
  cancelarNFe,
  listarNFe,
  obterXml,
  obterPdf,
  extrairTpAmb,
  getEffectiveConfig,
  reconcileOrderNfe,
  emitirCCe,
  consultarStatusCCe,
  obterPdfCCe,
  obterXmlCCe,
  inutilizarNumeracao,
  consultarInutilizacao,
  emitirNFeSupplierReturn,
};

export default tecnospeedNfeApi;
