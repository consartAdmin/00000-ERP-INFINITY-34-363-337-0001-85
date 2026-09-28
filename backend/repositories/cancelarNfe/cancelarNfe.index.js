// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cancelarNfe.index.js — ponto de entrada do cancelamento de NF-e      ║
// ║ Mantém a mesma API pública do antigo cancelarNfeApi.js               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import './cancelarNfeClient.repository.js';
import { CANCELAMENTO_STATUS } from './cancelarNfe.constants.js';
import { normalizarStatusCancelamento } from './cancelarNfe.mappers.js';
import { validarCancelamentoNFe } from './cancelarNfe.sanitizers.js';
import {
  consultarResumoNFeParaCancelamento,
  consultarStatusCancelamentoNFe,
} from './cancelarNfeQuery.repository.js';
import { cancelarNFe } from './cancelarNfeCancel.repository.js';

export {
  consultarResumoNFeParaCancelamento,
  CANCELAMENTO_STATUS,
  normalizarStatusCancelamento,
  consultarStatusCancelamentoNFe,
  validarCancelamentoNFe,
  cancelarNFe,
};

const cancelarNfeApi = {
  consultarResumoNFeParaCancelamento,
  validarCancelamentoNFe,
  cancelarNFe,
};

export default cancelarNfeApi;
