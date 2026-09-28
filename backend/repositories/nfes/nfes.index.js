// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfes.index.js — ponto de entrada da listagem de NF-e                 ║
// ║ Mantém a mesma API pública do antigo nfesApi.js                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import './nfes.constants.js';
import { search, getByOrderId } from './nfesQuery.repository.js';

export { search, getByOrderId };

const nfesApi = { search, getByOrderId };
export default nfesApi;
