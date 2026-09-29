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
import { emitirNFe as emitirNFeTecnospeed } from './tecnoSpeedNfeEmit.repository.js';
import {
  consultarNFe as consultarNFeTecnospeed,
  obterXml as obterXmlTecnospeed,
  obterPdf as obterPdfTecnospeed,
  extrairTpAmb,
} from './tecnoSpeedNfeQuery.repository.js';
import { listarNFe as listarNFeTecnospeed } from './tecnoSpeedNfeList.repository.js';
import { routeProvider } from '../nfeApi/nfeApi.index.js';
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

/* =========================================================================
 * 🔀 Provedor: NFE_PROVIDER=nfe-api usa a NF-e API própria; padrão TecnoSpeed.
 * Consulta/XML/PDF/listagem vão para a NF-e API só quando a nota é dela
 * (chave de 44 dígitos conhecida pela API); as demais seguem na TecnoSpeed.
 * A EMISSÃO continua sempre na TecnoSpeed aqui: somente o fluxo de orçamentos
 * (nfeIssuanceIssue.repository.js) emite pela NF-e API, via routeProvider.
 * ========================================================================= */
const emitirNFe = emitirNFeTecnospeed;
const consultarNFe = routeProvider('consultarNFe', consultarNFeTecnospeed);
const obterXml = routeProvider('obterXml', obterXmlTecnospeed);
const obterPdf = routeProvider('obterPdf', obterPdfTecnospeed);
const listarNFe = routeProvider('listarNFe', listarNFeTecnospeed);

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
