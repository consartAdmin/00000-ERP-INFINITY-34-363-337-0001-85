// ╔════════════════════════════════════════════════════════════════════╗
// ║ customers.index.js — ponto de entrada único do módulo customers    ║
// ║ Mantém a mesma API pública do antigo services/apis/customersApi.js ║
// ╚════════════════════════════════════════════════════════════════════╝

import { ensureTable } from './customersSchema.repository.js';
import { create } from './customersCreate.repository.js';
import { updateById } from './customersUpdate.repository.js';
import { getById } from './customersGetById.repository.js';
import { removeById } from './customersRemove.repository.js';
import {
  list,
  search,
  listAllForExport,
} from './customersQuery.repository.js';
import {
  listWithoutAsaasId,
  saveAsaasId,
  countWithoutAsaasId,
} from './customersAsaas.repository.js';

export {
  ensureTable,
  create,
  updateById,
  getById,
  removeById,
  list,
  search,
  listAllForExport,
  listWithoutAsaasId,
  saveAsaasId,
  countWithoutAsaasId,
};

// Helpers reaproveitáveis por outros módulos
export { upsertCustomersIbge } from './customersIbge.repository.js';
export { saveDeliveryAddress } from './customersDeliveryAddress.repository.js';

export default {
  ensureTable,
  create,
  updateById,
  getById,
  removeById,
  list,
  search,
  listAllForExport,
  listWithoutAsaasId,
  saveAsaasId,
  countWithoutAsaasId,
};
