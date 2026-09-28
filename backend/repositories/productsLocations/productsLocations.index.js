// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsLocations.index.js — ponto de entrada do módulo              ║
// ║ Mantém a mesma API pública do antigo productsLocationsApi.js         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { ensureTable } from './productsLocationsSchema.repository.js';
import { list, listByProductCode, getById } from './productsLocationsQuery.repository.js';
import { create } from './productsLocationsCreate.repository.js';
import { update, deactivate } from './productsLocationsUpdate.repository.js';
import { remove } from './productsLocationsRemove.repository.js';

export {
  ensureTable,
  list,
  listByProductCode,
  getById,
  create,
  update,
  deactivate,
  remove,
};

export default {
  ensureTable,
  list,
  listByProductCode,
  getById,
  create,
  update,
  deactivate,
  remove,
};
