// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeBonus.index.js — NF-e Bonificação                                 ║
// ║ Mantém a mesma API pública do antigo nfeBonusApi.js                  ║
// ║ ✔ CRUD do cabeçalho e dos itens                                      ║
// ║ ✔ Integração com produtos / grades / lotes                           ║
// ║ ✔ Recalcula total automaticamente                                    ║
// ║ ✔ Não movimenta estoque enquanto estiver em DRAFT                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { ensureTables } from './nfeBonusSchema.repository.js';
import { getBonusOperation } from './nfeBonusLookup.repository.js';
import { create } from './nfeBonusCreate.repository.js';
import { getById } from './nfeBonusGetById.repository.js';
import { search } from './nfeBonusQuery.repository.js';
import { update, markReady } from './nfeBonusUpdate.repository.js';
import { remove } from './nfeBonusRemove.repository.js';
import { addItem } from './nfeBonusItemCreate.repository.js';
import { listItems } from './nfeBonusItemQuery.repository.js';
import { updateItem } from './nfeBonusItemUpdate.repository.js';
import { removeItem } from './nfeBonusItemRemove.repository.js';
import { recalculateBonusTotal } from './nfeBonusTotal.repository.js';

export {
  ensureTables,
  getBonusOperation,
  create,
  getById,
  search,
  update,
  remove,
  addItem,
  listItems,
  updateItem,
  removeItem,
  recalculateBonusTotal,
  markReady,
};

// ======================================================================
// DEFAULT EXPORT
// ======================================================================

export default {
  ensureTables,

  getBonusOperation,

  create,
  getById,
  search,
  update,
  remove,

  addItem,
  listItems,
  updateItem,
  removeItem,

  recalculateBonusTotal,

  markReady,
};
