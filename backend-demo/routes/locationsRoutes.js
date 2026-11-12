// ╔══════════════════════════════════════════════════════════════════════╗
// ║ locationsRoutes.js — Warehouse Locations Routes (Express | ESM)      ║
// ║ Base path: /api/locations                                           ║
// ║ ✅ UPDATE: adiciona GET /map para buscar mapa completo de localização ║
// ║ ✅ Mantém PATCH /product-locations/:id/deactivate                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import express from 'express';
import {
  // Locals
  listLocals,
  createLocal,
  updateLocal,
  deleteLocal,

  // Corridors
  listCorridors,
  createCorridor,
  updateCorridor,
  deleteCorridor,

  // Shelves
  listShelves,
  createShelf,
  updateShelf,
  deleteShelf,

  // Bins
  listBins,
  createBin,
  updateBin,
  deleteBin,

  // Positions
  listPositions,
  createPosition,
  updatePosition,
  deletePosition,

  // Location Map
  listLocationMap,

  // Product locations
  listProductLocations,
  listProductLocationFilters,
  createProductLocation,
  updateProductLocation,
  deactivateProductLocation,
  setPrimaryProductLocation,
  deleteProductLocation,
} from '../controllers/locationsController.js';

const router = express.Router();

/* --------------------------------------------------------------------- */
/* 1) Locals                                                             */
/* --------------------------------------------------------------------- */

router.get('/locals', listLocals);
router.post('/locals', createLocal);
router.put('/locals/:id', updateLocal);
router.delete('/locals/:id', deleteLocal);

/* --------------------------------------------------------------------- */
/* 2) Corridors                                                          */
/* --------------------------------------------------------------------- */

router.get('/corridors', listCorridors);
router.post('/corridors', createCorridor);
router.put('/corridors/:id', updateCorridor);
router.delete('/corridors/:id', deleteCorridor);

/* --------------------------------------------------------------------- */
/* 3) Shelves                                                            */
/* --------------------------------------------------------------------- */

router.get('/shelves', listShelves);
router.post('/shelves', createShelf);
router.put('/shelves/:id', updateShelf);
router.delete('/shelves/:id', deleteShelf);

/* --------------------------------------------------------------------- */
/* 4) Bins                                                               */
/* --------------------------------------------------------------------- */

router.get('/bins', listBins);
router.post('/bins', createBin);
router.put('/bins/:id', updateBin);
router.delete('/bins/:id', deleteBin);

/* --------------------------------------------------------------------- */
/* 5) Positions                                                          */
/* --------------------------------------------------------------------- */

router.get('/positions', listPositions);
router.post('/positions', createPosition);
router.put('/positions/:id', updatePosition);
router.delete('/positions/:id', deletePosition);

/* --------------------------------------------------------------------- */
/* 5.1) Location Map — estrutura completa do estoque                      */
/* --------------------------------------------------------------------- */
// GET /api/locations/map?q=&corredor=&prateleira=&bandeja=&onlyActive=true
router.get('/map', listLocationMap);

/* --------------------------------------------------------------------- */
/* 6) Product locations (public."productsLocations")                      */
/* --------------------------------------------------------------------- */

router.get('/product-locations', listProductLocations);
router.get('/product-locations/filters', listProductLocationFilters);
router.post('/product-locations', createProductLocation);
router.put('/product-locations/:id', updateProductLocation);
router.patch('/product-locations/:id/deactivate', deactivateProductLocation);
router.patch('/product-locations/:id/primary', setPrimaryProductLocation);
router.delete('/product-locations/:id', deleteProductLocation);

export default router;