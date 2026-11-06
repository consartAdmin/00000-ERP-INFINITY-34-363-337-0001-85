// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsFamilies.index.js — Famílias de Produtos (3º nível)        ║
/* ║ Endpoints (routes/productsFamiliesRoutes.js, montado em /api):
   ║   GET    /api/products-families?q=&subgroup_id=&group_id=&is_active=
   ║   GET    /api/products-families/:id
   ║   POST   /api/products-families      { name, subgroup_id, is_active? }
   ║   PUT    /api/products-families/:id  { name?, subgroup_id?, is_active? }
   ║   DELETE /api/products-families/:id  (produtos ficam sem família) */
// ╚════════════════════════════════════════════════════════════════════╝

import { ensureProductsFamiliesTable } from './productsFamiliesSchema.repository.js';
import { listProductsFamilies, getProductsFamilyById } from './productsFamiliesQuery.repository.js';
import { createProductsFamily, updateProductsFamily, deleteProductsFamily } from './productsFamiliesWrite.repository.js';

export {
  ensureProductsFamiliesTable,
  listProductsFamilies,
  getProductsFamilyById,
  createProductsFamily,
  updateProductsFamily,
  deleteProductsFamily,
};

const ProductsFamiliesAPI = Object.freeze({
  ensureTable: ensureProductsFamiliesTable,
  list: listProductsFamilies,
  getById: getProductsFamilyById,
  create: createProductsFamily,
  update: updateProductsFamily,
  remove: deleteProductsFamily,
});

export default ProductsFamiliesAPI;
